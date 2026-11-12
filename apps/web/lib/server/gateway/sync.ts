/**
 * POST /api/gateway/v1/sync — ciclo principal do gateway (docs/04, "Regras de processamento na nuvem").
 *
 * Tudo de um /sync roda em UMA transação, com o cliente do gateway definido (`withTenant`, RLS) e a
 * linha do gateway travada (`FOR UPDATE`), o que serializa syncs concorrentes do mesmo gateway
 * (retentativa que chega enquanto a anterior ainda grava). O `ack_seq` só sai depois do COMMIT.
 *
 * Idempotência (reenviar o mesmo lote não muda nada e devolve o mesmo ack):
 * - eventos: `id` UUIDv7 da borda → `ON CONFLICT (id) DO NOTHING`;
 * - minutos: PK `(machine_id, bucket_start)`; reenvio igual não muda nada, reescrita com valor
 *   diferente atualiza e guarda a versão anterior na auditoria;
 * - live: só grava se `at` for mais novo; amostras: PK `(tag_id, at)` → `DO NOTHING`;
 * - resultados de comando: por `id`, só enquanto o comando está em aberto.
 *
 * Referências: cada `machine_id`/`tag_id` dos itens da fila (eventos, minutos, amostras) precisa
 * pertencer a ESTE gateway (`gateway_machine` e `tag.gateway_id`); senão 400 `unknown_reference`
 * com os caminhos, e o agente isola o item culpado. Dados de "foto" que não estão na fila (live,
 * devices, command_results) com referência desconhecida são ignorados: o agente não consegue isolá-los
 * e recusar o /sync inteiro travaria a fila. Em nenhum caso há escrita fora do gateway autenticado.
 */
import {
  type Command,
  type CommandResult,
  CommandSchema,
  DEFAULTS,
  type ErrorIssue,
  type Event,
  FUTURE_TOLERANCE_MS,
  issuesFromZodError,
  type Live,
  MAX_COMMANDS_PER_SYNC,
  type Minute,
  type Sample,
  type SyncRequest,
  type SyncResponse,
  findTimestampsAfter,
} from "@engemase/contracts"
import {
  auditLog,
  device,
  gateway,
  gatewayCommand,
  gatewayDeviceStatus,
  gatewayMachine,
  machineLive,
  machineStateEvent,
  productionMinute,
  productionRun,
  remoteAccessEvent,
  remoteAccessForward,
  remoteAccessSession,
  tag,
  tagSample,
  withTenant,
} from "@engemase/db"
import { and, asc, eq, gt, gte, inArray, isNull, lte, sql } from "drizzle-orm"
import { GatewayApiError, MAX_ERROR_ISSUES, pathFromDotted } from "./errors"
import { type GatewayPrincipal, type GatewayTx, type GatewayDb, type RequestMeta } from "./types"

/** Versão mínima do agente anunciada no /sync (o agente ainda não a aplica). */
export const MIN_AGENT_VERSION = "0.1.0"

/** `next_sync_s` no modo interativo (comando em aberto criado há pouco). */
export const INTERACTIVE_SYNC_S = 1

/** Duração máxima do modo interativo a partir da criação do comando (docs/04). */
export const INTERACTIVE_WINDOW_MS = 5 * 60_000

/** Colunas `integer` do banco (fault_code): o contrato aceita até uint32. */
const INT4_MAX = 2_147_483_647

/** Estados de comando que ainda aceitam resultado do agente. */
const OPEN_COMMAND_STATUSES = ["pending", "sent"] as const
const RESULT_ACCEPTING_STATUSES = ["pending", "sent", "expired"] as const

export interface SyncContext extends RequestMeta {
  /** Relógio do servidor (`server_time`); injetável nos testes. */
  readonly now: Date
  readonly minAgentVersion?: string
}

type EventOf<T extends Event["type"]> = Extract<Event, { type: T }>
type StateEvent = EventOf<"state">
type ProductEvent = EventOf<"product">
type RemoteAccessEvent = EventOf<"remote_access">

/** Ids do banco voltam em minúsculas; os do agente podem vir em qualquer caixa. */
function key(id: string): string {
  return id.toLowerCase()
}

function iso(date: Date): string {
  return date.toISOString()
}

