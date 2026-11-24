/**
 * Escopo por unidade ou máquina (D11) na camada de acesso a dados. A RLS isola o CLIENTE; o escopo
 * dentro do cliente é regra daqui (docs/15, seção 4, item 4): toda consulta de máquina, unidade ou
 * dado de produção recebe o `TenantContext` e aplica estes filtros. Agregados (OEE de linha e de
 * unidade, relatórios) somam só o que o filtro deixa passar.
 */
import { machine, unit } from "@engemase/db"
import { inArray, type SQL, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type { Scope } from "./context"

const ALL: SQL = sql`true`
const NONE: SQL = sql`false`

/** Condição para a tabela `machine` (ou outra, passando as colunas de máquina e unidade). */
export function machineScopeCondition(
  scope: Scope,
  columns: { readonly machineId: AnyPgColumn; readonly unitId: AnyPgColumn } = {
    machineId: machine.id,
    unitId: machine.unitId,
  },
): SQL {
  switch (scope.kind) {
    case "all":
      return ALL
    case "units":
      return scope.unitIds.length > 0 ? inArray(columns.unitId, [...scope.unitIds]) : NONE
    case "machines":
      return scope.machineIds.length > 0 ? inArray(columns.machineId, [...scope.machineIds]) : NONE
  }
}

/**
 * Condição para dados que só têm a coluna de máquina (ex.: `production_minute.machine_id`).
 * No escopo por unidades, filtra pelas máquinas das unidades (subconsulta, também sob RLS).
 */
export function machineIdScopeCondition(scope: Scope, machineIdColumn: AnyPgColumn): SQL {
  switch (scope.kind) {
    case "all":
      return ALL
    case "units":
      return scope.unitIds.length > 0
        ? sql`${machineIdColumn} IN (SELECT ${machine.id} FROM ${machine} WHERE ${inArray(machine.unitId, [...scope.unitIds])})`
        : NONE
    case "machines":
      return scope.machineIds.length > 0 ? inArray(machineIdColumn, [...scope.machineIds]) : NONE
  }
}

/**
 * Condição para a tabela `unit`. No escopo por máquinas, a pessoa vê as unidades das máquinas dela
 * (para navegar), mas os números da unidade somam só as máquinas permitidas.
 */
export function unitScopeCondition(scope: Scope, unitIdColumn: AnyPgColumn = unit.id): SQL {
  switch (scope.kind) {
    case "all":
      return ALL
    case "units":
      return scope.unitIds.length > 0 ? inArray(unitIdColumn, [...scope.unitIds]) : NONE
    case "machines":
      return scope.machineIds.length > 0
        ? sql`${unitIdColumn} IN (SELECT ${machine.unitId} FROM ${machine} WHERE ${inArray(machine.id, [...scope.machineIds])})`
        : NONE
  }
}

/** A máquina (id + unidade) está no escopo? Para conferir um registro já lido. */
export function machineInScope(scope: Scope, target: { readonly id: string; readonly unitId: string }): boolean {
  switch (scope.kind) {
    case "all":
      return true
    case "units":
      return scope.unitIds.includes(target.unitId)
    case "machines":
      return scope.machineIds.includes(target.id)
  }
}
