"use server"

/**
 * Server Actions do cadastro do cliente (W8): unidades, áreas, linhas, gateways, códigos de ativação,
 * máquinas com CLP e sinais, publicação da config, comandos ao gateway e produtos com ciclos ideais.
 *
 * Toda ação: valida a entrada (zod), confere de novo a sessão e o cliente (`requireTenant`, RLS) e a
 * permissão do papel (config.write = equipe Engemase, D12/D13; diagnostics.run para comandos), grava
 * numa transação do cliente e registra na auditoria. Não confia na página que a mostrou.
 */
import {
  COMMAND_TYPES,
  type CommandType,
  ConfigReloadPayloadSchema,
  DeviceTestPayloadSchema,
  issuesFromZodError,
  StateRulesSchema,
  type StateRules,
  TagReadPayloadSchema,
  TagSchema,
  AgentRestartPayloadSchema,
} from "@engemase/contracts"
import { area, auditLog, clientAccount, device, gateway, gatewayMachine, line, machine, tag, unit, withTenant } from "@engemase/db"
import { and, count, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { atorDoContexto, type Resultado } from "@/lib/data/admin/acesso"
import { type ResumoDoComando, resumoDoComando } from "@/lib/data/config/comandos"
import { dateTime } from "@/lib/format"
import { hasPermission, type TenantContext } from "@/lib/server/access/context"
import type { Permission } from "@/lib/server/access/permissions"
import { requireTenant } from "@/lib/server/access/require-tenant"
import { getDb } from "@/lib/server/db"
import { excluirProduto, salvarMatrizCiclos, salvarProduto } from "@/lib/server/config/products"
import { createActivationCode } from "@/lib/server/gateway/activation"
import { GatewayAdminError } from "@/lib/server/gateway/admin-errors"
import { enqueueGatewayCommand, getGatewayCommand } from "@/lib/server/gateway/commands"
import { publishGatewayConfig } from "@/lib/server/gateway/publish"
import type { GatewayDb } from "@/lib/server/gateway/types"

const Id = z.uuid("Identificador inválido.")
const Slug = z.string().min(1).max(63)
const Nome = z.string().trim().min(2, "Informe o nome (mínimo 2 caracteres).").max(120, "Nome muito longo.")

const SEM_ACESSO: Resultado<never> = { ok: false, mensagem: "Você não tem permissão para esta ação ou sua sessão terminou. Entre de novo." }

interface Acesso {
  readonly ctx: TenantContext
  readonly db: GatewayDb
}

/** Sessão + cliente + permissão, conferidos de novo na ação. `null` = sem acesso. */
async function acesso(slug: string, permissao: Permission): Promise<Acesso | null> {
  const db = getDb()
  if (db === null) return null
  let ctx: TenantContext
  try {
    ctx = await requireTenant(slug)
  } catch {
    // requireTenant redireciona (login, 2FA, suspenso) ou responde 404: na ação vira "sem acesso".
    return null
  }
  return hasPermission(ctx, permissao) ? { ctx, db } : null
}

function erroEsperado(error: unknown, contexto: string): Resultado<never> {
  if (error instanceof GatewayAdminError) {
    return { ok: false, mensagem: error.message, problemas: error.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })) }
  }
  const code = (error as { code?: unknown; cause?: { code?: unknown } })?.cause?.code ?? (error as { code?: unknown })?.code
  if (code === "23505") return { ok: false, mensagem: "Já existe um cadastro com esse nome ou código." }
  if (code === "23503" || code === "23514") return { ok: false, mensagem: "Os dados não fecham com o cadastro (unidade, linha ou gateway de outra unidade)." }
  console.error(`[cadastro] falha em ${contexto}`, error)
  return { ok: false, mensagem: "Não foi possível gravar. Tente de novo em instantes." }
}

