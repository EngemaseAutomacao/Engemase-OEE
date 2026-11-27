/**
 * Publicador de config versionada por gateway (docs/04, "GET /config"; docs/17 §7, passo 8).
 *
 * Monta a config do contrato (`GatewayConfig`) a partir do cadastro (barramentos, dispositivos,
 * tags, máquinas ligadas ao gateway e ajustes do uplink), confere com o `GatewayConfigSchema` e grava
 * um snapshot imutável com a próxima versão (`gateway_config_version`), avançando
 * `gateway.config_version_latest`. O próximo /sync anuncia a versão nova (`config.latest_version`) e
 * o agente a baixa pelo GET /config.
 *
 * - Cadastro que não forma uma config válida → `GatewayAdminError("invalid_config")` com os problemas
 *   (caminho e regra do contrato), e nada é gravado.
 * - Sem mudança em relação à última versão → nada é gravado (`unchanged`), salvo com `force`.
 * - Tudo numa transação do cliente, com a linha do gateway travada: duas publicações simultâneas não
 *   disputam o mesmo número de versão.
 *
 * Ordem das listas: pelo id (UUIDv7, ou seja, pela ordem de criação), estável entre publicações.
 *
 * Entra na config: dispositivos e tags não excluídos; máquinas ligadas ao gateway (`gateway_machine`),
 * ativas e não excluídas; tags de máquina fora dessa lista ficam de fora.
 */
import {
  type Block,
  DEFAULTS,
  type Device,
  type GatewayConfig,
  GatewayConfigSchema,
  issuesFromZodError,
  type Machine,
  type SerialBus,
  type Tag,
  type UplinkSettings,
} from "@engemase/contracts"
import {
  auditLog,
  device,
  gateway,
  gatewayConfigVersion,
  gatewayMachine,
  machine,
  serialBus,
  tag,
  withTenant,
} from "@engemase/db"
import { and, asc, eq, isNull } from "drizzle-orm"
import { type GatewayAdminActor, GatewayAdminError, SYSTEM_ACTOR } from "./admin-errors"
import type { GatewayDb, GatewayTx } from "./types"
import { emOrdem } from "@/lib/server/em-ordem"

/** Uplink padrão quando o gateway não tem ajuste próprio (`gateway.uplink`). */
export const DEFAULT_UPLINK: UplinkSettings = {
  sync_interval_s: DEFAULTS.syncIntervalS,
  max_batch_items: DEFAULTS.maxBatchItems,
}

export interface PublishConfigInput {
  readonly organizationId: string
  readonly gatewayId: string
  readonly actor?: GatewayAdminActor
  readonly now?: Date
  /** Publica uma versão nova mesmo sem mudança (ex.: forçar o agente a reaplicar). */
  readonly force?: boolean
}

export type PublishConfigResult =
  | { readonly kind: "published"; readonly version: number; readonly config: GatewayConfig }
  | { readonly kind: "unchanged"; readonly version: number }

/** Remove chaves com `undefined` (o snapshot vai para JSON; mantém a comparação estável). */
function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null)) as T
}

/**
 * Monta a config (sem gravar) a partir do cadastro do gateway. Lê dentro da transação do cliente.
 * Devolve o objeto ainda não validado: quem chama confere com o `GatewayConfigSchema`.
 */
export async function buildGatewayConfig(
  tx: GatewayTx,
  gw: { readonly id: string; readonly uplink: UplinkSettings | null },
  version: number,
  now: Date,
): Promise<GatewayConfig> {
  const [buses, devices, machines, tags] = await emOrdem([
    tx
      .select()
      .from(serialBus)
      .where(eq(serialBus.gatewayId, gw.id))
      .orderBy(asc(serialBus.id)),
    tx
      .select()
      .from(device)
      .where(and(eq(device.gatewayId, gw.id), isNull(device.deletedAt)))
      .orderBy(asc(device.id)),
    tx
      .select({
        id: machine.id,
        name: machine.name,
        stateRules: machine.stateRules,
        maxRatePerS: machine.maxRatePerS,
      })
      .from(gatewayMachine)
      .innerJoin(machine, eq(machine.id, gatewayMachine.machineId))
      .where(and(eq(gatewayMachine.gatewayId, gw.id), isNull(machine.deletedAt), eq(machine.active, true)))
      .orderBy(asc(machine.id)),
    tx
      .select()
      .from(tag)
      .where(and(eq(tag.gatewayId, gw.id), isNull(tag.deletedAt)))
      .orderBy(asc(tag.id)),
  ])

  const machineIds = new Set(machines.map((m) => m.id))
  const tagsByDevice = new Map<string, Tag[]>()
  for (const t of tags) {
    if (t.machineId !== null && !machineIds.has(t.machineId)) continue // máquina fora da config
    const list = tagsByDevice.get(t.deviceId) ?? []
    list.push(
      compact({
        id: t.id,
        name: t.name ?? undefined,
        address: t.address,
        type: t.dataType,
        word_order: t.wordOrder ?? undefined,
        scale: t.scale ?? undefined,
        poll_ms: t.pollMs ?? undefined,
        role: t.role,
        machine_id: t.machineId ?? undefined,
        sampling: t.sampling ?? undefined,
      }) as Tag,
    )
    tagsByDevice.set(t.deviceId, list)
  }

  const configBuses: SerialBus[] = buses.map(
    (b) =>
      compact({
        id: b.id,
        name: b.name ?? undefined,
        port: b.port,
        baud: b.baud,
        parity: b.parity,
        data_bits: b.dataBits,
        stop_bits: b.stopBits,
      }) as SerialBus,
  )
  const configDevices = devices.map(
    (d) =>
      compact({
        id: d.id,
        name: d.name,
        protocol: d.protocol,
        params: d.params,
        enabled: d.enabled ? undefined : false,
        blocks: d.blocks.length > 0 ? (d.blocks as Block[]) : undefined,
        tags: tagsByDevice.get(d.id) ?? [],
      }) as unknown as Device,
  )
  const configMachines: Machine[] = machines.map(
    (m) =>
      compact({
        id: m.id,
        name: m.name.slice(0, 120),
        state_rules: m.stateRules,
        max_rate_per_s: m.maxRatePerS ?? undefined,
      }) as Machine,
  )

  return {
    config_version: version,
    gateway_id: gw.id,
    generated_at: now.toISOString(),
    serial_buses: configBuses,
    devices: configDevices,
    machines: configMachines,
    uplink: gw.uplink ?? DEFAULT_UPLINK,
  }
}

