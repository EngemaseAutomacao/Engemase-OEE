/**
 * POST /api/gateway/v1/sync — ciclo principal: dados, saúde e resultados de comandos
 * (requisição) → ack, comandos e versão de config (resposta). Ver docs/04.
 */
import { z } from "zod"
import { CommandResultSchema, CommandSchema } from "./commands"
import {
  CounterRawSchema,
  EntityIdSchema,
  MachineStateSchema,
  MinuteStartSchema,
  NonNegativeIntSchema,
  ProductCodeSchema,
  QualitySchema,
  SemverSchema,
  SeqSchema,
  ShortTextSchema,
  UtcDateTimeSchema,
  UuidV7Schema,
} from "./common"
import { CounterRoleSchema } from "./config"
import {
  MAX_BATCH_ITEMS,
  MAX_COMMAND_RESULTS,
  MAX_COMMANDS_PER_SYNC,
  MAX_COUNT_PER_MINUTE,
  MAX_DEVICES,
  MAX_LIVE_ITEMS,
  MAX_SERIAL_BUSES,
  SECONDS_PER_MINUTE,
} from "./limits"
import { addRuleIssue } from "./rules"

// ---------------------------------------------------------------------------
// Lote
// ---------------------------------------------------------------------------

/**
 * Cabeçalho do lote. `seq_from`–`seq_to` cobre a fila principal (eventos e minutos).
 * Amostras podem ter fila própria (`samples_seq_from`–`samples_seq_to`, confirmada por
 * `ack_samples_seq`); sem ela, as amostras usam a mesma faixa da fila principal.
 * Sync só de saúde (sem itens) envia apenas `sent_at`.
 */
export const BatchSchema = z.object({
  seq_from: SeqSchema.optional(),
  seq_to: SeqSchema.optional(),
  samples_seq_from: SeqSchema.optional(),
  samples_seq_to: SeqSchema.optional(),
  sent_at: UtcDateTimeSchema,
})
export type Batch = z.infer<typeof BatchSchema>

// ---------------------------------------------------------------------------
// Saúde do agente, dispositivos e barramentos
// ---------------------------------------------------------------------------

export const ConfigStatusSchema = z.object({
  version: NonNegativeIntSchema,
  state: z.enum(["applying", "observing", "applied", "rejected", "reverted"]),
  error: ShortTextSchema.optional(),
  at: UtcDateTimeSchema.optional(),
})
export type ConfigStatus = z.infer<typeof ConfigStatusSchema>

export const AgentHealthSchema = z.object({
  version: SemverSchema,
  uptime_s: NonNegativeIntSchema,
  config_version: NonNegativeIntSchema.describe("Versão da config aplicada (0 = nenhuma)"),
  cpu_pct: z.number().min(0).max(100),
  mem_mb: z.number().min(0),
  disk_free_mb: z.number().min(0),
  buffer_pending: NonNegativeIntSchema.describe("Itens da fila principal ainda não confirmados"),
  clock_offset_ms: z.int().describe("server_time − relógio local (ms), filtrado"),
  // Campos opcionais (compatíveis com v1)
  config_status: ConfigStatusSchema.optional(),
  buffer_oldest_s: NonNegativeIntSchema.optional(),
  samples_pending: NonNegativeIntSchema.optional(),
  quarantined: NonNegativeIntSchema.optional(),
  temp_c: z.number().min(-60).max(200).optional(),
  emmc_wear_pct: z.number().min(0).max(100).optional(),
  ntp_synced: z.boolean().optional(),
  boot_id: z.uuid().optional(),
  unclean_boots_24h: NonNegativeIntSchema.optional(),
})
export type AgentHealth = z.infer<typeof AgentHealthSchema>

export const DeviceConnStatusSchema = z.enum(["connected", "degraded", "disconnected", "disabled"])
export type DeviceConnStatus = z.infer<typeof DeviceConnStatusSchema>

