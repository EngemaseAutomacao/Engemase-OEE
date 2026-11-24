/**
 * Fila de comandos nuvem → gateway (docs/04, "Tipos de comando"), lado da web.
 *
 * O caminho completo:
 * 1. a web enfileira (`enqueueGatewayCommand`): valida o tipo e o payload pelo contrato v1, confere
 *    que dispositivo/barramento citados são do gateway e grava `gateway_command` (`pending`), com a
 *    validade padrão do tipo (`DEFAULT_COMMAND_TTL_S`, no máximo 24 h);
 * 2. o próximo /sync do gateway leva o comando na resposta (`sent`) e entra no modo interativo
 *    (`next_sync_s = 1` por até 5 min), ver `sync.ts`;
 * 3. o agente executa e devolve o resultado no /sync seguinte (`command_results`): o comando vira
 *    `ok`, `error`, `rejected` ou `expired`, com o resultado inteiro em `result`;
 * 4. a tela acompanha por `getGatewayCommand` (ou cancela um comando ainda não respondido com
 *    `cancelGatewayCommand`; o resultado que chegar depois é ignorado).
 *
 * Comando vencido sem resposta vira `expired` no /sync do gateway ou no cron de expiração.
 */
import {
  COMMAND_TYPES,
  type CommandType,
  CommandSchema,
  DEFAULT_COMMAND_TTL_S,
  issuesFromZodError,
  MAX_COMMAND_TTL_MS,
} from "@engemase/contracts"
import { auditLog, type CommandStatus, device, gateway, gatewayCommand, serialBus, withTenant } from "@engemase/db"
import { and, count, eq, inArray, isNull } from "drizzle-orm"
import { type GatewayAdminActor, GatewayAdminError, SYSTEM_ACTOR } from "./admin-errors"
import type { GatewayDb, GatewayTx } from "./types"

/** Máximo de comandos em aberto (`pending`/`sent`) por gateway: protege a fila de uma tela em laço. */
export const MAX_OPEN_COMMANDS_PER_GATEWAY = 50

const OPEN_STATUSES = ["pending", "sent"] as const

export interface EnqueueCommandInput {
  readonly organizationId: string
  readonly gatewayId: string
  readonly type: CommandType
  readonly payload: Record<string, unknown>
  /** Validade em segundos (padrão: a do tipo; máximo 24 h). */
  readonly ttlS?: number
  readonly actor?: GatewayAdminActor
  readonly now?: Date
}

export interface GatewayCommandView {
  readonly id: string
  readonly gatewayId: string
  readonly type: string
  readonly payload: Record<string, unknown>
  readonly status: CommandStatus
  readonly result: Record<string, unknown> | null
  readonly errorCode: string | null
  readonly createdAt: Date
  readonly sentAt: Date | null
  readonly completedAt: Date | null
  readonly expiresAt: Date
}

const VIEW_COLUMNS = {
  id: gatewayCommand.id,
  gatewayId: gatewayCommand.gatewayId,
  type: gatewayCommand.type,
  payload: gatewayCommand.payload,
  status: gatewayCommand.status,
  result: gatewayCommand.result,
  errorCode: gatewayCommand.errorCode,
  createdAt: gatewayCommand.createdAt,
  sentAt: gatewayCommand.sentAt,
  completedAt: gatewayCommand.completedAt,
  expiresAt: gatewayCommand.expiresAt,
}

/** Placeholder de id só para validar o envelope antes de o banco gerar o id de verdade. */
const PLACEHOLDER_ID = "00000000-0000-7000-8000-000000000000"

