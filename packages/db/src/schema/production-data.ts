/**
 * Dados de produção (séries temporais) e consolidados (docs/06, seções 5 e 6; docs/04, "Regras de
 * processamento na nuvem"; docs/07).
 *
 * Todas com `organization_id` (desnormalizado da máquina) e FK composta com a máquina: o gateway de
 * um cliente não consegue gravar em máquina de outro.
 *
 * Particionamento (pg_partman, mensal para `production_minute`, diário/semanal para `tag_sample`)
 * fica para a épica W2b: as chaves primárias já incluem a coluna de tempo onde a partição exige.
 */
import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import { createdAt, faultCode, faultCodeInRange, oneOf, pk, tstz } from "./_columns"
import { organizationId } from "./_tenant"
import { machine } from "./assets"
import { tag } from "./connectivity"
import { MACHINE_STATES, PRODUCTION_RUN_SOURCES, STATE_EVENT_SOURCES } from "./enums"
import { downtimeReason, product, shift } from "./production-setup"

/**
 * Intervalo de estado da máquina. O id (UUIDv7) vem da borda: `ON CONFLICT (id) DO NOTHING`.
 * `ended_at` nulo = evento em aberto.
 */
export const machineStateEvent = pgTable(
  "machine_state_event",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: organizationId(),
    machineId: uuid("machine_id").notNull(),
    state: text("state", { enum: MACHINE_STATES }).notNull(),
    startedAt: tstz("started_at").notNull(),
    endedAt: tstz("ended_at"),
    /** Código de falha do CLP (uint32 no contrato). */
    faultCode: faultCode(),
    reasonId: uuid("reason_id"),
    classifiedBy: uuid("classified_by"),
    classifiedAt: tstz("classified_at"),
    source: text("source", { enum: STATE_EVENT_SOURCES }).notNull().default("edge"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "machine_state_event_machine_fk",
      columns: [t.machineId, t.organizationId],
      foreignColumns: [machine.id, machine.organizationId],
    }),
    foreignKey({
      name: "machine_state_event_reason_fk",
      columns: [t.reasonId, t.organizationId],
      foreignColumns: [downtimeReason.id, downtimeReason.organizationId],
    }),
    index("machine_state_event_machine_time_idx").on(t.machineId, t.startedAt),
    index("machine_state_event_open_idx")
      .on(t.machineId)
      .where(sql`${t.endedAt} IS NULL`),
    check("machine_state_event_state_chk", oneOf(t.state, MACHINE_STATES)),
    check("machine_state_event_source_chk", oneOf(t.source, STATE_EVENT_SOURCES)),
    check("machine_state_event_interval_chk", sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`),
    check("machine_state_event_fault_code_chk", faultCodeInRange(t.faultCode)),
  ],
)

/**
 * Agregado por minuto vindo da borda. PK `(machine_id, bucket_start)` → upsert idempotente.
 * Em cada minuto fechado, run_s + stop_s + fault_s + setup_s + no_comm_s = 60 (docs/04).
 * `good` só vem quando a máquina tem contador de boas (`count.good`); senão fica nulo e as boas
 * saem de total − refugo (docs/07).
 */
export const productionMinute = pgTable(
  "production_minute",
  {
    organizationId: organizationId(),
    machineId: uuid("machine_id").notNull(),
    bucketStart: tstz("bucket_start").notNull(),
    runS: integer("run_s").notNull(),
    stopS: integer("stop_s").notNull(),
    faultS: integer("fault_s").notNull(),
    setupS: integer("setup_s").notNull().default(0),
    noCommS: integer("no_comm_s").notNull(),
    total: integer("total").notNull(),
    reject: integer("reject").notNull(),
    good: integer("good"),
    productCode: text("product_code"),
    receivedAt: tstz("received_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "production_minute_pk", columns: [t.machineId, t.bucketStart] }),
    foreignKey({
      name: "production_minute_machine_fk",
      columns: [t.machineId, t.organizationId],
      foreignColumns: [machine.id, machine.organizationId],
    }),
    check(
      "production_minute_seconds_chk",
      sql`${t.runS} >= 0 AND ${t.stopS} >= 0 AND ${t.faultS} >= 0 AND ${t.setupS} >= 0 AND ${t.noCommS} >= 0
        AND ${t.runS} + ${t.stopS} + ${t.faultS} + ${t.setupS} + ${t.noCommS} = 60`,
    ),
    check("production_minute_counts_chk", sql`${t.total} >= 0 AND ${t.reject} >= 0`),
    check("production_minute_good_chk", sql`${t.good} IS NULL OR ${t.good} >= 0`),
    check("production_minute_bucket_chk", sql`date_trunc('minute', ${t.bucketStart}) = ${t.bucketStart}`),
  ],
)

/** Produção de um produto/ordem numa máquina (troca vinda do CLP ou do operador). */
export const productionRun = pgTable(
  "production_run",
  {
    id: pk(),
    organizationId: organizationId(),
    machineId: uuid("machine_id").notNull(),
    productId: uuid("product_id"),
    productCode: text("product_code"),
    orderCode: text("order_code"),
    startedAt: tstz("started_at").notNull(),
    endedAt: tstz("ended_at"),
    source: text("source", { enum: PRODUCTION_RUN_SOURCES }).notNull(),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "production_run_machine_fk",
      columns: [t.machineId, t.organizationId],
      foreignColumns: [machine.id, machine.organizationId],
    }),
    foreignKey({
      name: "production_run_product_fk",
      columns: [t.productId, t.organizationId],
      foreignColumns: [product.id, product.organizationId],
    }),
    index("production_run_machine_time_idx").on(t.machineId, t.startedAt),
    check("production_run_source_chk", oneOf(t.source, PRODUCTION_RUN_SOURCES)),
    check("production_run_interval_chk", sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`),
  ],
)

