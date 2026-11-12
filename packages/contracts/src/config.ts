/**
 * GET /api/gateway/v1/config — configuração completa do gateway, gerada pela nuvem.
 * Ver docs/03-gateway.md (configuração de tags e motor de máquina) e docs/11.
 */
import { z } from "zod"
import { EntityIdSchema, PlcStateSchema, UtcDateTimeSchema } from "./common"
import {
  DEFAULTS,
  MAX_BATCH_ITEMS,
  MAX_DEVICES,
  MAX_MACHINES,
  MAX_MODBUS_OFFSET,
  MAX_SERIAL_BUSES,
  MAX_SYNC_BODY_BYTES,
  MAX_TAGS,
  MIN_POLL_MS_RTU,
} from "./limits"
import {
  BitAreaSchema,
  BitCountSchema,
  type DataType,
  DataTypeSchema,
  INTEGER_TYPES,
  ModbusAddressSchema,
  ModbusOffsetSchema,
  ModbusRtuOverTcpParamsSchema,
  ModbusRtuParamsSchema,
  ModbusTcpParamsSchema,
  NUMERIC_TYPES,
  PollMsSchema,
  RegisterAreaSchema,
  RegisterCountSchema,
  ScaleSchema,
  SerialBusSchema,
  WordOrderSchema,
  addressSpan,
  checkTypedAddress,
} from "./modbus"
import { addRuleIssue } from "./rules"

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** Papéis das tags: dizem ao motor de OEE o que cada sinal significa (docs/03). */
export const TagRoleSchema = z.enum([
  "state.running",
  "state.fault",
  "state.code",
  "fault.code",
  "count.total",
  "count.good",
  "count.reject",
  "product.code",
  "speed.actual",
  "plc.heartbeat",
  "custom",
])
export type TagRole = z.infer<typeof TagRoleSchema>
export const TAG_ROLES = TagRoleSchema.options

/** Papéis de contador. */
export const CounterRoleSchema = z.enum(["count.total", "count.good", "count.reject"])
export type CounterRole = z.infer<typeof CounterRoleSchema>

/** Tipos aceitos por papel. */
export const ROLE_ALLOWED_TYPES: Readonly<Record<TagRole, readonly DataType[]>> = {
  "state.running": ["bool"],
  "state.fault": ["bool"],
  "state.code": INTEGER_TYPES,
  "fault.code": INTEGER_TYPES,
  "count.total": INTEGER_TYPES,
  "count.good": INTEGER_TYPES,
  "count.reject": INTEGER_TYPES,
  "product.code": INTEGER_TYPES,
  "speed.actual": NUMERIC_TYPES,
  "plc.heartbeat": INTEGER_TYPES,
  custom: DataTypeSchema.options,
}

/** Papéis que alimentam o estado/contagem da máquina (entram no cálculo de NO_COMM). */
export function isStateOrCounterRole(role: TagRole): boolean {
  return role.startsWith("state.") || role.startsWith("count.")
}

/** Histórico de amostras (papéis custom e speed.actual): deadband e intervalos. */
export const TagSamplingSchema = z.object({
  deadband: z.number().min(0).optional().describe("Variação mínima para gerar nova amostra"),
  min_interval_s: z.int().min(1).max(86_400).optional(),
  max_interval_s: z.int().min(1).max(86_400).optional(),
})
export type TagSampling = z.infer<typeof TagSamplingSchema>