function hasStringId(value: unknown): value is { id: string } {
  return value !== null && typeof value === "object" && typeof (value as { id?: unknown }).id === "string"
}

/**
 * JSON canônico para comparar configs: chaves em ordem (o jsonb do Postgres não guarda a ordem em que
 * as chaves vieram) e listas de itens com `id` (barramentos, dispositivos, tags, máquinas) ordenadas
 * pelo id — a ordem delas não muda o que o agente faz.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.length > 0 && value.every(hasStringId) ? [...value].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : value
    return `[${items.map(canonicalJson).join(",")}]`
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

/** Config sem os campos que mudam a cada publicação (para saber se houve mudança). */
export function configContent(config: GatewayConfig): string {
  const rest: Record<string, unknown> = { ...config }
  delete rest.config_version
  delete rest.generated_at
  return canonicalJson(rest)
}

export async function publishGatewayConfig(db: GatewayDb, input: PublishConfigInput): Promise<PublishConfigResult> {
  const now = input.now ?? new Date()
  const actor = input.actor ?? SYSTEM_ACTOR

  return withTenant(db, input.organizationId, async (tx) => {
    const [gw] = await tx
      .select({
        id: gateway.id,
        unitId: gateway.unitId,
        status: gateway.status,
        deletedAt: gateway.deletedAt,
        latest: gateway.configVersionLatest,
        uplink: gateway.uplink,
      })
      .from(gateway)
      .where(eq(gateway.id, input.gatewayId))
      .for("update")
    if (gw === undefined) throw new GatewayAdminError("gateway_not_found", "Gateway não encontrado.")
    if (gw.status === "revoked" || gw.deletedAt !== null) {
      throw new GatewayAdminError("gateway_revoked", "Este gateway foi revogado; a config não é mais publicada.")
    }

    const version = gw.latest + 1
    const built = await buildGatewayConfig(tx, gw, version, now)
    const parsed = GatewayConfigSchema.safeParse(built)
    if (!parsed.success) {
      throw new GatewayAdminError(
        "invalid_config",
        "O cadastro deste gateway não forma uma config válida. Corrija os itens apontados e publique de novo.",
        issuesFromZodError(parsed.error),
      )
    }
    const config = parsed.data as GatewayConfig

    if (gw.latest >= 1 && input.force !== true) {
      const [current] = await tx
        .select({ snapshot: gatewayConfigVersion.snapshot })
        .from(gatewayConfigVersion)
        .where(and(eq(gatewayConfigVersion.gatewayId, gw.id), eq(gatewayConfigVersion.version, gw.latest)))
      if (current !== undefined && configContent(current.snapshot) === configContent(config)) {
        return { kind: "unchanged", version: gw.latest }
      }
    }

    await tx.insert(gatewayConfigVersion).values({
      organizationId: input.organizationId,
      gatewayId: gw.id,
      version,
      snapshot: config,
      createdBy: actor.type === "system" ? null : (actor.id ?? null),
      createdAt: now,
    })
    await tx.update(gateway).set({ configVersionLatest: version, updatedAt: now }).where(eq(gateway.id, gw.id))
    await tx.insert(auditLog).values({
      organizationId: input.organizationId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      actorLabel: actor.label ?? null,
      action: "gateway.config_published",
      entityType: "gateway",
      entityId: gw.id,
      unitId: gw.unitId,
      before: { version: gw.latest },
      after: {
        version,
        devices: config.devices.length,
        machines: config.machines.length,
        tags: config.devices.reduce((n, d) => n + d.tags.length, 0),
        serial_buses: config.serial_buses.length,
        forced: input.force === true,
      },
      at: now,
    })
    return { kind: "published", version, config }
  })
}