function entrada<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> | Resultado<never> {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data
  return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Confira os dados." }
}
const invalida = (v: unknown): v is Resultado<never> => typeof v === "object" && v !== null && "ok" in v && (v as { ok: unknown }).ok === false

async function auditar(tx: Parameters<Parameters<GatewayDb["transaction"]>[0]>[0], a: Acesso, dados: { action: string; entityType: string; entityId: string; unitId?: string | null; after?: unknown }) {
  const ator = atorDoContexto(a.ctx)
  await tx.insert(auditLog).values({
    organizationId: a.ctx.organizationId,
    actorType: ator.type,
    actorId: ator.id ?? null,
    actorLabel: ator.label ?? null,
    action: dados.action,
    entityType: dados.entityType,
    entityId: dados.entityId,
    unitId: dados.unitId ?? null,
    after: dados.after ?? null,
    accessGrantId: a.ctx.access.kind === "engemase" ? (a.ctx.access.supportGrantId ?? a.ctx.access.assignmentId) : null,
  })
}

const revalidar = (slug: string) => revalidatePath(`/${slug}`, "layout")

// ---------------------------------------------------------------------------
// Unidades, áreas e linhas
// ---------------------------------------------------------------------------

const UnidadeInput = z.object({ slug: Slug, id: Id.optional(), name: Nome, timezone: z.string().min(3).max(64).default("America/Sao_Paulo") })

export async function salvarUnidadeAction(input: unknown): Promise<Resultado<{ id: string }>> {
  const d = entrada(UnidadeInput, input)
  if (invalida(d)) return d
  const a = await acesso(d.slug, "config.write")
  if (a === null) return SEM_ACESSO
  try {
    const id = await withTenant(a.db, a.ctx.organizationId, async (tx) => {
      if (d.id !== undefined) {
        const [row] = await tx.update(unit).set({ name: d.name, timezone: d.timezone, updatedAt: new Date() }).where(and(eq(unit.id, d.id), isNull(unit.deletedAt))).returning({ id: unit.id })
        if (row === undefined) throw new GatewayAdminError("gateway_not_found", "Unidade não encontrada.")
        await auditar(tx, a, { action: "unit.update", entityType: "unit", entityId: row.id, unitId: row.id, after: { name: d.name, timezone: d.timezone } })
        return row.id
      }
      const [row] = await tx.insert(unit).values({ organizationId: a.ctx.organizationId, name: d.name, timezone: d.timezone }).returning({ id: unit.id })
      if (row === undefined) throw new Error("insert de unit sem retorno")
      await auditar(tx, a, { action: "unit.create", entityType: "unit", entityId: row.id, unitId: row.id, after: { name: d.name, timezone: d.timezone } })
      return row.id
    })
    revalidar(d.slug)
    return { ok: true, dados: { id } }
  } catch (error) {
    return erroEsperado(error, "salvarUnidade")
  }
}

const AreaInput = z.object({ slug: Slug, id: Id.optional(), unitId: Id, name: Nome })

export async function salvarAreaAction(input: unknown): Promise<Resultado<{ id: string }>> {
  const d = entrada(AreaInput, input)
  if (invalida(d)) return d
  const a = await acesso(d.slug, "config.write")
  if (a === null) return SEM_ACESSO
  try {
    const id = await withTenant(a.db, a.ctx.organizationId, async (tx) => {
      if (d.id !== undefined) {
        const [row] = await tx.update(area).set({ name: d.name, updatedAt: new Date() }).where(and(eq(area.id, d.id), isNull(area.deletedAt))).returning({ id: area.id })
        if (row === undefined) throw new GatewayAdminError("gateway_not_found", "Área não encontrada.")
        return row.id
      }
      const [row] = await tx.insert(area).values({ organizationId: a.ctx.organizationId, unitId: d.unitId, name: d.name }).returning({ id: area.id })
      if (row === undefined) throw new Error("insert de area sem retorno")
      await auditar(tx, a, { action: "area.create", entityType: "area", entityId: row.id, unitId: d.unitId, after: { name: d.name } })
      return row.id
    })
    revalidar(d.slug)
    return { ok: true, dados: { id } }
  } catch (error) {
    return erroEsperado(error, "salvarArea")
  }
}