/** Ids de dispositivo/barramento citados no payload (para conferir que são do gateway). */
function references(type: CommandType, payload: Record<string, unknown>): { devices: string[]; buses: string[] } {
  const devices: string[] = []
  const buses: string[] = []
  const str = (v: unknown) => (typeof v === "string" ? v : undefined)
  const deviceId = str(payload.device_id)
  if ((type === "tag.read" || type === "device.test" || type === "modbus.scan") && deviceId !== undefined) {
    devices.push(deviceId)
  }
  if (type === "modbus.scan") {
    const busId = str(payload.bus_id)
    if (busId !== undefined) buses.push(busId)
  }
  if (type === "device.test") {
    const bus = payload.serial_bus as { id?: unknown } | undefined
    const connection = payload.connection as { params?: { bus?: unknown } } | undefined
    // Barramento novo (ainda não cadastrado) pode vir em `serial_bus`; o citado só em `params.bus` precisa existir.
    const paramsBus = str(connection?.params?.bus)
    if (paramsBus !== undefined && str(bus?.id) !== paramsBus) buses.push(paramsBus)
  }
  if (type === "ot.forward.open") {
    const fwdDevice = str(payload.device_id)
    if (fwdDevice !== undefined && !devices.includes(fwdDevice)) devices.push(fwdDevice)
  }
  return { devices, buses }
}

async function assertReferencesBelong(
  tx: GatewayTx,
  gatewayId: string,
  refs: { devices: string[]; buses: string[] },
): Promise<void> {
  const missing: string[] = []
  if (refs.devices.length > 0) {
    const found = await tx
      .select({ id: device.id })
      .from(device)
      .where(and(eq(device.gatewayId, gatewayId), inArray(device.id, refs.devices), isNull(device.deletedAt)))
    const ok = new Set(found.map((r) => r.id.toLowerCase()))
    for (const id of refs.devices) if (!ok.has(id.toLowerCase())) missing.push(`dispositivo ${id}`)
  }
  if (refs.buses.length > 0) {
    const found = await tx
      .select({ id: serialBus.id })
      .from(serialBus)
      .where(and(eq(serialBus.gatewayId, gatewayId), inArray(serialBus.id, refs.buses)))
    const ok = new Set(found.map((r) => r.id.toLowerCase()))
    for (const id of refs.buses) if (!ok.has(id.toLowerCase())) missing.push(`barramento ${id}`)
  }
  if (missing.length > 0) {
    throw new GatewayAdminError("unknown_reference", `O comando cita item que não é deste gateway: ${missing.join(", ")}.`)
  }
}

/** Enfileira um comando para o gateway. Devolve o comando como gravado (`pending`). */
export async function enqueueGatewayCommand(db: GatewayDb, input: EnqueueCommandInput): Promise<GatewayCommandView> {
  const now = input.now ?? new Date()
  const actor = input.actor ?? SYSTEM_ACTOR
  if (!(COMMAND_TYPES as readonly string[]).includes(input.type)) {
    throw new GatewayAdminError("invalid_command", `Tipo de comando desconhecido: ${String(input.type)}.`)
  }
  const ttlMs = (input.ttlS ?? DEFAULT_COMMAND_TTL_S[input.type]) * 1000
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_COMMAND_TTL_MS) {
    throw new GatewayAdminError("invalid_command", "Validade do comando fora de 1 s a 24 h.")
  }
  const expiresAt = new Date(now.getTime() + ttlMs)
  // Mesmo schema que o /sync usa antes de entregar: o que passa aqui chega ao agente.
  const parsed = CommandSchema.safeParse({
    id: PLACEHOLDER_ID,
    type: input.type,
    payload: input.payload,
    issued_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  })
  if (!parsed.success) {
    throw new GatewayAdminError("invalid_command", "Comando fora do contrato v1.", issuesFromZodError(parsed.error))
  }
  const payload = parsed.data.payload as Record<string, unknown>

  return withTenant(db, input.organizationId, async (tx) => {
    const [gw] = await tx
      .select({ id: gateway.id, status: gateway.status, unitId: gateway.unitId, deletedAt: gateway.deletedAt })
      .from(gateway)
      .where(eq(gateway.id, input.gatewayId))
      .for("update")
    if (gw === undefined) throw new GatewayAdminError("gateway_not_found", "Gateway não encontrado.")
    if (gw.status === "revoked" || gw.deletedAt !== null) {
      throw new GatewayAdminError("gateway_revoked", "Este gateway foi revogado; não recebe mais comandos.")
    }
    if (gw.status !== "active") {
      throw new GatewayAdminError("gateway_not_active", "Este gateway ainda não foi ativado; ative-o antes de enviar comandos.")
    }
    await assertReferencesBelong(tx, gw.id, references(input.type, payload))

    const [open] = await tx
      .select({ n: count() })
      .from(gatewayCommand)
      .where(and(eq(gatewayCommand.gatewayId, gw.id), inArray(gatewayCommand.status, [...OPEN_STATUSES])))
    if ((open?.n ?? 0) >= MAX_OPEN_COMMANDS_PER_GATEWAY) {
      throw new GatewayAdminError(
        "too_many_open_commands",
        `Há ${MAX_OPEN_COMMANDS_PER_GATEWAY} comandos esperando este gateway. Aguarde as respostas ou cancele alguns.`,
      )
    }

    const [row] = await tx
      .insert(gatewayCommand)
      .values({
        organizationId: input.organizationId,
        gatewayId: gw.id,
        type: input.type,
        payload,
        status: "pending",
        createdBy: actor.type === "system" ? null : (actor.id ?? null),
        createdAt: now,
        expiresAt,
      })
      .returning(VIEW_COLUMNS)
    if (row === undefined) throw new Error("insert de gateway_command sem retorno")

    await tx.insert(auditLog).values({
      organizationId: input.organizationId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      actorLabel: actor.label ?? null,
      action: "gateway.command_created",
      entityType: "gateway",
      entityId: gw.id,
      unitId: gw.unitId,
      // Payload sem segredos: vpn.enable leva `auth_key` de uso único, que nunca vai para a auditoria.
      after: { command_id: row.id, type: input.type, expires_at: expiresAt.toISOString(), payload: redactPayload(payload) },
      at: now,
    })
    return row
  })
}