export const TagSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().max(120).optional(),
    address: ModbusAddressSchema,
    type: DataTypeSchema,
    word_order: WordOrderSchema.optional().describe("Obrigatório para int32/uint32/float32"),
    scale: ScaleSchema.optional(),
    poll_ms: PollMsSchema.optional().describe("Obrigatório para tag fora de bloco; proibido dentro de bloco"),
    role: TagRoleSchema,
    machine_id: EntityIdSchema.optional().describe("Obrigatório exceto para o papel custom"),
    sampling: TagSamplingSchema.optional(),
  })
  .superRefine((tag, ctx) => {
    checkTypedAddress(tag, ctx)
    if (!ROLE_ALLOWED_TYPES[tag.role].includes(tag.type)) {
      addRuleIssue(ctx, "tag.role_type", ["type"], `O papel ${tag.role} não aceita o tipo ${tag.type}.`)
    }
    if (tag.role !== "custom" && tag.machine_id === undefined) {
      addRuleIssue(ctx, "tag.machine_required", ["machine_id"])
    }
    if (tag.sampling !== undefined) {
      if (tag.role !== "custom" && tag.role !== "speed.actual") {
        addRuleIssue(ctx, "tag.sampling_role", ["sampling"])
      }
      const { min_interval_s: min, max_interval_s: max } = tag.sampling
      if (min !== undefined && max !== undefined && min > max) {
        addRuleIssue(ctx, "tag.sampling_interval", ["sampling", "min_interval_s"])
      }
    }
  })
export type Tag = z.infer<typeof TagSchema>

// ---------------------------------------------------------------------------
// Blocos e dispositivos
// ---------------------------------------------------------------------------

const blockFields = {
  start: ModbusOffsetSchema,
  poll_ms: PollMsSchema,
}

/**
 * Leitura em bloco: registradores/bits contíguos lidos numa só transação.
 * Até 125 registradores (FC03/FC04) ou 2000 bits (FC01/FC02) por bloco.
 */
export const BlockSchema = z
  .discriminatedUnion("area", [
    z.object({ area: RegisterAreaSchema, ...blockFields, count: RegisterCountSchema }),
    z.object({ area: BitAreaSchema, ...blockFields, count: BitCountSchema }),
  ])
  .superRefine((block, ctx) => {
    if (block.start + block.count - 1 > MAX_MODBUS_OFFSET) {
      addRuleIssue(ctx, "block.range", ["count"])
    }
  })
export type Block = z.infer<typeof BlockSchema>

const deviceCommon = {
  id: EntityIdSchema,
  name: z.string().max(120).optional(),
  enabled: z.boolean().optional().describe("false = dispositivo cadastrado, mas não lido (padrão: true)"),
  blocks: z.array(BlockSchema).max(256).optional(),
  tags: z.array(TagSchema).max(MAX_TAGS),
}

type DeviceShape = {
  protocol: "modbus-tcp" | "modbus-rtu" | "modbus-rtu-over-tcp"
  blocks?: Block[] | undefined
  tags: Tag[]
}

interface Span {
  lo: number
  hi: number
}

function blockSpan(block: Block): Span {
  return { lo: block.start, hi: block.start + block.count - 1 }
}

function tagSpan(tag: Tag): Span {
  return { lo: tag.address.offset, hi: tag.address.offset + addressSpan(tag.address, tag.type) - 1 }
}

/** Bloco que contém a tag inteira (mesma área), se houver. */
export function containingBlock(blocks: readonly Block[] | undefined, tag: Tag): Block | undefined {
  const t = tagSpan(tag)
  return blocks?.find((b) => b.area === tag.address.area && b.start <= t.lo && t.hi <= blockSpan(b).hi)
}

/** Intervalo de leitura efetivo da tag: o do bloco que a contém ou o da própria tag. */
export function effectivePollMs(device: { blocks?: Block[] | undefined }, tag: Tag): number | undefined {
  return containingBlock(device.blocks, tag)?.poll_ms ?? tag.poll_ms
}