const LinhaInput = z.object({ slug: Slug, id: Id.optional(), unitId: Id, areaId: Id.nullable().optional(), name: Nome })

export async function salvarLinhaAction(input: unknown): Promise<Resultado<{ id: string }>> {
  const d = entrada(LinhaInput, input)
  if (invalida(d)) return d
  const a = await acesso(d.slug, "config.write")
  if (a === null) return SEM_ACESSO
  try {
    const id = await withTenant(a.db, a.ctx.organizationId, async (tx) => {
      if (d.id !== undefined) {
        const [row] = await tx
          .update(line)
          .set({ name: d.name, areaId: d.areaId ?? null, updatedAt: new Date() })
          .where(and(eq(line.id, d.id), isNull(line.deletedAt)))
          .returning({ id: line.id, unitId: line.unitId })
        if (row === undefined) throw new GatewayAdminError("gateway_not_found", "Linha não encontrada.")
        await auditar(tx, a, { action: "line.update", entityType: "line", entityId: row.id, unitId: row.unitId, after: { name: d.name } })
        return row.id
      }
      const [row] = await tx
        .insert(line)
        .values({ organizationId: a.ctx.organizationId, unitId: d.unitId, areaId: d.areaId ?? null, name: d.name })
        .returning({ id: line.id })
      if (row === undefined) throw new Error("insert de line sem retorno")
      await auditar(tx, a, { action: "line.create", entityType: "line", entityId: row.id, unitId: d.unitId, after: { name: d.name } })
      return row.id
    })
    revalidar(d.slug)
    return { ok: true, dados: { id } }
  } catch (error) {
    return erroEsperado(error, "salvarLinha")
  }
}

// ---------------------------------------------------------------------------
// Gateways e códigos de ativação
// ---------------------------------------------------------------------------

export interface CodigoGerado {
  readonly gatewayId: string
  readonly code: string
  readonly expiresLabel: string
}

const NovoGatewayInput = z.object({ slug: Slug, unitId: Id, name: Nome })

/** Cadastra o gateway (aguardando ativação) e já gera o código de 24 h. */
export async function criarGatewayAction(input: unknown): Promise<Resultado<CodigoGerado>> {
  const d = entrada(NovoGatewayInput, input)
  if (invalida(d)) return d
  const a = await acesso(d.slug, "config.write")
  if (a === null) return SEM_ACESSO
  try {
    const gatewayId = await withTenant(a.db, a.ctx.organizationId, async (tx) => {
      const [acc] = await tx.select({ limits: clientAccount.limits }).from(clientAccount)
      const limite = acc?.limits.gateways
      if (limite !== undefined) {
        const [n] = await tx.select({ n: count() }).from(gateway).where(isNull(gateway.deletedAt))
        if ((n?.n ?? 0) >= limite) throw new GatewayAdminError("invalid_config", `O contrato cobre ${limite} gateway(s). Para mais, amplie o contrato.`)
      }
      const [row] = await tx.insert(gateway).values({ organizationId: a.ctx.organizationId, unitId: d.unitId, name: d.name }).returning({ id: gateway.id })
      if (row === undefined) throw new Error("insert de gateway sem retorno")
      await auditar(tx, a, { action: "gateway.create", entityType: "gateway", entityId: row.id, unitId: d.unitId, after: { name: d.name } })
      return row.id
    })
    const code = await createActivationCode(a.db, { organizationId: a.ctx.organizationId, gatewayId, actor: atorDoContexto(a.ctx) })
    revalidar(d.slug)
    return { ok: true, dados: { gatewayId, code: code.code, expiresLabel: dateTime(code.expiresAt.toISOString()) } }
  } catch (error) {
    return erroEsperado(error, "criarGateway")
  }
}

