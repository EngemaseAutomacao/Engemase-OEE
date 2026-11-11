/**
 * Cadastros de produção: produtos e ciclo ideal por máquina, turnos, paradas planejadas,
 * motivos de parada e mapa de códigos de falha (docs/06, "4. Cadastros de produção"; docs/07).
 */
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { createdAt, deletedAt, oneOf, pk, tstz, updatedAt } from "./_columns"
import { organizationId } from "./_tenant"
import { line, machine, unit } from "./assets"
import { REASON_CATEGORIES } from "./enums"

export const product = pgTable(
  "product",
  {
    id: pk(),
    organizationId: organizationId(),
    /** Código como lido do CLP ou cadastrado (ex.: "7" ou "PRD-001"). */
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("product_id_org_uq").on(t.id, t.organizationId),
    uniqueIndex("product_org_code_uq")
      .on(t.organizationId, t.code)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
)

/** Ciclo ideal de um produto numa máquina (s/peça). */
export const productMachine = pgTable(
  "product_machine",
  {
    organizationId: organizationId(),
    productId: uuid("product_id").notNull(),
    machineId: uuid("machine_id").notNull(),
    idealCycleS: numeric("ideal_cycle_s", { precision: 12, scale: 4, mode: "number" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "product_machine_pk", columns: [t.productId, t.machineId] }),
    foreignKey({
      name: "product_machine_product_fk",
      columns: [t.productId, t.organizationId],
      foreignColumns: [product.id, product.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "product_machine_machine_fk",
      columns: [t.machineId, t.organizationId],
      foreignColumns: [machine.id, machine.organizationId],
    }).onDelete("cascade"),
    index("product_machine_machine_idx").on(t.machineId),
    check("product_machine_ideal_cycle_chk", sql`${t.idealCycleS} > 0`),
  ],
)

/** Pausa planejada dentro do turno, em horário local `HH:MM` (mesmo formato do `@engemase/oee-core`). */
export interface ShiftBreak {
  readonly start: string
  readonly end: string
  readonly name?: string
}

/**
 * Turno da unidade (formato de `ShiftDefinition` do `@engemase/oee-core`).
 * `end_time <= start_time` = atravessa a meia-noite (pertence à data de início).
 * Calendário completo (feriados, exceções, "dia produtivo") é a lacuna L2 do docs/17.
 */
export const shift = pgTable(
  "shift",
  {
    id: pk(),
    organizationId: organizationId(),
    unitId: uuid("unit_id").notNull(),
    name: text("name").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    /** Dias ISO (1 = segunda … 7 = domingo) em que o turno COMEÇA. */
    daysOfWeek: smallint("days_of_week").array().notNull(),
    breaks: jsonb("breaks").$type<ShiftBreak[]>().notNull().default([]),
    /** Vigência (inclusiva), comparada com a data de início do turno. */
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("shift_id_org_uq").on(t.id, t.organizationId),
    foreignKey({
      name: "shift_unit_fk",
      columns: [t.unitId, t.organizationId],
      foreignColumns: [unit.id, unit.organizationId],
    }),
    check(
      "shift_days_chk",
      sql`cardinality(${t.daysOfWeek}) > 0 AND ${t.daysOfWeek} <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]`,
    ),
    check("shift_validity_chk", sql`${t.validFrom} IS NULL OR ${t.validTo} IS NULL OR ${t.validFrom} <= ${t.validTo}`),
    check("shift_breaks_chk", sql`jsonb_typeof(${t.breaks}) = 'array'`),
  ],
)

/** Motivo de parada (árvore por cliente), com categoria que decide o efeito no OEE. */
export const downtimeReason = pgTable(
  "downtime_reason",
  {
    id: pk(),
    organizationId: organizationId(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    category: text("category", { enum: REASON_CATEGORIES }).notNull(),
    color: text("color"),
    /** Motivo de sistema (ex.: "no_comm" = "Sem comunicação"), criado na implantação do cliente. */
    systemKey: text("system_key"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("downtime_reason_id_org_uq").on(t.id, t.organizationId),
    foreignKey({
      name: "downtime_reason_parent_fk",
      columns: [t.parentId, t.organizationId],
      foreignColumns: [t.id, t.organizationId],
    }),
    uniqueIndex("downtime_reason_system_key_uq")
      .on(t.organizationId, t.systemKey)
      .where(sql`${t.systemKey} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    check("downtime_reason_category_chk", oneOf(t.category, REASON_CATEGORIES)),
    check("downtime_reason_color_chk", sql`${t.color} IS NULL OR ${t.color} ~ '^#[0-9A-Fa-f]{6}$'`),
    check("downtime_reason_parent_chk", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  ],
)

/**
 * Parada planejada (calendário): da unidade inteira, de uma linha ou de uma máquina.
 * `recurrence` = regra RRULE (RFC 5545) opcional; a expansão é feita pela aplicação.
 */
export const plannedDowntime = pgTable(
  "planned_downtime",
  {
    id: pk(),
    organizationId: organizationId(),
    unitId: uuid("unit_id").notNull(),
    lineId: uuid("line_id"),
    machineId: uuid("machine_id"),
    reasonId: uuid("reason_id"),
    name: text("name").notNull(),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    recurrence: text("recurrence"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    foreignKey({
      name: "planned_downtime_unit_fk",
      columns: [t.unitId, t.organizationId],
      foreignColumns: [unit.id, unit.organizationId],
    }),
    foreignKey({
      name: "planned_downtime_line_fk",
      columns: [t.lineId, t.unitId, t.organizationId],
      foreignColumns: [line.id, line.unitId, line.organizationId],
    }),
    foreignKey({
      name: "planned_downtime_machine_fk",
      columns: [t.machineId, t.unitId, t.organizationId],
      foreignColumns: [machine.id, machine.unitId, machine.organizationId],
    }),
    foreignKey({
      name: "planned_downtime_reason_fk",
      columns: [t.reasonId, t.organizationId],
      foreignColumns: [downtimeReason.id, downtimeReason.organizationId],
    }),
    index("planned_downtime_unit_time_idx").on(t.unitId, t.startsAt),
    check("planned_downtime_interval_chk", sql`${t.endsAt} > ${t.startsAt}`),
  ],
)

/** Código de falha do CLP → motivo de parada (F2), por máquina ou por modelo de máquina. */
export const faultCodeMap = pgTable(
  "fault_code_map",
  {
    id: pk(),
    organizationId: organizationId(),
    machineId: uuid("machine_id"),
    /** Modelo de máquina (F2, `machine_template`); ainda sem FK. */
    templateId: uuid("template_id"),
    faultCode: integer("fault_code").notNull(),
    reasonId: uuid("reason_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "fault_code_map_machine_fk",
      columns: [t.machineId, t.organizationId],
      foreignColumns: [machine.id, machine.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "fault_code_map_reason_fk",
      columns: [t.reasonId, t.organizationId],
      foreignColumns: [downtimeReason.id, downtimeReason.organizationId],
    }),
    unique("fault_code_map_machine_code_uq").on(t.machineId, t.faultCode),
    unique("fault_code_map_template_code_uq").on(t.templateId, t.faultCode),
    check("fault_code_map_target_chk", sql`(${t.machineId} IS NULL) <> (${t.templateId} IS NULL)`),
  ],
)