function refineDevice(device: DeviceShape, ctx: z.RefinementCtx): void {
  const blocks = device.blocks ?? []

  blocks.forEach((a, i) => {
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j]
      if (b === undefined || a.area !== b.area) continue
      const sa = blockSpan(a)
      const sb = blockSpan(b)
      if (sa.lo <= sb.hi && sb.lo <= sa.hi) {
        addRuleIssue(ctx, "block.overlap", ["blocks", j])
      }
    }
  })

  device.tags.forEach((tag, i) => {
    const t = tagSpan(tag)
    const sameArea = blocks.filter((b) => b.area === tag.address.area)
    const inside = sameArea.some((b) => b.start <= t.lo && t.hi <= blockSpan(b).hi)
    const partial = !inside && sameArea.some((b) => t.lo <= blockSpan(b).hi && b.start <= t.hi)
    if (partial) {
      addRuleIssue(ctx, "tag.block_partial", ["tags", i, "address", "offset"])
    } else if (inside && tag.poll_ms !== undefined) {
      addRuleIssue(ctx, "tag.poll_source", ["tags", i, "poll_ms"], "Tag dentro de bloco não pode ter poll_ms (vale o do bloco).")
    } else if (!inside && tag.poll_ms === undefined) {
      addRuleIssue(ctx, "tag.poll_source", ["tags", i, "poll_ms"], "Tag fora de bloco exige poll_ms.")
    }
  })

  if (device.protocol === "modbus-rtu") {
    blocks.forEach((b, i) => {
      if (b.poll_ms < MIN_POLL_MS_RTU) addRuleIssue(ctx, "poll.rtu_min", ["blocks", i, "poll_ms"])
    })
    device.tags.forEach((tag, i) => {
      if (tag.poll_ms !== undefined && tag.poll_ms < MIN_POLL_MS_RTU) {
        addRuleIssue(ctx, "poll.rtu_min", ["tags", i, "poll_ms"])
      }
    })
  }
}

export const ModbusTcpDeviceSchema = z
  .object({ ...deviceCommon, protocol: z.literal("modbus-tcp"), params: ModbusTcpParamsSchema })
  .superRefine(refineDevice)
export const ModbusRtuDeviceSchema = z
  .object({ ...deviceCommon, protocol: z.literal("modbus-rtu"), params: ModbusRtuParamsSchema })
  .superRefine(refineDevice)
export const ModbusRtuOverTcpDeviceSchema = z
  .object({ ...deviceCommon, protocol: z.literal("modbus-rtu-over-tcp"), params: ModbusRtuOverTcpParamsSchema })
  .superRefine(refineDevice)

/** Dispositivo (CLP, módulo de I/O ou escravo RTU) com blocos e tags. */
export const DeviceSchema = z.discriminatedUnion("protocol", [
  ModbusTcpDeviceSchema,
  ModbusRtuDeviceSchema,
  ModbusRtuOverTcpDeviceSchema,
])
export type Device = z.infer<typeof DeviceSchema>

// ---------------------------------------------------------------------------
// Máquinas e regras de estado
// ---------------------------------------------------------------------------

const stateRulesCommon = {
  comm_loss_after_s: z
    .int()
    .min(1)
    .max(3600)
    .optional()
    .describe("Segundos sem leitura boa até NO_COMM (padrão: 10)"),
  debounce_s: z.number().min(0).max(60).optional().describe("Debounce de mudança de estado (padrão: 1 s)"),
  heartbeat_timeout_s: z
    .int()
    .min(1)
    .max(3600)
    .optional()
    .describe("Heartbeat parado por mais que isso vira NO_COMM (exige tag plc.heartbeat)"),
}

/** Código de estado do CLP como chave do mapa (inteiro em texto, ex.: "0", "5", "-1"). */
export const StateCodeKeySchema = z.string().regex(/^(?:0|-?[1-9]\d{0,9})$/, "código de estado deve ser um inteiro")

export const SignalsStateRulesSchema = z.object({
  mode: z.literal("signals"),
  ...stateRulesCommon,
})

export const StateCodeStateRulesSchema = z.object({
  mode: z.literal("state_code"),
  map: z.record(StateCodeKeySchema, PlcStateSchema).describe("Código do CLP → estado OEE"),
  default_state: PlcStateSchema.optional().describe("Estado para códigos fora do mapa (padrão: STOPPED)"),
  ...stateRulesCommon,
})