/** Campos de payload que são segredo (nunca na auditoria). */
const SECRET_FIELDS = new Set(["auth_key", "approval"])

function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, SECRET_FIELDS.has(k) ? "[omitido]" : v]))
}

/** Comando do cliente pelo id (`null` se não existe ou é de outro cliente). */
export async function getGatewayCommand(
  db: GatewayDb,
  organizationId: string,
  commandId: string,
): Promise<GatewayCommandView | null> {
  return withTenant(db, organizationId, async (tx) => {
    const [row] = await tx.select(VIEW_COLUMNS).from(gatewayCommand).where(eq(gatewayCommand.id, commandId))
    return row ?? null
  })
}

/**
 * Cancela um comando ainda sem resposta (`pending` ou `sent`). Se o agente já o recebeu, ele pode
 * executar mesmo assim; o resultado que chegar depois é ignorado (só comandos em aberto aceitam).
 */
export async function cancelGatewayCommand(
  db: GatewayDb,
  input: { readonly organizationId: string; readonly commandId: string; readonly actor?: GatewayAdminActor; readonly now?: Date },
): Promise<GatewayCommandView> {
  const now = input.now ?? new Date()
  const actor = input.actor ?? SYSTEM_ACTOR
  return withTenant(db, input.organizationId, async (tx) => {
    const [current] = await tx
      .select({ ...VIEW_COLUMNS, unitId: gateway.unitId })
      .from(gatewayCommand)
      .innerJoin(gateway, eq(gateway.id, gatewayCommand.gatewayId))
      .where(eq(gatewayCommand.id, input.commandId))
      .for("update", { of: gatewayCommand })
    if (current === undefined) throw new GatewayAdminError("command_not_found", "Comando não encontrado.")
    if (!(OPEN_STATUSES as readonly string[]).includes(current.status)) {
      throw new GatewayAdminError("command_finished", "Este comando já terminou e não pode ser cancelado.")
    }
    const [row] = await tx
      .update(gatewayCommand)
      .set({ status: "cancelled", completedAt: now })
      .where(eq(gatewayCommand.id, input.commandId))
      .returning(VIEW_COLUMNS)
    if (row === undefined) throw new Error("update de gateway_command sem retorno")
    await tx.insert(auditLog).values({
      organizationId: input.organizationId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      actorLabel: actor.label ?? null,
      action: "gateway.command_cancelled",
      entityType: "gateway",
      entityId: current.gatewayId,
      unitId: current.unitId,
      before: { command_id: current.id, status: current.status },
      after: { command_id: current.id, status: "cancelled" },
      at: now,
    })
    return row
  })
}