export const DeviceHealthSchema = z.object({
  id: EntityIdSchema,
  status: DeviceConnStatusSchema,
  latency_ms: NonNegativeIntSchema.optional().describe("Latência média no último minuto"),
  errors_1m: NonNegativeIntSchema,
  timeouts_1m: NonNegativeIntSchema.optional(),
  exceptions_1m: z
    .record(z.string().regex(/^\d{1,3}$/), NonNegativeIntSchema)
    .optional()
    .describe("Contagem de exceções Modbus no último minuto, por código"),
  last_ok_at: UtcDateTimeSchema.optional(),
  last_error: ShortTextSchema.optional(),
})
export type DeviceHealth = z.infer<typeof DeviceHealthSchema>

export const BusHealthSchema = z.object({
  id: EntityIdSchema,
  status: z.enum(["ok", "degraded", "port_unavailable"]),
  cycle_ms: NonNegativeIntSchema.optional(),
  busy_pct: z.number().min(0).max(100).optional(),
  overruns_1m: NonNegativeIntSchema.optional(),
  unsolicited_bytes_1m: NonNegativeIntSchema.optional().describe("Bytes sem requisição nossa: indício de 2º mestre"),
})
export type BusHealth = z.infer<typeof BusHealthSchema>

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

const eventBase = {
  id: UuidV7Schema,
  seq: SeqSchema,
  at: UtcDateTimeSchema.describe("Instante do fato (para estado: início do candidato, não a confirmação)"),
}

const FaultCodeSchema = z.int().min(0).max(4_294_967_295)

export const StateEventSchema = z.object({
  ...eventBase,
  type: z.literal("state"),
  machine_id: EntityIdSchema,
  state: MachineStateSchema,
  fault_code: FaultCodeSchema.optional(),
  previous_state: MachineStateSchema.optional(),
})

export const ProductEventSchema = z.object({
  ...eventBase,
  type: z.literal("product"),
  machine_id: EntityIdSchema,
  product: ProductCodeSchema,
  previous_product: ProductCodeSchema.optional(),
})

const counterEventFields = {
  machine_id: EntityIdSchema,
  tag_id: EntityIdSchema,
  role: CounterRoleSchema,
}

export const CounterResetEventSchema = z.object({
  ...eventBase,
  type: z.literal("counter_reset"),
  ...counterEventFields,
  previous_raw: CounterRawSchema,
  raw: CounterRawSchema,
})

export const CounterJumpEventSchema = z.object({
  ...eventBase,
  type: z.literal("counter_jump"),
  ...counterEventFields,
  previous_raw: CounterRawSchema,
  raw: CounterRawSchema,
  discarded_delta: CounterRawSchema,
})

export const CounterRebaselineEventSchema = z.object({
  ...eventBase,
  type: z.literal("counter_rebaseline"),
  ...counterEventFields,
  previous_raw: CounterRawSchema.optional(),
  raw: CounterRawSchema,
})

export const AgentStartEventSchema = z.object({
  ...eventBase,
  type: z.literal("agent_start"),
  version: SemverSchema,
  boot_id: z.uuid().optional(),
  clean_shutdown: z.boolean().describe("O desligamento anterior foi limpo?"),
})

export const AgentStopEventSchema = z.object({
  ...eventBase,
  type: z.literal("agent_stop"),
  reason: z.enum(["shutdown", "restart", "update", "error"]),
  detail: ShortTextSchema.optional(),
})

/** Falta de energia detectada (sinal do UPS) ou deduzida no boot seguinte. */
export const PowerLossEventSchema = z.object({
  ...eventBase,
  type: z.literal("power_loss"),
})

export const PowerRestoredEventSchema = z.object({
  ...eventBase,
  type: z.literal("power_restored"),
  down_s: NonNegativeIntSchema.optional(),
})

export const ClockJumpEventSchema = z.object({
  ...eventBase,
  type: z.literal("clock_jump"),
  jump_ms: z.int().describe("Salto do relógio de parede (positivo = para frente)"),
})