export const CountDerivedStateRulesSchema = z.object({
  mode: z.literal("count_derived"),
  ideal_cycle_s: z.number().positive().max(86_400).describe("Tempo de ciclo ideal (s)"),
  idle_after_cycles: z.number().min(1).max(1000).optional().describe("Ciclos sem peça até parada (padrão: 3)"),
  ...stateRulesCommon,
})

/** Modos de determinação do estado (docs/03): signals, state_code e count_derived. */
export const StateRulesSchema = z.discriminatedUnion("mode", [
  SignalsStateRulesSchema,
  StateCodeStateRulesSchema,
  CountDerivedStateRulesSchema,
])
export type StateRules = z.infer<typeof StateRulesSchema>
export type StateMode = StateRules["mode"]

export const MachineSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().max(120).optional(),
    state_rules: StateRulesSchema,
    max_rate_per_s: z
      .number()
      .positive()
      .max(100_000)
      .optional()
      .describe("Taxa máxima plausível de peças/s (sanidade dos contadores)"),
  })
  .superRefine((machine, ctx) => {
    const rules = machine.state_rules
    if (rules.mode === "state_code" && Object.keys(rules.map).length === 0) {
      addRuleIssue(ctx, "machine.state_map", ["state_rules", "map"])
    }
  })
export type Machine = z.infer<typeof MachineSchema>

/** Papéis obrigatórios por modo de estado. */
export const REQUIRED_ROLES_BY_MODE: Readonly<Record<StateMode, readonly TagRole[]>> = {
  signals: ["state.running"],
  state_code: ["state.code"],
  count_derived: ["count.total"],
}

// ---------------------------------------------------------------------------
// Uplink e config completa
// ---------------------------------------------------------------------------

export const UplinkSettingsSchema = z.object({
  sync_interval_s: z.int().min(1).max(300).describe("Intervalo do /sync em segundos (padrão: 10)"),
  max_batch_items: z.int().min(1).max(MAX_BATCH_ITEMS).describe("Máximo de itens (events + minutes + samples) por lote"),
  max_batch_bytes: z.int().min(1024).max(MAX_SYNC_BODY_BYTES).optional().describe("Máximo de bytes do JSON descompactado"),
})
export type UplinkSettings = z.infer<typeof UplinkSettingsSchema>

function checkUnique<T>(
  items: readonly T[],
  key: (item: T) => string,
  onDuplicate: (index: number) => void,
): void {
  const seen = new Set<string>()
  items.forEach((item, i) => {
    const k = key(item)
    if (seen.has(k)) onDuplicate(i)
    else seen.add(k)
  })
}