const GatewayInput = z.object({ slug: Slug, gatewayId: Id })

/** Gera um código novo (o anterior ainda não usado deixa de valer). O código só aparece aqui, uma vez. */
export async function gerarCodigoAction(input: unknown): Promise<Resultado<CodigoGerado>> {
  const d = entrada(GatewayInput, input)
  if (invalida(d)) return d
  const a = await acesso(d.slug, "config.write")
  if (a === null) return SEM_ACESSO
  try {
    const code = await createActivationCode(a.db, { organizationId: a.ctx.organizationId, gatewayId: d.gatewayId, actor: atorDoContexto(a.ctx) })
    return { ok: true, dados: { gatewayId: d.gatewayId, code: code.code, expiresLabel: dateTime(code.expiresAt.toISOString()) } }
  } catch (error) {
    return erroEsperado(error, "gerarCodigo")
  }
}

/** Publica a config do gateway montada do cadastro atual (sem mudança: `unchanged`). */
export async function publicarConfigAction(input: unknown): Promise<Resultado<{ kind: "published" | "unchanged"; version: number }>> {
  const d = entrada(GatewayInput.extend({ force: z.boolean().optional() }), input)
  if (invalida(d)) return d
  const a = await acesso(d.slug, "config.write")
  if (a === null) return SEM_ACESSO
  try {
    const r = await publishGatewayConfig(a.db, { organizationId: a.ctx.organizationId, gatewayId: d.gatewayId, actor: atorDoContexto(a.ctx), force: d.force })
    revalidar(d.slug)
    return { ok: true, dados: { kind: r.kind, version: r.version } }
  } catch (error) {
    return erroEsperado(error, "publicarConfig")
  }
}

// ---------------------------------------------------------------------------
// Comandos ao gateway (tag.read, device.test, config.reload, agent.restart)
// ---------------------------------------------------------------------------

const PAYLOADS: Partial<Record<CommandType, z.ZodType>> = {
  "tag.read": TagReadPayloadSchema,
  "device.test": DeviceTestPayloadSchema,
  "config.reload": ConfigReloadPayloadSchema,
  "agent.restart": AgentRestartPayloadSchema,
}

const ComandoInput = z.object({
  slug: Slug,
  gatewayId: Id,
  type: z.enum(["tag.read", "device.test", "config.reload", "agent.restart"]),
  payload: z.record(z.string(), z.unknown()).default({}),
})

export async function enviarComandoAction(input: unknown): Promise<Resultado<{ commandId: string }>> {
  const d = entrada(ComandoInput, input)
  if (invalida(d)) return d
  if (!(COMMAND_TYPES as readonly string[]).includes(d.type)) return { ok: false, mensagem: "Comando desconhecido." }
  const schema = PAYLOADS[d.type]
  if (schema !== undefined) {
    const p = schema.safeParse(d.payload)
    if (!p.success) return { ok: false, mensagem: "Parâmetros do comando inválidos.", problemas: issuesFromZodError(p.error).map((i) => ({ campo: i.path.join("."), mensagem: i.message })) }
  }
  const a = await acesso(d.slug, "diagnostics.run")
  if (a === null) return SEM_ACESSO
  try {
    const cmd = await enqueueGatewayCommand(a.db, {
      organizationId: a.ctx.organizationId,
      gatewayId: d.gatewayId,
      type: d.type,
      payload: d.payload,
      actor: atorDoContexto(a.ctx),
    })
    return { ok: true, dados: { commandId: cmd.id } }
  } catch (error) {
    return erroEsperado(error, "enviarComando")
  }
}