export const DataLossEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("data_loss"),
    reason: z.enum(["retention_limit", "buffer_corrupted", "quarantine_expired"]),
    lost_seq_from: SeqSchema,
    lost_seq_to: SeqSchema,
    items: z.int().min(1),
    period_from: UtcDateTimeSchema,
    period_to: UtcDateTimeSchema,
  })
  .superRefine((e, ctx) => {
    if (e.lost_seq_from > e.lost_seq_to) addRuleIssue(ctx, "interval.order", ["lost_seq_to"])
    if (Date.parse(e.period_from) > Date.parse(e.period_to)) addRuleIssue(ctx, "interval.order", ["period_to"])
  })

export const BufferCorruptedEventSchema = z.object({
  ...eventBase,
  type: z.literal("buffer_corrupted"),
  detail: ShortTextSchema.optional(),
})

export const ConfigAppliedEventSchema = z.object({
  ...eventBase,
  type: z.literal("config_applied"),
  version: z.int().min(1),
  previous_version: NonNegativeIntSchema.optional(),
})

export const ConfigRejectedEventSchema = z.object({
  ...eventBase,
  type: z.literal("config_rejected"),
  version: z.int().min(1),
  error: ShortTextSchema,
  reverted_to: NonNegativeIntSchema.optional(),
})

export const RemoteAccessEventSchema = z.object({
  ...eventBase,
  type: z.literal("remote_access"),
  action: z.enum([
    "session_started",
    "session_ended",
    "ssh_login",
    "ssh_logout",
    "forward_opened",
    "forward_closed",
    "policy_blocked",
  ]),
  session_id: EntityIdSchema,
  forward_id: EntityIdSchema.optional(),
  actor: z.string().max(200).optional().describe("Identidade do técnico (principal do certificado SSH)"),
  detail: ShortTextSchema.optional(),
})

/**
 * Eventos da borda. `state` alimenta `machine_state_event`; os demais servem para
 * auditoria e para tornar lacunas visíveis na nuvem. Idempotência pelo `id` (UUIDv7).
 */
export const EventSchema = z.discriminatedUnion("type", [
  StateEventSchema,
  ProductEventSchema,
  CounterResetEventSchema,
  CounterJumpEventSchema,
  CounterRebaselineEventSchema,
  AgentStartEventSchema,
  AgentStopEventSchema,
  PowerLossEventSchema,
  PowerRestoredEventSchema,
  ClockJumpEventSchema,
  DataLossEventSchema,
  BufferCorruptedEventSchema,
  ConfigAppliedEventSchema,
  ConfigRejectedEventSchema,
  RemoteAccessEventSchema,
])
export type Event = z.infer<typeof EventSchema>
export type EventType = Event["type"]
export type StateEvent = z.infer<typeof StateEventSchema>
export const EVENT_TYPES = EventSchema.options.map((o) => o.shape.type.value) as EventType[]

// ---------------------------------------------------------------------------
// Minutos, live e amostras
// ---------------------------------------------------------------------------

const SecondsSchema = z.int().min(0).max(SECONDS_PER_MINUTE)
const MinuteCountSchema = z.int().min(0).max(MAX_COUNT_PER_MINUTE)

/**
 * Agregado de um minuto FECHADO de uma máquina. Upsert por (machine_id, t).
 * A borda nunca envia minuto parcial. Os segundos por estado são inteiros e somam
 * exatamente 60 (arredonde por maior resto; tempo não observado entra em no_comm_s).
 */
export const MinuteSchema = z
  .object({
    seq: SeqSchema,
    machine_id: EntityIdSchema,
    t: MinuteStartSchema,
    run_s: SecondsSchema,
    stop_s: SecondsSchema,
    fault_s: SecondsSchema,
    setup_s: SecondsSchema.describe("Segundos no estado SETUP"),
    no_comm_s: SecondsSchema,
    total: MinuteCountSchema.describe("Peças no minuto (delta do contador total)"),
    reject: MinuteCountSchema,
    good: MinuteCountSchema.optional().describe("Só se houver contador de boas"),
    product: ProductCodeSchema.optional().describe("Produto vigente no fim do minuto"),
  })
  .superRefine((m, ctx) => {
    const sum = m.run_s + m.stop_s + m.fault_s + m.setup_s + m.no_comm_s
    if (sum !== SECONDS_PER_MINUTE) {
      addRuleIssue(ctx, "minute.seconds_sum", ["run_s"], `A soma dos segundos do minuto é ${sum} (deve ser 60).`)
    }
  })