/** `integer` do Postgres: código de falha acima de 2^31−1 (uint32 do contrato) é gravado como nulo. */
function toInt4(value: number | undefined): number | null {
  return value === undefined || value > INT4_MAX ? null : value
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/**
 * Processa um /sync já validado pelo `SyncRequestSchema`. Lança `GatewayApiError` (com rollback)
 * para os erros do contrato.
 */
export async function processSync(
  db: GatewayDb,
  principal: GatewayPrincipal,
  req: SyncRequest,
  ctx: SyncContext,
): Promise<SyncResponse> {
  rejectFutureTimestamps(req, ctx.now)

  return withTenant(db, principal.organizationId, async (tx) => {
    const gw = await lockGateway(tx, principal.gatewayId)
    const refs = await loadReferences(tx, principal.gatewayId, req)
    assertQueueReferences(req, refs)

    const writer: Writer = { tx, principal, unitId: gw.unitId, now: ctx.now, touched: new TouchedRanges() }
    const events = req.events ?? []
    await saveStateEvents(writer, events.filter((e): e is StateEvent => e.type === "state"))
    await saveProductEvents(writer, events.filter((e): e is ProductEvent => e.type === "product"))
    await saveRemoteAccessEvents(writer, events.filter((e): e is RemoteAccessEvent => e.type === "remote_access"))
    await saveAuditEvents(
      writer,
      events.filter((e) => e.type !== "state" && e.type !== "product" && e.type !== "remote_access"),
    )
    await saveMinutes(writer, req.minutes ?? [])
    await saveSamples(writer, req.samples ?? [])
    await saveLive(writer, (req.live ?? []).filter((l) => refs.machines.has(key(l.machine_id))))
    await saveDeviceStatus(writer, req, refs)
    await saveCommandResults(writer, req.command_results ?? [], refs)
    await markShiftsDirty(writer)
    await saveGatewayHealth(writer, req, refs)

    const commands = await takeCommands(tx, principal.gatewayId, ctx.now)
    const interactive = await hasRecentOpenCommand(tx, principal.gatewayId, ctx.now)

    const response: SyncResponse = {
      ack_seq: req.batch.seq_to ?? 0,
      server_time: iso(ctx.now),
      config: { latest_version: gw.configVersionLatest },
      commands,
      next_sync_s: interactive ? INTERACTIVE_SYNC_S : gw.syncIntervalS,
      min_agent_version: ctx.minAgentVersion ?? MIN_AGENT_VERSION,
    }
    // Amostras com fila própria são confirmadas à parte (sem ela, entram no ack_seq).
    if (req.batch.samples_seq_from !== undefined || req.batch.samples_seq_to !== undefined) {
      response.ack_samples_seq = req.batch.samples_seq_to ?? 0
    }
    return response
  })
}

/** Timestamps de dados além de server_time + 2 min → 400 `timestamp_out_of_range` (docs/04). */
function rejectFutureTimestamps(req: SyncRequest, now: Date): void {
  const paths = findTimestampsAfter(req, new Date(now.getTime() + FUTURE_TOLERANCE_MS))
  if (paths.length === 0) return
  throw new GatewayApiError(
    "timestamp_out_of_range",
    `${paths.length} timestamp(s) no futuro além da tolerância (server_time ${iso(now)} + 2 min). Confira o relógio do gateway.`,
    { issues: paths.slice(0, MAX_ERROR_ISSUES).map((p) => ({ path: pathFromDotted(p), message: "timestamp no futuro" })) },
  )
}

// ---------------------------------------------------------------------------
// Gateway e referências
// ---------------------------------------------------------------------------

interface LockedGateway {
  readonly unitId: string
  readonly configVersionLatest: number
  /** Intervalo normal (s): `uplink.sync_interval_s` da última config publicada ou o padrão. */
  readonly syncIntervalS: number
}

async function lockGateway(tx: GatewayTx, gatewayId: string): Promise<LockedGateway> {
  const [row] = await tx
    .select({
      unitId: gateway.unitId,
      status: gateway.status,
      deletedAt: gateway.deletedAt,
      configVersionLatest: gateway.configVersionLatest,
      // Colunas qualificadas à mão: dentro de um campo `sql`, o Drizzle as escreve sem a tabela.
      syncInterval: sql<string | null>`(
        SELECT v.snapshot -> 'uplink' ->> 'sync_interval_s' FROM gateway_config_version v
        WHERE v.gateway_id = gateway.id AND v.version = gateway.config_version_latest
      )`,
    })
    .from(gateway)
    .where(eq(gateway.id, gatewayId))
    .for("update", { of: gateway })
  if (row === undefined) throw new GatewayApiError("unauthorized")
  // Revogado entre a autenticação e esta transação.
  if (row.status !== "active" || row.deletedAt !== null) throw new GatewayApiError("token_revoked")
  const interval = Number(row.syncInterval)
  return {
    unitId: row.unitId,
    configVersionLatest: row.configVersionLatest,
    syncIntervalS: Number.isInteger(interval) && interval >= 1 && interval <= 300 ? interval : DEFAULTS.syncIntervalS,
  }
}

interface References {
  /** Máquinas ligadas ao gateway (`gateway_machine`). */
  readonly machines: ReadonlySet<string>
  /** Tags do gateway → máquina da tag. */
  readonly tags: ReadonlySet<string>
  readonly devices: ReadonlySet<string>
  /** Comandos do gateway → tipo. */
  readonly commands: ReadonlyMap<string, string>
  readonly sessions: ReadonlySet<string>
  readonly forwards: ReadonlySet<string>
}

function uniqueKeys(ids: Iterable<string | undefined>): string[] {
  const out = new Set<string>()
  for (const id of ids) if (id !== undefined) out.add(key(id))
  return [...out]
}

/**
 * Carrega, entre os ids citados no /sync, os que pertencem ao gateway. A RLS já esconde os de outros
 * clientes; o filtro por `gateway_id` barra os de outro gateway do mesmo cliente.
 */
async function loadReferences(tx: GatewayTx, gatewayId: string, req: SyncRequest): Promise<References> {
  const events = req.events ?? []
  const machineIds = uniqueKeys([
    ...events.map((e) => ("machine_id" in e ? e.machine_id : undefined)),
    ...(req.minutes ?? []).map((m) => m.machine_id),
    ...(req.live ?? []).map((l) => l.machine_id),
  ])
  const tagIds = uniqueKeys([
    ...events.map((e) => ("tag_id" in e ? e.tag_id : undefined)),
    ...(req.samples ?? []).map((s) => s.tag_id),
  ])
  const deviceIds = uniqueKeys((req.devices ?? []).map((d) => d.id))
  const commandIds = uniqueKeys((req.command_results ?? []).map((r) => r.id))
  const remote = events.filter((e): e is RemoteAccessEvent => e.type === "remote_access")
  const sessionIds = uniqueKeys(remote.map((e) => e.session_id))
  const forwardIds = uniqueKeys(remote.map((e) => e.forward_id))

  const [machines, tags, devices, commands, sessions, forwards] = await Promise.all([
    machineIds.length === 0
      ? []
      : tx
          .select({ id: gatewayMachine.machineId })
          .from(gatewayMachine)
          .where(and(eq(gatewayMachine.gatewayId, gatewayId), inArray(gatewayMachine.machineId, machineIds))),
    tagIds.length === 0
      ? []
      : tx
          .select({ id: tag.id })
          .from(tag)
          .where(and(eq(tag.gatewayId, gatewayId), inArray(tag.id, tagIds), isNull(tag.deletedAt))),
    deviceIds.length === 0
      ? []
      : tx
          .select({ id: device.id })
          .from(device)
          .where(and(eq(device.gatewayId, gatewayId), inArray(device.id, deviceIds), isNull(device.deletedAt))),
    commandIds.length === 0
      ? []
      : tx
          .select({ id: gatewayCommand.id, type: gatewayCommand.type })
          .from(gatewayCommand)
          .where(and(eq(gatewayCommand.gatewayId, gatewayId), inArray(gatewayCommand.id, commandIds))),
    sessionIds.length === 0
      ? []
      : tx
          .select({ id: remoteAccessSession.id })
          .from(remoteAccessSession)
          .where(and(eq(remoteAccessSession.gatewayId, gatewayId), inArray(remoteAccessSession.id, sessionIds))),
    forwardIds.length === 0
      ? []
      : tx
          .select({ id: remoteAccessForward.id })
          .from(remoteAccessForward)
          .where(and(eq(remoteAccessForward.gatewayId, gatewayId), inArray(remoteAccessForward.id, forwardIds))),
  ])
  return {
    machines: new Set(machines.map((r) => key(r.id))),
    tags: new Set(tags.map((r) => key(r.id))),
    devices: new Set(devices.map((r) => key(r.id))),
    commands: new Map(commands.map((r) => [key(r.id), r.type])),
    sessions: new Set(sessions.map((r) => key(r.id))),
    forwards: new Set(forwards.map((r) => key(r.id))),
  }
}

/** Itens da fila com referência de fora do gateway → 400 `unknown_reference` (o agente isola o item). */
function assertQueueReferences(req: SyncRequest, refs: References): void {
  const issues: ErrorIssue[] = []
  const check = (ok: boolean, path: (string | number)[], what: string) => {
    if (!ok) issues.push({ path, message: `${what} não pertence a este gateway` })
  }
  ;(req.events ?? []).forEach((e, i) => {
    if ("machine_id" in e) check(refs.machines.has(key(e.machine_id)), ["events", i, "machine_id"], "machine_id")
    if ("tag_id" in e) check(refs.tags.has(key(e.tag_id)), ["events", i, "tag_id"], "tag_id")
    if (e.type === "remote_access") {
      check(refs.sessions.has(key(e.session_id)), ["events", i, "session_id"], "session_id")
      if (e.forward_id !== undefined) check(refs.forwards.has(key(e.forward_id)), ["events", i, "forward_id"], "forward_id")
    }
  })
  ;(req.minutes ?? []).forEach((m, i) => check(refs.machines.has(key(m.machine_id)), ["minutes", i, "machine_id"], "machine_id"))
  ;(req.samples ?? []).forEach((s, i) => check(refs.tags.has(key(s.tag_id)), ["samples", i, "tag_id"], "tag_id"))
  if (issues.length === 0) return
  throw new GatewayApiError(
    "unknown_reference",
    `${issues.length} item(ns) do lote citam máquina, tag ou sessão que não pertence a este gateway.`,
    { issues: issues.slice(0, MAX_ERROR_ISSUES) },
  )
}

// ---------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------

/** Intervalo de tempo com dados novos por máquina (para marcar turnos consolidados como sujos). */
class TouchedRanges {
  private readonly byMachine = new Map<string, { min: number; max: number }>()

  add(machineId: string, from: number, to: number = from): void {
    const k = key(machineId)
    const current = this.byMachine.get(k)
    if (current === undefined) this.byMachine.set(k, { min: from, max: to })
    else this.byMachine.set(k, { min: Math.min(current.min, from), max: Math.max(current.max, to) })
  }

  toJson(): { machine_id: string; t_min: string; t_max: string }[] {
    return [...this.byMachine].map(([machineId, r]) => ({
      machine_id: machineId,
      t_min: new Date(r.min).toISOString(),
      t_max: new Date(r.max).toISOString(),
    }))
  }
}

interface Writer {
  readonly tx: GatewayTx
  readonly principal: GatewayPrincipal
  readonly unitId: string
  readonly now: Date
  readonly touched: TouchedRanges
}

function byTimeThenId(a: { at: string; id: string }, b: { at: string; id: string }): number {
  return Date.parse(a.at) - Date.parse(b.at) || key(a.id).localeCompare(key(b.id))
}

/**
 * Encadeia o intervalo recém-inserido com os vizinhos da mesma máquina (ordem `started_at, id`):
 * o anterior termina onde este começa e este termina onde começa o seguinte (chegada fora de ordem).
 */
async function linkIntervals(
  tx: GatewayTx,
  table: "machine_state_event" | "production_run",
  machineId: string,
  id: string,
  at: Date,
): Promise<void> {
  const t = sql.identifier(table)
  const startedAt = iso(at)
  await tx.execute(sql`
    UPDATE ${t} SET ended_at = ${startedAt}::timestamptz
    WHERE id = (
      SELECT p.id FROM ${t} p
      WHERE p.machine_id = ${machineId}::uuid AND (p.started_at, p.id) < (${startedAt}::timestamptz, ${id}::uuid)
      ORDER BY p.started_at DESC, p.id DESC
      LIMIT 1
    ) AND (ended_at IS NULL OR ended_at > ${startedAt}::timestamptz)`)
  await tx.execute(sql`
    UPDATE ${t} SET ended_at = (
      SELECT n.started_at FROM ${t} n
      WHERE n.machine_id = ${machineId}::uuid AND (n.started_at, n.id) > (${startedAt}::timestamptz, ${id}::uuid)
      ORDER BY n.started_at, n.id
      LIMIT 1
    )
    WHERE id = ${id}::uuid`)
}

/** `state` → `machine_state_event` (fecha o intervalo anterior e abre o novo). */
async function saveStateEvents(w: Writer, events: readonly StateEvent[]): Promise<void> {
  if (events.length === 0) return
  const inserted = await w.tx
    .insert(machineStateEvent)
    .values(
      events.map((e) => ({
        id: e.id,
        organizationId: w.principal.organizationId,
        machineId: e.machine_id,
        state: e.state,
        startedAt: new Date(e.at),
        faultCode: toInt4(e.fault_code),
        source: "edge" as const,
      })),
    )
    .onConflictDoNothing({ target: machineStateEvent.id })
    .returning({ id: machineStateEvent.id })
  const fresh = new Set(inserted.map((r) => key(r.id)))
  for (const e of [...events].sort(byTimeThenId)) {
    if (!fresh.has(key(e.id))) continue // reenvio: já gravado
    const at = new Date(e.at)
    await linkIntervals(w.tx, "machine_state_event", e.machine_id, e.id, at)
    w.touched.add(e.machine_id, at.getTime())
  }
}

/** `product` → `production_run` (troca de produto vinda do CLP; mesmo encadeamento dos estados). */
async function saveProductEvents(w: Writer, events: readonly ProductEvent[]): Promise<void> {
  if (events.length === 0) return
  const inserted = await w.tx
    .insert(productionRun)
    .values(
      events.map((e) => ({
        id: e.id,
        organizationId: w.principal.organizationId,
        machineId: e.machine_id,
        productCode: e.product,
        // Produto cadastrado com o mesmo código (a RLS limita ao cliente).
        productId: sql`(SELECT p.id FROM product p WHERE p.code = ${e.product} AND p.deleted_at IS NULL LIMIT 1)`,
        startedAt: new Date(e.at),
        source: "plc" as const,
      })),
    )
    .onConflictDoNothing({ target: productionRun.id })
    .returning({ id: productionRun.id })
  const fresh = new Set(inserted.map((r) => key(r.id)))
  for (const e of [...events].sort(byTimeThenId)) {
    if (!fresh.has(key(e.id))) continue
    const at = new Date(e.at)
    await linkIntervals(w.tx, "production_run", e.machine_id, e.id, at)
    w.touched.add(e.machine_id, at.getTime())
  }
}

/** `remote_access` → `remote_access_event` da sessão (do mesmo gateway). */
async function saveRemoteAccessEvents(w: Writer, events: readonly RemoteAccessEvent[]): Promise<void> {
  if (events.length === 0) return
  await w.tx
    .insert(remoteAccessEvent)
    .values(
      events.map((e) => ({
        id: e.id,
        organizationId: w.principal.organizationId,
        sessionId: e.session_id,
        forwardId: e.forward_id ?? null,
        type: e.action,
        actorType: "gateway",
        actorId: w.principal.gatewayId,
        data: { ...(e.actor !== undefined ? { actor: e.actor } : {}), ...(e.detail !== undefined ? { detail: e.detail } : {}) },
        at: new Date(e.at),
      })),
    )
    .onConflictDoNothing({ target: remoteAccessEvent.id })
}

/**
 * Demais eventos da borda (contadores, partida/parada do agente, energia, relógio, perda de dados,
 * config aplicada/recusada) → `audit_log` com ator "gateway" e o evento inteiro em `after`. O id do
 * evento vira o id da linha (idempotência).
 */
async function saveAuditEvents(w: Writer, events: readonly Event[]): Promise<void> {
  if (events.length === 0) return
  await w.tx
    .insert(auditLog)
    .values(
      events.map((e) => {
        const machineId = "machine_id" in e ? e.machine_id : undefined
        return {
          id: e.id,
          organizationId: w.principal.organizationId,
          actorType: "gateway" as const,
          actorId: w.principal.gatewayId,
          action: `gateway.${e.type}`,
          entityType: machineId !== undefined ? "machine" : "gateway",
          entityId: machineId ?? w.principal.gatewayId,
          unitId: w.unitId,
          after: e,
          at: new Date(e.at),
        }
      }),
    )
    .onConflictDoNothing({ target: auditLog.id })
}

type MinuteValues = Pick<
  typeof productionMinute.$inferSelect,
  "runS" | "stopS" | "faultS" | "setupS" | "noCommS" | "total" | "reject" | "productCode"
>

function minuteValues(m: Minute): MinuteValues {
  return {
    runS: m.run_s,
    stopS: m.stop_s,
    faultS: m.fault_s,
    setupS: m.setup_s,
    noCommS: m.no_comm_s,
    total: m.total,
    reject: m.reject,
    productCode: m.product ?? null,
  }
}

function sameMinute(a: MinuteValues, b: MinuteValues): boolean {
  return (
    a.runS === b.runS &&
    a.stopS === b.stopS &&
    a.faultS === b.faultS &&
    a.setupS === b.setupS &&
    a.noCommS === b.noCommS &&
    a.total === b.total &&
    a.reject === b.reject &&
    a.productCode === b.productCode
  )
}

/**
 * `minutes` → `production_minute`. Minuto novo: insere. Igual ao gravado: nada (reenvio). Diferente:
 * atualiza e registra a versão anterior na auditoria (docs/04, "reescrita de um minuto").
 */
async function saveMinutes(w: Writer, minutes: readonly Minute[]): Promise<void> {
  if (minutes.length === 0) return
  const times = minutes.map((m) => Date.parse(m.t))
  const existing = await w.tx
    .select()
    .from(productionMinute)
    .where(
      and(
        inArray(productionMinute.machineId, uniqueKeys(minutes.map((m) => m.machine_id))),
        gte(productionMinute.bucketStart, new Date(Math.min(...times))),
        lte(productionMinute.bucketStart, new Date(Math.max(...times))),
      ),
    )
  const stored = new Map(existing.map((r) => [`${key(r.machineId)}|${r.bucketStart.getTime()}`, r]))

  const fresh: (typeof productionMinute.$inferInsert)[] = []
  for (const m of minutes) {
    const bucketStart = new Date(m.t)
    const values = minuteValues(m)
    const previous = stored.get(`${key(m.machine_id)}|${bucketStart.getTime()}`)
    if (previous !== undefined && sameMinute(previous, values)) continue
    w.touched.add(m.machine_id, bucketStart.getTime(), bucketStart.getTime() + 59_999)
    if (previous === undefined) {
      fresh.push({ organizationId: w.principal.organizationId, machineId: m.machine_id, bucketStart, ...values, receivedAt: w.now })
      continue
    }
    await w.tx
      .update(productionMinute)
      .set({ ...values, receivedAt: w.now })
      .where(and(eq(productionMinute.machineId, m.machine_id), eq(productionMinute.bucketStart, bucketStart)))
    await w.tx.insert(auditLog).values({
      organizationId: w.principal.organizationId,
      actorType: "gateway",
      actorId: w.principal.gatewayId,
      action: "production_minute.rewritten",
      entityType: "machine",
      entityId: m.machine_id,
      unitId: w.unitId,
      before: { t: m.t, ...pickMinute(previous), received_at: iso(previous.receivedAt) },
      after: { t: m.t, ...pickMinute(values) },
      at: w.now,
    })
  }
  if (fresh.length > 0) {
    await w.tx
      .insert(productionMinute)
      .values(fresh)
      .onConflictDoNothing({ target: [productionMinute.machineId, productionMinute.bucketStart] })
  }
}

function pickMinute(v: MinuteValues): Record<string, unknown> {
  return {
    run_s: v.runS,
    stop_s: v.stopS,
    fault_s: v.faultS,
    setup_s: v.setupS,
    no_comm_s: v.noCommS,
    total: v.total,
    reject: v.reject,
    product: v.productCode,
  }
}

/** `samples` → `tag_sample` (bool vira 0/1). */
async function saveSamples(w: Writer, samples: readonly Sample[]): Promise<void> {
  if (samples.length === 0) return
  await w.tx
    .insert(tagSample)
    .values(
      samples.map((s) => ({
        organizationId: w.principal.organizationId,
        tagId: s.tag_id,
        at: new Date(s.at),
        value: typeof s.v === "boolean" ? (s.v ? 1 : 0) : s.v,
      })),
    )
    .onConflictDoNothing({ target: [tagSample.tagId, tagSample.at] })
}

/** `live` → `machine_live`: upsert só se `at` for mais novo que o gravado. */
async function saveLive(w: Writer, live: readonly Live[]): Promise<void> {
  if (live.length === 0) return
  await w.tx
    .insert(machineLive)
    .values(
      live.map((l) => ({
        machineId: l.machine_id,
        organizationId: w.principal.organizationId,
        state: l.state,
        stateSince: new Date(l.state_since),
        faultCode: toInt4(l.fault_code),
        counterTotal: l.counter_total ?? null,
        productCode: l.product ?? null,
        at: new Date(l.at),
        updatedAt: w.now,
      })),
    )
    .onConflictDoUpdate({
      target: machineLive.machineId,
      set: {
        state: sql`excluded.state`,
        stateSince: sql`excluded.state_since`,
        faultCode: sql`excluded.fault_code`,
        counterTotal: sql`excluded.counter_total`,
        productCode: sql`excluded.product_code`,
        at: sql`excluded.at`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`machine_live.at < excluded.at`,
    })
}

/** `devices` → `gateway_device_status` (última foto), só dispositivos deste gateway. */
async function saveDeviceStatus(w: Writer, req: SyncRequest, refs: References): Promise<void> {
  const devices = (req.devices ?? []).filter((d) => refs.devices.has(key(d.id)))
  if (devices.length === 0) return
  await w.tx
    .insert(gatewayDeviceStatus)
    .values(
      devices.map((d) => ({
        deviceId: d.id,
        organizationId: w.principal.organizationId,
        gatewayId: w.principal.gatewayId,
        status: d.status,
        latencyMs: d.latency_ms ?? null,
        errors1m: d.errors_1m,
        updatedAt: w.now,
      })),
    )
    .onConflictDoUpdate({
      target: gatewayDeviceStatus.deviceId,
      set: {
        status: sql`excluded.status`,
        latencyMs: sql`excluded.latency_ms`,
        errors1m: sql`excluded.errors_1m`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
}

/**
 * `command_results` → `gateway_command`, por `id`, só para comando deste gateway, do mesmo tipo e
 * ainda em aberto (`expired` marcado pela nuvem ainda aceita o resultado de quem executou a tempo).
 * O resultado inteiro (como veio do agente) vai em `result`.
 */
async function saveCommandResults(w: Writer, results: readonly CommandResult[], refs: References): Promise<void> {
  for (const r of results) {
    if (refs.commands.get(key(r.id)) !== r.type) continue
    await w.tx
      .update(gatewayCommand)
      .set({
        status: r.status,
        result: r as unknown as Record<string, unknown>,
        errorCode: r.status === "ok" ? null : r.error.code,
        completedAt: w.now,
      })
      .where(
        and(
          eq(gatewayCommand.id, r.id),
          eq(gatewayCommand.gatewayId, w.principal.gatewayId),
          inArray(gatewayCommand.status, [...RESULT_ACCEPTING_STATUSES]),
        ),
      )
  }
}

/**
 * Dados novos num turno já consolidado (`oee_shift.dirty = false`) marcam o turno como sujo para o
 * cron recalcular (docs/07, "Dados atrasados"). O intervalo do turno é calculado no fuso da unidade
 * (turno noturno termina no dia seguinte).
 */
async function markShiftsDirty(w: Writer): Promise<void> {
  const ranges = w.touched.toJson()
  if (ranges.length === 0) return
  await w.tx.execute(sql`
    UPDATE oee_shift AS o SET dirty = true, dirty_since = ${iso(w.now)}::timestamptz
    FROM jsonb_to_recordset(${JSON.stringify(ranges)}::jsonb) AS r(machine_id uuid, t_min timestamptz, t_max timestamptz),
         shift AS s,
         unit AS u
    WHERE o.machine_id = r.machine_id
      AND NOT o.dirty
      AND s.id = o.shift_id
      AND u.id = s.unit_id
      AND o.shift_date BETWEEN (r.t_min AT TIME ZONE 'UTC')::date - 2 AND (r.t_max AT TIME ZONE 'UTC')::date + 1
      AND ((o.shift_date + s.start_time) AT TIME ZONE u.timezone) <= r.t_max
      AND ((o.shift_date + s.end_time
            + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0 days' END)
           AT TIME ZONE u.timezone) > r.t_min`)
}

/**
 * Saúde (`agent`, `buses` e o detalhe de `devices`) como última foto em `gateway.health`, mais
 * `last_seen_at`, versão do agente e versão de config aplicada.
 */
async function saveGatewayHealth(w: Writer, req: SyncRequest, refs: References): Promise<void> {
  const devices = (req.devices ?? []).filter((d) => refs.devices.has(key(d.id)))
  await w.tx
    .update(gateway)
    .set({
      lastSeenAt: w.now,
      agentVersion: req.agent.version,
      configVersionApplied: req.agent.config_version,
      health: {
        ...req.agent,
        ...(req.buses !== undefined ? { buses: req.buses } : {}),
        ...(devices.length > 0 ? { devices } : {}),
        received_at: iso(w.now),
      },
      updatedAt: w.now,
    })
    .where(eq(gateway.id, w.principal.gatewayId))
}

// ---------------------------------------------------------------------------
// Comandos para o agente
// ---------------------------------------------------------------------------

/**
 * Comandos a entregar: em aberto (`pending` ou `sent` sem resultado) e no prazo, até 20, do mais
 * antigo ao mais novo. Reentregar um `sent` é seguro (o agente deduplica por id) e cobre a resposta
 * perdida. Vencidos viram `expired`; os que não passam no `CommandSchema` (tipo desconhecido, payload
 * inválido, validade acima de 24 h) viram `rejected` aqui mesmo, sem ir ao agente.
 */
async function takeCommands(tx: GatewayTx, gatewayId: string, now: Date): Promise<Command[]> {
  await tx
    .update(gatewayCommand)
    .set({ status: "expired", completedAt: now })
    .where(
      and(
        eq(gatewayCommand.gatewayId, gatewayId),
        inArray(gatewayCommand.status, [...OPEN_COMMAND_STATUSES]),
        lte(gatewayCommand.expiresAt, now),
      ),
    )
  const rows = await tx
    .select({
      id: gatewayCommand.id,
      type: gatewayCommand.type,
      payload: gatewayCommand.payload,
      createdAt: gatewayCommand.createdAt,
      expiresAt: gatewayCommand.expiresAt,
    })
    .from(gatewayCommand)
    .where(
      and(
        eq(gatewayCommand.gatewayId, gatewayId),
        inArray(gatewayCommand.status, [...OPEN_COMMAND_STATUSES]),
        gt(gatewayCommand.expiresAt, now),
      ),
    )
    .orderBy(asc(gatewayCommand.createdAt), asc(gatewayCommand.id))
    .limit(MAX_COMMANDS_PER_SYNC)

  const commands: Command[] = []
  for (const row of rows) {
    const parsed = CommandSchema.safeParse({
      id: row.id,
      type: row.type,
      payload: row.payload,
      issued_at: iso(row.createdAt),
      expires_at: iso(row.expiresAt),
    })
    if (parsed.success) {
      commands.push(parsed.data)
      continue
    }
    await tx
      .update(gatewayCommand)
      .set({
        status: "rejected",
        errorCode: "invalid_payload",
        result: { error: { code: "invalid_payload", message: "Comando fora do contrato v1; não enviado ao gateway.", details: { issues: issuesFromZodError(parsed.error, 20) } } },
        completedAt: now,
      })
      .where(eq(gatewayCommand.id, row.id))
  }
  if (commands.length > 0) {
    await tx
      .update(gatewayCommand)
      .set({ status: "sent", sentAt: sql`coalesce(${gatewayCommand.sentAt}, ${iso(now)}::timestamptz)` })
      .where(
        inArray(
          gatewayCommand.id,
          commands.map((c) => c.id),
        ),
      )
  }
  return commands
}

/** Modo interativo: há comando em aberto criado nos últimos 5 min (docs/04, `next_sync_s = 1`). */
async function hasRecentOpenCommand(tx: GatewayTx, gatewayId: string, now: Date): Promise<boolean> {
  const rows = await tx
    .select({ id: gatewayCommand.id })
    .from(gatewayCommand)
    .where(
      and(
        eq(gatewayCommand.gatewayId, gatewayId),
        inArray(gatewayCommand.status, [...OPEN_COMMAND_STATUSES]),
        gt(gatewayCommand.expiresAt, now),
        gt(gatewayCommand.createdAt, new Date(now.getTime() - INTERACTIVE_WINDOW_MS)),
      ),
    )
    .limit(1)
  return rows.length > 0
}
