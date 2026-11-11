/**
 * Ativos: unidade (planta) → [área] → linha → máquina (docs/06, "2. Ativos"; docs/15, seção 1).
 *
 * Além da FK composta `(x_id, organization_id)`, a hierarquia é amarrada pela unidade:
 * a área de uma linha é da mesma unidade da linha, e `machine.unit_id` (desnormalizado da linha)
 * permite garantir que o gateway que alimenta a máquina é da mesma unidade (ver `gateway_machine`)
 * e filtrar o escopo por unidade na camada de acesso a dados.
 */
import type { StateRules } from "@engemase/contracts"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { createdAt, deletedAt, oneOf, pk, updatedAt } from "./_columns"
import { organizationId } from "./_tenant"
import { STATE_MODES } from "./enums"

/** Unidade (planta). "Unidade" é o termo único no produto e no código. */
export const unit = pgTable(
  "unit",
  {
    id: pk(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    /** Fuso IANA da unidade (turnos, "dia do turno" e relatórios). */
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("unit_id_org_uq").on(t.id, t.organizationId),
    uniqueIndex("unit_org_name_uq")
      .on(t.organizationId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    check("unit_timezone_chk", sql`${t.timezone} <> ''`),
  ],
)

/** Área: agrupador opcional dentro da unidade. */
export const area = pgTable(
  "area",
  {
    id: pk(),
    organizationId: organizationId(),
    unitId: uuid("unit_id").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("area_id_org_uq").on(t.id, t.organizationId),
    unique("area_id_unit_org_uq").on(t.id, t.unitId, t.organizationId),
    foreignKey({
      name: "area_unit_fk",
      columns: [t.unitId, t.organizationId],
      foreignColumns: [unit.id, unit.organizationId],
    }),
  ],
)

export const line = pgTable(
  "line",
  {
    id: pk(),
    organizationId: organizationId(),
    unitId: uuid("unit_id").notNull(),
    /** Nulo = linha ligada direto à unidade. */
    areaId: uuid("area_id"),
    name: text("name").notNull(),
    /** Meta de OEE da linha (0–1), docs/13 e L4 do docs/17. */
    oeeTarget: numeric("oee_target", { precision: 5, scale: 4, mode: "number" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("line_id_org_uq").on(t.id, t.organizationId),
    unique("line_id_unit_org_uq").on(t.id, t.unitId, t.organizationId),
    foreignKey({
      name: "line_unit_fk",
      columns: [t.unitId, t.organizationId],
      foreignColumns: [unit.id, unit.organizationId],
    }),
    // A área (se houver) é do mesmo cliente E da mesma unidade da linha.
    foreignKey({
      name: "line_area_fk",
      columns: [t.areaId, t.unitId, t.organizationId],
      foreignColumns: [area.id, area.unitId, area.organizationId],
    }),
    check("line_oee_target_chk", sql`${t.oeeTarget} IS NULL OR (${t.oeeTarget} > 0 AND ${t.oeeTarget} <= 1)`),
  ],
)

export const machine = pgTable(
  "machine",
  {
    id: pk(),
    organizationId: organizationId(),
    /** Desnormalizado da linha (garantido pela FK composta com a linha). */
    unitId: uuid("unit_id").notNull(),
    lineId: uuid("line_id").notNull(),
    name: text("name").notNull(),
    code: text("code"),
    /** Ciclo ideal padrão (s/peça), para produtos sem cadastro em `product_machine`. */
    idealCycleS: numeric("ideal_cycle_s", { precision: 12, scale: 4, mode: "number" }),
    /** Paradas menores que isto contam como operação (docs/07). Padrão provisório: 60 s (D23). */
    microStopThresholdS: integer("micro_stop_threshold_s").notNull().default(60),
    /** Regras de estado no formato do contrato (`StateRules`, docs/03): modo + parâmetros. */
    stateRules: jsonb("state_rules").$type<StateRules>().notNull(),
    /** Taxa máxima plausível de peças/s (sanidade dos contadores). */
    maxRatePerS: numeric("max_rate_per_s", { precision: 12, scale: 4, mode: "number" }),
    /** Meta de OEE da máquina (0–1). */
    oeeTarget: numeric("oee_target", { precision: 5, scale: 4, mode: "number" }),
    /** Modelo de máquina (F2, `machine_template`); ainda sem FK. */
    templateId: uuid("template_id"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("machine_id_org_uq").on(t.id, t.organizationId),
    unique("machine_id_unit_org_uq").on(t.id, t.unitId, t.organizationId),
    foreignKey({
      name: "machine_line_fk",
      columns: [t.lineId, t.unitId, t.organizationId],
      foreignColumns: [line.id, line.unitId, line.organizationId],
    }),
    uniqueIndex("machine_org_code_uq")
      .on(t.organizationId, t.code)
      .where(sql`${t.deletedAt} IS NULL AND ${t.code} IS NOT NULL`),
    check("machine_state_mode_chk", oneOf(sql`(${t.stateRules} ->> 'mode')`, STATE_MODES)),
    check("machine_ideal_cycle_chk", sql`${t.idealCycleS} IS NULL OR ${t.idealCycleS} > 0`),
    check("machine_micro_stop_chk", sql`${t.microStopThresholdS} >= 0`),
    check("machine_max_rate_chk", sql`${t.maxRatePerS} IS NULL OR ${t.maxRatePerS} > 0`),
    check("machine_oee_target_chk", sql`${t.oeeTarget} IS NULL OR (${t.oeeTarget} > 0 AND ${t.oeeTarget} <= 1)`),
  ],
)