export type Minute = z.infer<typeof MinuteSchema>

/** Foto atual de uma máquina (não fica na outbox; montada a cada /sync). */
export const LiveSchema = z
  .object({
    machine_id: EntityIdSchema,
    at: UtcDateTimeSchema,
    state: MachineStateSchema,
    state_since: UtcDateTimeSchema,
    fault_code: FaultCodeSchema.optional(),
    counter_total: CounterRawSchema.optional().describe("Valor bruto do contador total no CLP"),
    product: ProductCodeSchema.optional(),
    speed: z.number().optional(),
  })
  .superRefine((l, ctx) => {
    if (Date.parse(l.state_since) > Date.parse(l.at)) addRuleIssue(ctx, "live.since", ["state_since"])
  })
export type Live = z.infer<typeof LiveSchema>

/** Amostra de tag `custom`/`speed.actual` (histórico livre, descartável sob pressão). */
export const SampleSchema = z.object({
  seq: SeqSchema,
  tag_id: EntityIdSchema,
  at: UtcDateTimeSchema,
  v: z.union([z.number(), z.boolean()]),
  q: QualitySchema.optional(),
})
export type Sample = z.infer<typeof SampleSchema>

// ---------------------------------------------------------------------------
// Requisição
// ---------------------------------------------------------------------------

export const SyncRequestSchema = z
  .object({
    batch: BatchSchema,
    agent: AgentHealthSchema,
    devices: z.array(DeviceHealthSchema).max(MAX_DEVICES).optional(),
    buses: z.array(BusHealthSchema).max(MAX_SERIAL_BUSES).optional(),
    events: z.array(EventSchema).max(MAX_BATCH_ITEMS).optional(),
    minutes: z.array(MinuteSchema).max(MAX_BATCH_ITEMS).optional(),
    live: z.array(LiveSchema).max(MAX_LIVE_ITEMS).optional(),
    samples: z.array(SampleSchema).max(MAX_BATCH_ITEMS).optional(),
    command_results: z.array(CommandResultSchema).max(MAX_COMMAND_RESULTS).optional(),
  })
  .superRefine((req, ctx) => {
    const { batch } = req
    const events = req.events ?? []
    const minutes = req.minutes ?? []
    const samples = req.samples ?? []

    const coreRange = checkRange(ctx, batch.seq_from, batch.seq_to, ["batch", "seq_to"])
    const samplesRange = checkRange(ctx, batch.samples_seq_from, batch.samples_seq_to, ["batch", "samples_seq_to"])
    const samplesOwnQueue = batch.samples_seq_from !== undefined || batch.samples_seq_to !== undefined

    if (events.length + minutes.length + samples.length > MAX_BATCH_ITEMS) {
      addRuleIssue(ctx, "batch.items_max", ["batch"])
    }

    // Fila principal (eventos + minutos [+ amostras sem fila própria])
    const core: { seq: number; path: PropertyKey[] }[] = [
      ...events.map((e, i) => ({ seq: e.seq, path: ["events", i, "seq"] })),
      ...minutes.map((m, i) => ({ seq: m.seq, path: ["minutes", i, "seq"] })),
    ]
    const sampleItems = samples.map((s, i) => ({ seq: s.seq, path: ["samples", i, "seq"] as PropertyKey[] }))
    const queues = samplesOwnQueue
      ? [
          { items: core, range: coreRange, rangeMissingPath: ["batch", "seq_from"] },
          { items: sampleItems, range: samplesRange, rangeMissingPath: ["batch", "samples_seq_from"] },
        ]
      : [{ items: [...core, ...sampleItems], range: coreRange, rangeMissingPath: ["batch", "seq_from"] }]

    for (const queue of queues) {
      if (queue.items.length === 0) continue
      if (queue.range === undefined) {
        addRuleIssue(ctx, "batch.seq_required", queue.rangeMissingPath)
        continue
      }
      const seen = new Set<number>()
      for (const item of queue.items) {
        if (item.seq < queue.range.from || item.seq > queue.range.to) addRuleIssue(ctx, "batch.seq_range", item.path)
        if (seen.has(item.seq)) addRuleIssue(ctx, "batch.seq_unique", item.path)
        seen.add(item.seq)
      }
    }

    unique(ctx, events, (e) => e.id, (i) => ["events", i, "id"], "event.id_unique")
    unique(ctx, minutes, (m) => `${m.machine_id}|${Date.parse(m.t)}`, (i) => ["minutes", i, "t"], "minute.unique")
    unique(ctx, req.live ?? [], (l) => l.machine_id, (i) => ["live", i, "machine_id"], "live.unique")
    unique(ctx, samples, (s) => `${s.tag_id}|${Date.parse(s.at)}`, (i) => ["samples", i, "at"], "sample.unique")
    unique(ctx, req.devices ?? [], (d) => d.id, (i) => ["devices", i, "id"], "device_status.unique")
    unique(ctx, req.buses ?? [], (b) => b.id, (i) => ["buses", i, "id"], "device_status.unique")
    unique(
      ctx,
      req.command_results ?? [],
      (r) => r.id,
      (i) => ["command_results", i, "id"],
      "command_result.unique",
    )
  })