export async function consultarComandoAction(input: unknown): Promise<Resultado<ResumoDoComando>> {
  const d = entrada(z.object({ slug: Slug, commandId: Id }), input)
  if (invalida(d)) return d
  const a = await acesso(d.slug, "diagnostics.run")
  if (a === null) return SEM_ACESSO
  const cmd = await getGatewayCommand(a.db, a.ctx.organizationId, d.commandId)
  if (cmd === null) return { ok: false, mensagem: "Comando não encontrado." }
  return { ok: true, dados: resumoDoComando(cmd) }
}

// ---------------------------------------------------------------------------
// Nova máquina: máquina + vínculo com o gateway + CLP + sinais, e publica a config
// ---------------------------------------------------------------------------

const MachineStateEnum = z.enum(["RUNNING", "STOPPED", "FAULT", "SETUP", "PLANNED_STOP"])
const numero = (min: number, max: number) => z.coerce.number().min(min).max(max)

const NovaMaquinaInput = z.object({
  slug: Slug,
  ident: z.object({ name: Nome, code: z.string().trim().max(40).default(""), unitId: Id, lineId: Id }),
  conn: z.object({
    gatewayId: Id,
    protocol: z.enum(["modbus-tcp", "modbus-rtu-over-tcp"], { error: "Nesta etapa, só conexões por rede (Modbus TCP ou RTU sobre TCP)." }),
    host: z.string().trim().min(1, "Informe o IP do CLP.").max(253),
    port: z.coerce.number().int().min(1).max(65535),
    unitId: z.coerce.number().int().min(0).max(255),
    timeoutMs: z.coerce.number().int().min(50).max(10_000),
  }),
  tags: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        role: z.string(),
        area: z.enum(["coil", "discrete_input", "input_register", "holding_register"]),
        address: z.coerce.number().int().min(0).max(65535),
        dataType: z.enum(["bool", "int16", "uint16", "int32", "uint32", "float32"]),
        byteOrder: z.enum(["ABCD", "CDAB", "BADC", "DCBA"]),
        pollMs: z.coerce.number().int().min(100).max(3_600_000),
      }),
    )
    .min(1, "Mapeie pelo menos um sinal.")
    .max(200),
  rules: z.object({
    stateMode: z.enum(["signals", "state_code", "count_derived"]),
    idealCycleS: numero(0.001, 86_400).optional(),
    microStopS: z.coerce.number().int().min(0).max(3600).default(60),
    debounceS: numero(0, 60).optional(),
    commLossS: z.coerce.number().int().min(1).max(3600).optional(),
    idleAfterCycles: numero(1, 1000).optional(),
    stateMap: z.array(z.object({ code: z.string(), state: MachineStateEnum })).default([]),
  }),
})
export type NovaMaquinaEntrada = z.input<typeof NovaMaquinaInput>

const is32 = (t: string) => t === "int32" || t === "uint32" || t === "float32"
const PLACEHOLDER = "00000000-0000-7000-8000-000000000000"

function regrasDeEstado(r: z.infer<typeof NovaMaquinaInput>["rules"]): StateRules {
  const common = { debounce_s: r.debounceS, comm_loss_after_s: r.commLossS }
  if (r.stateMode === "state_code") {
    const map = Object.fromEntries(r.stateMap.map((s) => [s.code.trim(), s.state === "PLANNED_STOP" ? "STOPPED" : s.state]))
    return { mode: "state_code", map, ...common } as StateRules
  }
  if (r.stateMode === "count_derived") return { mode: "count_derived", ideal_cycle_s: r.idealCycleS ?? 1, idle_after_cycles: r.idleAfterCycles, ...common } as StateRules
  return { mode: "signals", ...common } as StateRules
}

export interface MaquinaCriada {
  readonly machineId: string
  readonly gatewayId: string
  readonly version: number
  readonly published: boolean
  readonly pending: boolean
  /** Máquina gravada, mas a config não foi publicada (motivo). */
  readonly aviso?: string
}