/**
 * Lançamento manual de qualidade. `quantity > 0` move peças de boas para refugo;
 * `quantity < 0` estorna um lançamento anterior (`reverses_id`). Regras completas: L3 do docs/17.
 *
 * Garantias no banco: o estorno aponta para um lançamento existente do MESMO cliente (FK composta
 * `(reverses_id, organization_id)`), tem quantidade negativa e não aponta para si mesmo.
 */
export const qualityEntry = pgTable(
  "quality_entry",
  {
    id: pk(),
    organizationId: organizationId(),
    machineId: uuid("machine_id").notNull(),
    at: tstz("at").notNull(),
    quantity: integer("quantity").notNull(),
    productCode: text("product_code"),
    reason: text("reason"),
    reversesId: uuid("reverses_id"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "quality_entry_machine_fk",
      columns: [t.machineId, t.organizationId],
      foreignColumns: [machine.id, machine.organizationId],
    }),
    unique("quality_entry_id_org_uq").on(t.id, t.organizationId),
    foreignKey({
      name: "quality_entry_reverses_fk",
      columns: [t.reversesId, t.organizationId],
      foreignColumns: [t.id, t.organizationId],
    }),
    index("quality_entry_machine_time_idx").on(t.machineId, t.at),
    index("quality_entry_reverses_idx")
      .on(t.reversesId)
      .where(sql`${t.reversesId} IS NOT NULL`),
    check("quality_entry_quantity_chk", sql`${t.quantity} <> 0`),
    check(
      "quality_entry_reversal_chk",
      sql`${t.reversesId} IS NULL OR (${t.quantity} < 0 AND ${t.reversesId} <> ${t.id})`,
    ),
  ],
)