export type SyncRequest = z.infer<typeof SyncRequestSchema>

function checkRange(
  ctx: z.RefinementCtx,
  from: number | undefined,
  to: number | undefined,
  path: PropertyKey[],
): { from: number; to: number } | undefined {
  if (from === undefined && to === undefined) return undefined
  if (from === undefined || to === undefined || from > to) {
    addRuleIssue(ctx, "batch.seq_pair", path)
    return undefined
  }
  return { from, to }
}

function unique<T>(
  ctx: z.RefinementCtx,
  items: readonly T[],
  key: (item: T) => string,
  path: (index: number) => PropertyKey[],
  rule: "event.id_unique" | "minute.unique" | "live.unique" | "sample.unique" | "device_status.unique" | "command_result.unique",
): void {
  const seen = new Set<string>()
  items.forEach((item, i) => {
    const k = key(item)
    if (seen.has(k)) addRuleIssue(ctx, rule, path(i))
    seen.add(k)
  })
}

// ---------------------------------------------------------------------------
// Resposta
// ---------------------------------------------------------------------------

export const SyncResponseSchema = z
  .object({
    ack_seq: NonNegativeIntSchema.describe("Remova da fila principal tudo com seq ≤ ack_seq"),
    ack_samples_seq: NonNegativeIntSchema.optional().describe("Só quando as amostras têm fila própria"),
    server_time: UtcDateTimeSchema,
    config: z.object({
      latest_version: NonNegativeIntSchema.describe("Se maior que a aplicada, o agente baixa GET /config"),
    }),
    commands: z.array(CommandSchema).max(MAX_COMMANDS_PER_SYNC),
    next_sync_s: z.int().min(1).max(300),
    min_agent_version: SemverSchema,
  })
  .superRefine((res, ctx) => {
    const seen = new Set<string>()
    res.commands.forEach((c, i) => {
      if (seen.has(c.id)) addRuleIssue(ctx, "command.unique", ["commands", i, "id"])
      seen.add(c.id)
    })
  })
export type SyncResponse = z.infer<typeof SyncResponseSchema>

/**
 * Caminhos de todos os timestamps de dados do /sync posteriores a `limit`
 * (ex.: server_time + FUTURE_TOLERANCE_MS). A API rejeita esses itens.
 */
export function findTimestampsAfter(req: SyncRequest, limit: Date): string[] {
  const max = limit.getTime()
  const out: string[] = []
  const check = (iso: string, path: string) => {
    if (Date.parse(iso) > max) out.push(path)
  }
  req.events?.forEach((e, i) => check(e.at, `events.${i}.at`))
  req.minutes?.forEach((m, i) => check(m.t, `minutes.${i}.t`))
  req.live?.forEach((l, i) => {
    check(l.at, `live.${i}.at`)
    check(l.state_since, `live.${i}.state_since`)
  })
  req.samples?.forEach((s, i) => check(s.at, `samples.${i}.at`))
  return out
}