export async function criarMaquinaAction(input: unknown): Promise<Resultado<MaquinaCriada>> {
  const d = entrada(NovaMaquinaInput, input)
  if (invalida(d)) return d

  // Valida pelo contrato ANTES de gravar: regras de estado e cada sinal.
  const rules = StateRulesSchema.safeParse(JSON.parse(JSON.stringify(regrasDeEstado(d.rules))))
  if (!rules.success) return { ok: false, mensagem: "Regras de estado inválidas.", problemas: issuesFromZodError(rules.error).map((i) => ({ campo: i.path.join("."), mensagem: i.message })) }
  const tagRows = d.tags.map((t) => ({
    name: t.name,
    address: { area: t.area, offset: t.address },
    type: t.dataType,
    word_order: is32(t.dataType) ? t.byteOrder : undefined,
    poll_ms: t.pollMs,
    role: t.role,
  }))
  for (const [i, t] of tagRows.entries()) {
    const p = TagSchema.safeParse({ id: PLACEHOLDER, ...t, machine_id: t.role === "custom" ? undefined : PLACEHOLDER })
    if (!p.success) {
      return { ok: false, mensagem: `O sinal “${t.name}” não fecha com o contrato: ${p.error.issues[0]?.message ?? "confira"}.`, problemas: [{ campo: `tags.${i}`, mensagem: p.error.issues[0]?.message ?? "" }] }
    }
  }

  const a = await acesso(d.slug, "config.write")
  if (a === null) return SEM_ACESSO
  try {
    const created = await withTenant(a.db, a.ctx.organizationId, async (tx) => {
      const [acc] = await tx.select({ limits: clientAccount.limits }).from(clientAccount)
      const [n] = await tx.select({ n: count() }).from(machine).where(isNull(machine.deletedAt))
      const limite = acc?.limits.machines ?? 0
      if ((n?.n ?? 0) >= limite) throw new GatewayAdminError("invalid_config", `Todas as ${limite} máquinas contratadas já estão cadastradas (cobrança por máquina).`)

      const [gw] = await tx.select({ id: gateway.id, unitId: gateway.unitId, status: gateway.status }).from(gateway).where(and(eq(gateway.id, d.conn.gatewayId), isNull(gateway.deletedAt)))
      if (gw === undefined) throw new GatewayAdminError("gateway_not_found", "Gateway não encontrado.")
      if (gw.status === "revoked") throw new GatewayAdminError("gateway_revoked", "Este gateway foi revogado.")
      if (gw.unitId !== d.ident.unitId) throw new GatewayAdminError("invalid_config", "O gateway precisa ser da mesma unidade da máquina.")

      const [m] = await tx
        .insert(machine)
        .values({
          organizationId: a.ctx.organizationId,
          unitId: d.ident.unitId,
          lineId: d.ident.lineId,
          name: d.ident.name,
          code: d.ident.code === "" ? null : d.ident.code,
          idealCycleS: d.rules.idealCycleS ?? null,
          microStopThresholdS: d.rules.microStopS,
          stateRules: rules.data,
        })
        .returning({ id: machine.id })
      if (m === undefined) throw new Error("insert de machine sem retorno")
      await tx.insert(gatewayMachine).values({ organizationId: a.ctx.organizationId, gatewayId: gw.id, machineId: m.id, unitId: gw.unitId, createdBy: a.ctx.user.id })

      // CLP: reaproveita o do mesmo IP/porta/unit id no gateway; senão cria.
      const params = { host: d.conn.host, port: d.conn.port, unit_id: d.conn.unitId, timeout_ms: d.conn.timeoutMs }
      const existentes = await tx.select({ id: device.id, protocol: device.protocol, params: device.params }).from(device).where(and(eq(device.gatewayId, gw.id), isNull(device.deletedAt)))
      const igual = existentes.find((x) => {
        const p = x.params as { host?: string; port?: number; unit_id?: number }
        return x.protocol === d.conn.protocol && p.host === params.host && p.port === params.port && p.unit_id === params.unit_id
      })
      let deviceId = igual?.id
      if (deviceId === undefined) {
        const [dv] = await tx
          .insert(device)
          .values({ organizationId: a.ctx.organizationId, gatewayId: gw.id, name: `CLP ${d.ident.name}`.slice(0, 120), protocol: d.conn.protocol, params })
          .returning({ id: device.id })
        if (dv === undefined) throw new Error("insert de device sem retorno")
        deviceId = dv.id
      }

      await tx.insert(tag).values(
        tagRows.map((t) => ({
          organizationId: a.ctx.organizationId,
          gatewayId: gw.id,
          deviceId: deviceId!,
          machineId: m.id,
          name: t.name,
          address: t.address,
          dataType: t.type,
          wordOrder: t.word_order ?? null,
          pollMs: t.poll_ms,
          role: t.role as (typeof tag.$inferInsert)["role"],
        })),
      )
      await auditar(tx, a, {
        action: "machine.create",
        entityType: "machine",
        entityId: m.id,
        unitId: d.ident.unitId,
        after: { name: d.ident.name, code: d.ident.code || null, gateway_id: gw.id, device_id: deviceId, tags: tagRows.length, mode: rules.data.mode },
      })
      return { machineId: m.id, gatewayId: gw.id, pending: gw.status !== "active" }
    })

    revalidar(d.slug)
    // A máquina já está gravada: se a publicação falhar, ela fica no cadastro e a config é publicada
    // depois, no detalhe do gateway (sem repetir o cadastro).
    try {
      const pub = await publishGatewayConfig(a.db, { organizationId: a.ctx.organizationId, gatewayId: created.gatewayId, actor: atorDoContexto(a.ctx) })
      return { ok: true, dados: { ...created, version: pub.version, published: pub.kind === "published" } }
    } catch (error) {
      const msg = error instanceof GatewayAdminError ? error.message : "Não foi possível publicar a configuração agora."
      if (!(error instanceof GatewayAdminError)) console.error("[cadastro] publicação depois de criar a máquina", error)
      return { ok: true, dados: { ...created, version: 0, published: false, aviso: `Máquina cadastrada, mas a configuração não foi publicada: ${msg}` } }
    }
  } catch (error) {
    return erroEsperado(error, "criarMaquina")
  }
}