/** Estado atual da máquina (uma linha por máquina). Upsert só se `at` for mais novo. */
export const machineLive = pgTable(
  "machine_live",
  {
    machineId: uuid("machine_id").primaryKey(),
    organizationId: organizationId(),
    state: text("state", { enum: MACHINE_STATES }).notNull(),
    stateSince: tstz("state_since").notNull(),
    /** Código de falha do CLP (uint32 no contrato). */
    faultCode: faultCode(),
    counterTotal: bigint("counter_total", { mode: "number" }),
    productCode: text("product_code"),
    /** Velocidade instantânea (papel `speed.actual`), na unidade configurada na tag. */
    speed: doublePrecision("speed"),
    /** Instante da leitura na borda (ordem de chegada não importa). */
    at: tstz("at").notNull(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "machine_live_machine_fk",
      columns: [t.machineId, t.organizationId],
      foreignColumns: [machine.id, machine.organizationId],
    }).onDelete("cascade"),
    check("machine_live_state_chk", oneOf(t.state, MACHINE_STATES)),
    check("machine_live_fault_code_chk", faultCodeInRange(t.faultCode)),
  ],
)

/** Amostras de tags de histórico (papéis custom/speed.actual), retenção curta. PK `(tag_id, at)`. */
export const tagSample = pgTable(
  "tag_sample",
  {
    organizationId: organizationId(),
    tagId: uuid("tag_id").notNull(),
    at: tstz("at").notNull(),
    value: doublePrecision("value"),
    valueText: text("value_text"),
  },
  (t) => [
    primaryKey({ name: "tag_sample_pk", columns: [t.tagId, t.at] }),
    foreignKey({
      name: "tag_sample_tag_fk",
      columns: [t.tagId, t.organizationId],
      foreignColumns: [tag.id, tag.organizationId],
    }).onDelete("cascade"),
    check("tag_sample_value_chk", sql`${t.value} IS NOT NULL OR ${t.valueText} IS NOT NULL`),
  ],
)

/**
 * OEE consolidado por máquina e turno. `dirty = true` quando chegam dados atrasados ou
 * reclassificações num turno já consolidado; o cron `recompute-dirty` recalcula (docs/07).
 * Indicadores de 0 a 1 (performance pode passar de 1); nulos quando não se aplicam.
 */
export const oeeShift = pgTable(
  "oee_shift",
  {
    organizationId: organizationId(),
    machineId: uuid("machine_id").notNull(),
    /** Data local de início do turno (turno noturno pertence à data em que começa). */
    shiftDate: date("shift_date", { mode: "string" }).notNull(),
    shiftId: uuid("shift_id").notNull(),
    plannedS: doublePrecision("planned_s").notNull().default(0),
    runS: doublePrecision("run_s").notNull().default(0),
    downtimeS: doublePrecision("downtime_s").notNull().default(0),
    total: integer("total").notNull().default(0),
    good: integer("good").notNull().default(0),
    reject: integer("reject").notNull().default(0),
    idealTimeS: doublePrecision("ideal_time_s"),
    availability: doublePrecision("availability"),
    performance: doublePrecision("performance"),
    quality: doublePrecision("quality"),
    oee: doublePrecision("oee"),
    dirty: boolean("dirty").notNull().default(true),
    dirtySince: tstz("dirty_since"),
    calculatedAt: tstz("calculated_at"),
  },
  (t) => [
    primaryKey({ name: "oee_shift_pk", columns: [t.machineId, t.shiftDate, t.shiftId] }),
    foreignKey({
      name: "oee_shift_machine_fk",
      columns: [t.machineId, t.organizationId],
      foreignColumns: [machine.id, machine.organizationId],
    }),
    foreignKey({
      name: "oee_shift_shift_fk",
      columns: [t.shiftId, t.organizationId],
      foreignColumns: [shift.id, shift.organizationId],
    }),
    index("oee_shift_dirty_idx")
      .on(t.organizationId, t.shiftDate)
      .where(sql`${t.dirty}`),
    index("oee_shift_org_date_idx").on(t.organizationId, t.shiftDate),
    check("oee_shift_nonnegative_chk", sql`${t.plannedS} >= 0 AND ${t.runS} >= 0 AND ${t.downtimeS} >= 0`),
    // `good` pode ficar negativo se o refugo passar do total (o oee-core avisa com REJECT_EXCEEDS_TOTAL).
    check("oee_shift_counts_chk", sql`${t.total} >= 0 AND ${t.reject} >= 0`),
  ],
)
