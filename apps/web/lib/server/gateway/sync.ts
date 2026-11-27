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
  downtimeReason,
  faultCodeMap,
  gateway,
  gatewayCommand,
  gatewayDeviceStatus,
  gatewayHealthSample,
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
import { and, asc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm"
import { ensureSystemRule, raiseAlert } from "../alerts/system"
import { assertTokenStillValid, tokenStateInTx } from "./auth"
import { GatewayApiError, MAX_ERROR_ISSUES, pathFromDotted } from "./errors"
import { type GatewayPrincipal, type GatewayTx, type GatewayDb, type RequestMeta } from "./types"
import type { VpnProvider } from "../remote/tailscale"
import { emOrdem } from "@/lib/server/em-ordem"

/** Versão mínima do agente anunciada no /sync (o agente ainda não a aplica). */
export const MIN_AGENT_VERSION = "0.1.0"

/** `next_sync_s` no modo interativo (comando em aberto criado há pouco). */
export const INTERACTIVE_SYNC_S = 1

/** Duração máxima do modo interativo a partir da criação do comando (docs/04). */
export const INTERACTIVE_WINDOW_MS = 5 * 60_000

/** Estados de comando que ainda aceitam resultado do agente. */
const OPEN_COMMAND_STATUSES = ["pending", "sent"] as const
const RESULT_ACCEPTING_STATUSES = ["pending", "sent", "expired"] as const

export interface SyncContext extends RequestMeta {
  /** Relógio do servidor (`server_time`); injetável nos testes. */
  readonly now: Date
  readonly minAgentVersion?: string
  /** Provedor da VPN (Tailscale): cria a chave de uso único do `vpn.enable` na hora da entrega. */
  readonly vpn?: VpnProvider | null
  /** Log de falhas não fatais (padrão: console.error). */
  readonly logError?: (message: string, error: unknown) => void
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
    const gw = await lockGateway(tx, principal)
    const refs = await loadReferences(tx, principal.gatewayId, req)
    assertQueueReferences(req, refs, gw.configVersionLatest)

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

    const commands = await takeCommands(tx, principal.gatewayId, ctx.now, ctx)
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

/**
 * Trava a linha do gateway e confere, NA MESMA consulta, se o token da requisição ainda vale: entre a
 * autenticação e esta transação o corpo ainda estava chegando, e o gateway pode ter sido revogado,
 * reativado (token novo) ou ter saído da janela da rotação. Depois do `FOR UPDATE`, uma reativação
 * concorrente espera este /sync terminar.
 */
async function lockGateway(tx: GatewayTx, principal: GatewayPrincipal): Promise<LockedGateway> {
  const [row] = await tx
    .select({
      unitId: gateway.unitId,
      tokenState: tokenStateInTx(principal.tokenHash),
      configVersionLatest: gateway.configVersionLatest,
      // Colunas qualificadas à mão: dentro de um campo `sql`, o Drizzle as escreve sem a tabela.
      syncInterval: sql<string | null>`(
        SELECT v.snapshot -> 'uplink' ->> 'sync_interval_s' FROM gateway_config_version v
        WHERE v.gateway_id = gateway.id AND v.version = gateway.config_version_latest
      )`,
    })
    .from(gateway)
    .where(eq(gateway.id, principal.gatewayId))
    .for("update", { of: gateway })
  assertTokenStillValid(row)
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

  const [machines, tags, devices, commands, sessions, forwards] = await emOrdem([
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

/**
 * O agente ainda roda uma config anterior à publicada, e não porque a recusou ou reverteu: a
 * referência que ele cita pode ter saído na config nova. Nesse caso a resposta é 409
 * `config_outdated` (o agente baixa a config e reenvia), em vez de 400 `unknown_reference` (que
 * mandaria o item para a quarentena). Se a config publicada foi recusada pelo agente, o 409 só o
 * faria baixar a mesma config de novo, para sempre: aí vale o 400.
 */
export function agentConfigOutdated(agent: SyncRequest["agent"], latestVersion: number): boolean {
  if (agent.config_version >= latestVersion) return false
  const status = agent.config_status
  const refusedLatest =
    status !== undefined && status.version >= latestVersion && (status.state === "rejected" || status.state === "reverted")
  return !refusedLatest
}

/**
 * Itens da fila com referência de fora do gateway → 400 `unknown_reference` (o agente isola o item);
 * com a config do agente desatualizada, 409 `config_outdated` (ver `agentConfigOutdated`).
 */
function assertQueueReferences(req: SyncRequest, refs: References, latestConfigVersion: number): void {
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
  if (agentConfigOutdated(req.agent, latestConfigVersion)) {
    throw new GatewayApiError(
      "config_outdated",
      `O lote cita máquina, tag ou sessão fora da config ${latestConfigVersion} (o agente está na ${req.agent.config_version}). Baixe a config nova e reenvie.`,
      { issues: issues.slice(0, MAX_ERROR_ISSUES) },
    )
  }
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

/**
 * Motivo automático das falhas pelo mapa de códigos do cliente (F2): o da máquina ganha do geral.
 * Devolve `máquina:código → motivo` só para os códigos com motivo (sem motivo, o operador escolhe).
 */
async function faultReasons(w: Writer, events: readonly StateEvent[]): Promise<Map<string, string>> {
  const faults = events.filter((e) => e.state === "FAULT" && e.fault_code !== undefined && e.fault_code !== null)
  const out = new Map<string, string>()
  if (faults.length === 0) return out
  const codes = [...new Set(faults.map((e) => Number(e.fault_code)))]
  const machines = [...new Set(faults.map((e) => e.machine_id))]
  // Só motivo que ainda existe e está ativo (desativado depois de mapear → o operador escolhe).
  const rows = await w.tx
    .select({
      machineId: faultCodeMap.machineId,
      code: faultCodeMap.faultCode,
      reasonId: sql<string | null>`CASE WHEN ${downtimeReason.id} IS NOT NULL AND ${downtimeReason.active} AND ${downtimeReason.deletedAt} IS NULL THEN ${faultCodeMap.reasonId} END`,
    })
    .from(faultCodeMap)
    .leftJoin(downtimeReason, eq(downtimeReason.id, faultCodeMap.reasonId))
    .where(
      and(
        inArray(faultCodeMap.faultCode, codes),
        or(inArray(faultCodeMap.machineId, machines), and(isNull(faultCodeMap.machineId), isNull(faultCodeMap.templateId))),
      ),
    )
  const general = new Map<number, string | null>()
  const specific = new Map<string, string | null>()
  for (const r of rows) {
    if (r.machineId === null) general.set(Number(r.code), r.reasonId)
    else specific.set(`${r.machineId}:${Number(r.code)}`, r.reasonId)
  }
  for (const e of faults) {
    const code = Number(e.fault_code)
    const k = `${e.machine_id}:${code}`
    // Mapeado na máquina sem motivo = "perguntar ao operador", mesmo que o geral tenha motivo.
    const reasonId = specific.has(k) ? specific.get(k) : general.get(code)
    if (reasonId) out.set(k, reasonId)
  }
  return out
}

/** `state` → `machine_state_event` (fecha o intervalo anterior e abre o novo). */
async function saveStateEvents(w: Writer, events: readonly StateEvent[]): Promise<void> {
  if (events.length === 0) return
  const auto = await faultReasons(w, events)
  const inserted = await w.tx
    .insert(machineStateEvent)
    .values(
      events.map((e) => ({
        id: e.id,
        organizationId: w.principal.organizationId,
        machineId: e.machine_id,
        state: e.state,
        startedAt: new Date(e.at),
        // uint32 do contrato em `bigint` (0..4294967295, CHECK no banco).
        faultCode: e.fault_code ?? null,
        source: "edge" as const,
        // Falha com código mapeado: já nasce classificada (sem pessoa; o operador pode corrigir).
        ...(() => {
          const reasonId = e.state === "FAULT" && e.fault_code != null ? auto.get(`${e.machine_id}:${Number(e.fault_code)}`) : undefined
          return reasonId ? { reasonId, classifiedAt: new Date(e.at) } : {}
        })(),
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

  // O estado da sessão acompanha o que o gateway relata (docs/12): ligou → ativa; desligou → encerrada.
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const at = new Date(e.at)
    if (e.action === "session_started") {
      await w.tx
        .update(remoteAccessSession)
        .set({ status: "active", startsAt: sql`coalesce(${remoteAccessSession.startsAt}, ${iso(at)}::timestamptz)`, updatedAt: w.now })
        .where(
          and(
            eq(remoteAccessSession.id, e.session_id),
            eq(remoteAccessSession.gatewayId, w.principal.gatewayId),
            inArray(remoteAccessSession.status, ["approved", "activating"]),
          ),
        )
    } else if (e.action === "session_ended") {
      await w.tx
        .update(remoteAccessSession)
        .set({ status: "ended", endedAt: at, endReason: e.detail ?? "requested", updatedAt: w.now })
        .where(
          and(
            eq(remoteAccessSession.id, e.session_id),
            eq(remoteAccessSession.gatewayId, w.principal.gatewayId),
            inArray(remoteAccessSession.status, ["approved", "activating", "active", "stopping"]),
          ),
        )
    }
  }
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
  "runS" | "stopS" | "faultS" | "setupS" | "noCommS" | "total" | "reject" | "good" | "productCode"
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
    // Só quando a máquina tem contador de boas (`count.good`); sem ele, boas = total − refugo (docs/07).
    good: m.good ?? null,
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
    a.good === b.good &&
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
  const rewritten = new Map<string, { machineId: string; count: number; lastT: string }>()
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
    const r = rewritten.get(key(m.machine_id)) ?? { machineId: m.machine_id, count: 0, lastT: m.t }
    r.count++
    if (Date.parse(m.t) >= Date.parse(r.lastT)) r.lastT = m.t
    rewritten.set(key(m.machine_id), r)
  }
  await raiseMinuteRewrittenAlerts(w, [...rewritten.values()])
  if (fresh.length > 0) {
    await w.tx
      .insert(productionMinute)
      .values(fresh)
      .onConflictDoNothing({ target: [productionMinute.machineId, productionMinute.bucketStart] })
  }
}

/**
 * Alerta "minuto reescrito" (docs/04 e docs/13, regra do sistema `minute_rewritten`): um alerta
 * aberto por máquina, somando as reescritas em `data.count`. A versão anterior de cada minuto já
 * está na auditoria (`production_minute.rewritten`).
 */
async function raiseMinuteRewrittenAlerts(
  w: Writer,
  machines: readonly { machineId: string; count: number; lastT: string }[],
): Promise<void> {
  if (machines.length === 0) return
  const rule = await ensureSystemRule(w.tx, w.principal.organizationId, "minute_rewritten")
  if (rule === null) return
  for (const m of machines) {
    await raiseAlert(w.tx, {
      organizationId: w.principal.organizationId,
      rule,
      dedupKey: key(m.machineId),
      machineId: m.machineId,
      gatewayId: w.principal.gatewayId,
      at: w.now,
      data: { kind: "minute_rewritten", count: m.count, last_minute: m.lastT, gateway_id: w.principal.gatewayId },
    })
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
    good: v.good,
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
        faultCode: l.fault_code ?? null,
        counterTotal: l.counter_total ?? null,
        productCode: l.product ?? null,
        speed: l.speed ?? null,
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
        speed: sql`excluded.speed`,
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
    // VPN ligada: guarda o IP do gateway na VPN (o técnico entra por ele: ssh suporte@<ip>).
    if (r.type === "vpn.enable" && r.status === "ok" && typeof r.result.node_ip === "string" && r.result.node_ip !== "") {
      await w.tx
        .update(remoteAccessSession)
        .set({ vpnIp: r.result.node_ip, updatedAt: w.now })
        .where(
          and(
            eq(remoteAccessSession.id, r.result.session_id),
            eq(remoteAccessSession.gatewayId, w.principal.gatewayId),
            inArray(remoteAccessSession.status, ["approved", "activating", "active"]),
          ),
        )
    }
    // O gateway não conseguiu ligar a VPN (aprovação recusada, política local, rede): a sessão falhou.
    if (r.type === "vpn.enable" && r.status !== "ok") {
      const [cmd] = await w.tx.select({ payload: gatewayCommand.payload }).from(gatewayCommand).where(eq(gatewayCommand.id, r.id)).limit(1)
      const sessionId = (cmd?.payload as { session_id?: unknown } | undefined)?.session_id
      if (typeof sessionId === "string") {
        await w.tx
          .update(remoteAccessSession)
          .set({ status: "failed", endedAt: w.now, endReason: r.status === "expired" ? "expired" : r.error.code, updatedAt: w.now })
          .where(
            and(
              eq(remoteAccessSession.id, sessionId),
              eq(remoteAccessSession.gatewayId, w.principal.gatewayId),
              inArray(remoteAccessSession.status, ["approved", "activating"]),
            ),
          )
      }
    }
  }
}

/**
 * Dados novos num turno já consolidado marcam o turno como sujo para o cron recalcular (docs/07, "Dados
 * atrasados"). O intervalo do turno é calculado no fuso da unidade (turno noturno termina no dia seguinte).
 * Marca também o que já está sujo (mantendo o `dirty_since`): o UPDATE trava a linha e serializa com o
 * recálculo em andamento (`lib/server/production/oee-shifts.ts`), que assim nunca limpa o `dirty` de um
 * turno cujos dados novos ele não viu.
 */
async function markShiftsDirty(w: Writer): Promise<void> {
  const ranges = w.touched.toJson()
  if (ranges.length === 0) return
  await w.tx.execute(sql`
    UPDATE oee_shift AS o SET dirty = true, dirty_since = CASE WHEN o.dirty THEN o.dirty_since ELSE ${iso(w.now)}::timestamptz END
    FROM jsonb_to_recordset(${JSON.stringify(ranges)}::jsonb) AS r(machine_id uuid, t_min timestamptz, t_max timestamptz),
         shift AS s,
         unit AS u
    WHERE o.machine_id = r.machine_id
      AND s.id = o.shift_id
      AND u.id = s.unit_id
      AND o.shift_date BETWEEN (r.t_min AT TIME ZONE 'UTC')::date - 2 AND (r.t_max AT TIME ZONE 'UTC')::date + 1
      AND ((o.shift_date + s.start_time) AT TIME ZONE u.timezone) <= r.t_max
      AND ((o.shift_date + s.end_time
            + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0 days' END)
           AT TIME ZONE u.timezone) > r.t_min`)
}

/** Janela do histórico de saúde (`gateway_health_sample`). */
export const HEALTH_BUCKET_MS = 5 * 60_000

const INT32_MAX = 2_147_483_647

function int32(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null
  return Math.max(-INT32_MAX, Math.min(INT32_MAX, Math.round(value)))
}

/**
 * Saúde (`agent`, `buses` e o detalhe de `devices`) como última foto em `gateway.health`, mais
 * `last_seen_at`, versão do agente e versão de config aplicada; e o histórico resumido em
 * `gateway_health_sample` (uma linha a cada 5 min: máximos, mínimos e o último valor).
 */
async function saveGatewayHealth(w: Writer, req: SyncRequest, refs: References): Promise<void> {
  const devices = (req.devices ?? []).filter((d) => refs.devices.has(key(d.id)))
  await saveHealthSample(w, req, devices)
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
      // "Em trânsito" (L23) termina no primeiro /sync depois de marcado: o gateway chegou ao cliente.
      installedAt: sql`CASE WHEN ${gateway.installedAt} IS NULL AND ${gateway.inTransitSince} IS NOT NULL
        AND ${gateway.inTransitSince} <= ${iso(w.now)}::timestamptz THEN ${iso(w.now)}::timestamptz ELSE ${gateway.installedAt} END`,
      updatedAt: w.now,
    })
    .where(eq(gateway.id, w.principal.gatewayId))
}

/** Upsert da janela de 5 min do histórico de saúde. */
async function saveHealthSample(w: Writer, req: SyncRequest, devices: readonly NonNullable<SyncRequest["devices"]>[number][]): Promise<void> {
  const a = req.agent
  const buses = req.buses ?? []
  const bucketStart = new Date(Math.floor(w.now.getTime() / HEALTH_BUCKET_MS) * HEALTH_BUCKET_MS)
  const t = gatewayHealthSample
  await w.tx
    .insert(t)
    .values({
      organizationId: w.principal.organizationId,
      gatewayId: w.principal.gatewayId,
      bucketStart,
      firstAt: w.now,
      lastAt: w.now,
      agentVersion: a.version,
      configVersion: int32(a.config_version),
      configState: a.config_status?.state ?? null,
      cpuPctMax: a.cpu_pct,
      memMbMax: a.mem_mb,
      diskFreeMbMin: a.disk_free_mb,
      bufferPendingMax: int32(a.buffer_pending),
      bufferOldestSMax: int32(a.buffer_oldest_s),
      quarantinedMax: int32(a.quarantined),
      clockOffsetMsMaxAbs: int32(Math.abs(a.clock_offset_ms)),
      tempCMax: a.temp_c ?? null,
      devicesTotal: devices.length > 0 ? devices.length : null,
      devicesConnectedMin: devices.length > 0 ? devices.filter((d) => d.status === "connected").length : null,
      busesDegradedMax: buses.length > 0 ? buses.filter((b) => b.status !== "ok").length : null,
    })
    .onConflictDoUpdate({
      target: [t.gatewayId, t.bucketStart],
      set: {
        lastAt: sql`greatest(${t.lastAt}, excluded.last_at)`,
        syncCount: sql`${t.syncCount} + 1`,
        agentVersion: sql`excluded.agent_version`,
        configVersion: sql`excluded.config_version`,
        configState: sql`coalesce(excluded.config_state, ${t.configState})`,
        // greatest/least do Postgres ignoram NULL.
        cpuPctMax: sql`greatest(${t.cpuPctMax}, excluded.cpu_pct_max)`,
        memMbMax: sql`greatest(${t.memMbMax}, excluded.mem_mb_max)`,
        diskFreeMbMin: sql`least(${t.diskFreeMbMin}, excluded.disk_free_mb_min)`,
        bufferPendingMax: sql`greatest(${t.bufferPendingMax}, excluded.buffer_pending_max)`,
        bufferOldestSMax: sql`greatest(${t.bufferOldestSMax}, excluded.buffer_oldest_s_max)`,
        quarantinedMax: sql`greatest(${t.quarantinedMax}, excluded.quarantined_max)`,
        clockOffsetMsMaxAbs: sql`greatest(${t.clockOffsetMsMaxAbs}, excluded.clock_offset_ms_max_abs)`,
        tempCMax: sql`greatest(${t.tempCMax}, excluded.temp_c_max)`,
        devicesTotal: sql`coalesce(excluded.devices_total, ${t.devicesTotal})`,
        devicesConnectedMin: sql`least(${t.devicesConnectedMin}, excluded.devices_connected_min)`,
        busesDegradedMax: sql`greatest(${t.busesDegradedMax}, excluded.buses_degraded_max)`,
      },
    })
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
async function takeCommands(tx: GatewayTx, gatewayId: string, now: Date, ctx: Pick<SyncContext, "vpn" | "logError"> = {}): Promise<Command[]> {
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
      status: gatewayCommand.status,
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
    let payload: unknown = row.payload
    if (row.type === "vpn.enable") {
      // A chave de entrada (segredo, uso único) é criada AGORA e só vai na resposta: nunca fica no banco.
      // Só na primeira entrega: reenviar geraria outra chave a cada /sync.
      if (row.status !== "pending") continue
      if (!ctx.vpn) continue // VPN não configurada na plataforma: o comando espera (vence pelo prazo)
      try {
        const authKey = await ctx.vpn.mintAuthKey(`OEE sessao ${String((row.payload as { session_id?: unknown })?.session_id ?? "").slice(-12)}`)
        payload = { ...(row.payload as Record<string, unknown>), auth_key: authKey }
      } catch (error) {
        ;(ctx.logError ?? console.error)("[vpn] não foi possível criar a chave de entrada; tenta no próximo /sync", error)
        continue
      }
    }
    const parsed = CommandSchema.safeParse({
      id: row.id,
      type: row.type,
      payload,
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