// ---------------------------------------------------------------------------
// Produtos e ciclos ideais (config.write = equipe Engemase, D12; regras em lib/server/config/products.ts)
// ---------------------------------------------------------------------------

const SlugInput = z.object({ slug: Slug })

/** Confere o acesso e roda a regra do cadastro; com sucesso, recarrega as telas do cliente. */
async function cadastro<T>(input: unknown, contexto: string, fn: (a: Acesso) => Promise<Resultado<T>>): Promise<Resultado<T>> {
  const parsed = SlugInput.safeParse(input)
  if (!parsed.success) return SEM_ACESSO
  const a = await acesso(parsed.data.slug, "config.write")
  if (a === null) return SEM_ACESSO
  try {
    const result = await fn(a)
    if (result.ok) revalidar(parsed.data.slug)
    return result
  } catch (error) {
    return erroEsperado(error, contexto)
  }
}

export async function salvarProdutoAction(input: unknown): Promise<Resultado<{ id: string }>> {
  return cadastro(input, "salvarProduto", (a) => salvarProduto(a.db, a.ctx, input))
}

export async function salvarMatrizCiclosAction(input: unknown): Promise<Resultado<{ produtos: number }>> {
  return cadastro(input, "salvarMatrizCiclos", (a) => salvarMatrizCiclos(a.db, a.ctx, input))
}

export async function excluirProdutoAction(input: unknown): Promise<Resultado<{ id: string }>> {
  return cadastro(input, "excluirProduto", (a) => excluirProduto(a.db, a.ctx, (input as { id?: unknown } | null)?.id))
}