export const GatewayConfigSchema = z
  .object({
    config_version: z.int().min(1).describe("Versão monotônica da config (aumenta a cada publicação)"),
    gateway_id: EntityIdSchema.optional(),
    generated_at: UtcDateTimeSchema.optional(),
    serial_buses: z.array(SerialBusSchema).max(MAX_SERIAL_BUSES),
    devices: z.array(DeviceSchema).max(MAX_DEVICES),
    machines: z.array(MachineSchema).max(MAX_MACHINES),
    uplink: UplinkSettingsSchema,
  })
  .superRefine((config, ctx) => {
    const { serial_buses: buses, devices, machines } = config

    // Unicidade de ids e portas
    checkUnique(buses, (b) => b.id, (i) => addRuleIssue(ctx, "ids.unique", ["serial_buses", i, "id"]))
    checkUnique(buses, (b) => b.port, (i) => addRuleIssue(ctx, "bus.port_unique", ["serial_buses", i, "port"]))
    checkUnique(devices, (d) => d.id, (i) => addRuleIssue(ctx, "ids.unique", ["devices", i, "id"]))
    checkUnique(machines, (m) => m.id, (i) => addRuleIssue(ctx, "ids.unique", ["machines", i, "id"]))

    const tagIds = new Set<string>()
    let tagCount = 0
    devices.forEach((device, d) => {
      device.tags.forEach((tag, t) => {
        tagCount++
        if (tagIds.has(tag.id)) addRuleIssue(ctx, "ids.unique", ["devices", d, "tags", t, "id"])
        tagIds.add(tag.id)
      })
    })
    if (tagCount > MAX_TAGS) addRuleIssue(ctx, "limits.tags", ["devices"])

    // Barramentos e endpoints
    const busIds = new Set(buses.map((b) => b.id))
    const unitsByBus = new Set<string>()
    const tcpEndpoints = new Set<string>()
    // Um endpoint (host:porta) é um servidor Modbus TCP OU um conversor RTU sobre TCP, nunca os dois.
    const endpointProtocol = new Map<string, string>()
    devices.forEach((device, d) => {
      if (device.protocol === "modbus-rtu") {
        if (!busIds.has(device.params.bus)) addRuleIssue(ctx, "bus.ref", ["devices", d, "params", "bus"])
        const key = `${device.params.bus}#${device.params.unit_id}`
        if (unitsByBus.has(key)) addRuleIssue(ctx, "bus.unit_unique", ["devices", d, "params", "unit_id"])
        unitsByBus.add(key)
      } else {
        const endpoint = `${device.params.host.toLowerCase()}:${device.params.port}`
        const seen = endpointProtocol.get(endpoint)
        if (seen === undefined) endpointProtocol.set(endpoint, device.protocol)
        else if (seen !== device.protocol) addRuleIssue(ctx, "tcp.endpoint_protocol", ["devices", d, "protocol"])
        const key = `${endpoint}#${device.params.unit_id}`
        if (tcpEndpoints.has(key)) addRuleIssue(ctx, "tcp.endpoint_unique", ["devices", d, "params"])
        tcpEndpoints.add(key)
      }
    })

    // Tags × máquinas
    const machineIds = new Set(machines.map((m) => m.id))
    const rolesByMachine = new Map<string, Set<TagRole>>()
    const maxPollByMachine = new Map<string, number>()
    devices.forEach((device, d) => {
      device.tags.forEach((tag, t) => {
        if (tag.machine_id === undefined) return
        if (!machineIds.has(tag.machine_id)) {
          addRuleIssue(ctx, "tag.machine_ref", ["devices", d, "tags", t, "machine_id"])
          return
        }
        const roles = rolesByMachine.get(tag.machine_id) ?? new Set<TagRole>()
        if (tag.role !== "custom" && roles.has(tag.role)) {
          addRuleIssue(ctx, "tag.role_unique", ["devices", d, "tags", t, "role"])
        }
        roles.add(tag.role)
        rolesByMachine.set(tag.machine_id, roles)
        const poll = effectivePollMs(device, tag)
        if (isStateOrCounterRole(tag.role) && poll !== undefined) {
          maxPollByMachine.set(tag.machine_id, Math.max(maxPollByMachine.get(tag.machine_id) ?? 0, poll))
        }
      })
    })

    machines.forEach((machine, m) => {
      const roles = rolesByMachine.get(machine.id) ?? new Set<TagRole>()
      const rules = machine.state_rules
      const missing = REQUIRED_ROLES_BY_MODE[rules.mode].filter((r) => !roles.has(r))
      if (missing.length > 0) {
        addRuleIssue(
          ctx,
          "machine.mode_roles",
          ["machines", m, "state_rules", "mode"],
          `O modo ${rules.mode} exige tag com papel ${missing.join(", ")} na máquina ${machine.id}.`,
        )
      }
      const commLossS = rules.comm_loss_after_s ?? DEFAULTS.commLossAfterS
      const maxPoll = maxPollByMachine.get(machine.id)
      if (maxPoll !== undefined && commLossS * 1000 < 3 * maxPoll) {
        addRuleIssue(ctx, "machine.comm_loss", ["machines", m, "state_rules", "comm_loss_after_s"])
      }
      if (rules.heartbeat_timeout_s !== undefined && !roles.has("plc.heartbeat")) {
        addRuleIssue(ctx, "machine.heartbeat", ["machines", m, "state_rules", "heartbeat_timeout_s"])
      }
    })
  })
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>
