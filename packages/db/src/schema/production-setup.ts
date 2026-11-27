/**
 * Cadastros de produção: produtos e ciclo ideal por máquina, turnos e feriados da unidade, paradas
 * planejadas, motivos de parada e de refugo, operadores da unidade e mapa de códigos de falha
 * (docs/06, "4. Cadastros de produção"; docs/07; L2, L3 e L19 do docs/17).
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
import { createdAt, deletedAt, faultCode, faultCodeInRange, oneOf, pk, tstz, updatedAt } from "./_columns"
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
 *
 * Regras do calendário (L2 do docs/17, escolha de 12/11/2026): o turno pertence ao dia em que COMEÇA;
 * feriado da unidade (`unit_holiday`) = nenhum turno começa naquele dia (tempo não planejado); turnos
 * não se sobrepõem na mesma unidade (regra da aplicação: o banco não confere sobreposição entre dias
 * da semana, vigências e turnos que atravessam a meia-noite); mudança de turno vale dali para a
 * frente (nova linha com `valid_from`, sem recalcular o passado).
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

/**
 * Feriado da unidade (L2 do docs/17), cadastrado pela Engemase: no dia `holiday_date` (data local da
 * unidade) nenhum turno começa, e o tempo vira não planejado. Produção nesse dia conta as peças e o
 * tempo produzido vira planejado (como D24). Um feriado por dia e unidade (entre os não excluídos).
 */
export const unitHoliday = pgTable(
  "unit_holiday",
  {
    id: pk(),
    organizationId: organizationId(),
    unitId: uuid("unit_id").notNull(),
    holidayDate: date("holiday_date", { mode: "string" }).notNull(),
    name: text("name").notNull(),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    foreignKey({
      name: "unit_holiday_unit_fk",
      columns: [t.unitId, t.organizationId],
      foreignColumns: [unit.id, unit.organizationId],
    }),
    uniqueIndex("unit_holiday_unit_date_uq")
      .on(t.unitId, t.holidayDate)
      .where(sql`${t.deletedAt} IS NULL`),
    check("unit_holiday_name_chk", sql`btrim(${t.name}) <> ''`),
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
    faultCode: faultCode().notNull(),
    /** Texto do alarme como aparece no CLP/IHM (mostrado ao operador e na TV). */
    faultText: text("fault_text").notNull().default(""),
    /** Motivo automático; `null` = o operador escolhe (só o texto do alarme aparece). */
    reasonId: uuid("reason_id"),
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
    // Alvo: uma máquina, um modelo (F2) ou, com os dois nulos, todas as máquinas do cliente.
    check("fault_code_map_target_chk", sql`NOT (${t.machineId} IS NOT NULL AND ${t.templateId} IS NOT NULL)`),
    uniqueIndex("fault_code_map_client_code_uq")
      .on(t.organizationId, t.faultCode)
      .where(sql`${t.machineId} IS NULL AND ${t.templateId} IS NULL`),
    check("fault_code_map_fault_code_chk", faultCodeInRange(t.faultCode)),
  ],
)

/**
 * Motivo de refugo (L3 do docs/17), cadastrado pela Engemase por cliente. Usado no lançamento manual
 * de refugo (`quality_entry.reject_reason_id`). Desativar (`active = false`) tira o motivo da lista sem
 * mexer nos lançamentos antigos.
 */
export const rejectReason = pgTable(
  "reject_reason",
  {
    id: pk(),
    organizationId: organizationId(),
    /** Código opcional (ex.: o do CLP ou o da planilha de qualidade do cliente). */
    code: text("code"),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("reject_reason_id_org_uq").on(t.id, t.organizationId),
    uniqueIndex("reject_reason_org_name_uq")
      .on(t.organizationId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex("reject_reason_org_code_uq")
      .on(t.organizationId, t.code)
      .where(sql`${t.code} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    check("reject_reason_name_chk", sql`btrim(${t.name}) <> ''`),
    check("reject_reason_code_chk", sql`${t.code} IS NULL OR btrim(${t.code}) <> ''`),
  ],
)

/**
 * Operador de chão da unidade (L19 do docs/17; D18): escolhido numa lista no tablet ou no desktop,
 * sem login próprio. Cadastrado pela Engemase, com nome e matrícula opcional (dado pessoal mínimo,
 * LGPD). A matrícula é única na unidade entre os não excluídos.
 */
export const unitOperator = pgTable(
  "unit_operator",
  {
    id: pk(),
    organizationId: organizationId(),
    unitId: uuid("unit_id").notNull(),
    name: text("name").notNull(),
    /** Matrícula na empresa do cliente (opcional). */
    employeeCode: text("employee_code"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("unit_operator_id_org_uq").on(t.id, t.organizationId),
    foreignKey({
      name: "unit_operator_unit_fk",
      columns: [t.unitId, t.organizationId],
      foreignColumns: [unit.id, unit.organizationId],
    }),
    index("unit_operator_unit_idx").on(t.unitId),
    uniqueIndex("unit_operator_unit_code_uq")
      .on(t.unitId, t.employeeCode)
      .where(sql`${t.employeeCode} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    check("unit_operator_name_chk", sql`btrim(${t.name}) <> ''`),
    check("unit_operator_code_chk", sql`${t.employeeCode} IS NULL OR btrim(${t.employeeCode}) <> ''`),
  ],
)
