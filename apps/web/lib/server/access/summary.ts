/**
 * Agregados e resumos com escopo (D11, fail-closed; docs/15 seção 2 e itens 7 e 14): quem vê só a Unidade A
 * nunca vê números que incluam a Unidade B; quem vê só as máquinas X e Y vê o total da linha e da unidade
 * SOMANDO SÓ X e Y. O cliente vem da RLS (`withContext`); o escopo é aplicado aqui, no SQL, antes de somar.
 *
 * - `productionTotals`: soma de `production_minute` por máquina, linha, unidade ou total (base do OEE dos
 *   relatórios e da exportação);
 * - `productionCsv`: exportação em CSV dos totais por máquina (mesmo filtro);
 * - `openAlertCounts`: alertas abertos por gravidade. Fora do escopo "cliente inteiro", só os alertas de
 *   máquina dentro do escopo (alerta de gateway, sem máquina, fica de fora: fail-closed);
 * - `listAuditEntries`: auditoria do cliente. Escopo por unidades: só registros dessas unidades; por
 *   máquinas: só registros dessas máquinas; registros do cliente todo (ex.: convites) só no escopo `all`.
 */
import { alertEvent, auditLog, line, machine, productionMinute, unit } from "@engemase/db"
import { and, asc, desc, eq, gte, inArray, isNull, lt, type SQL, sql } from "drizzle-orm"
import type { GatewayDb } from "@/lib/server/gateway/types"
import { assertPermission, type TenantContext } from "./context"
import { withContext } from "./load"
import { machineIdScopeCondition, machineScopeCondition } from "./scope"

const DAY_MS = 24 * 3_600_000
/** Maior período de um resumo (relatórios anuais com folga). */
export const MAX_SUMMARY_RANGE_MS = 400 * DAY_MS

export class SummaryRangeError extends Error {
  override readonly name = "SummaryRangeError"
}

export interface SummaryRange {
  readonly from: Date
  readonly to: Date
}

function assertRange(range: SummaryRange): void {
  const span = range.to.getTime() - range.from.getTime()
  if (!Number.isFinite(span) || span <= 0 || span > MAX_SUMMARY_RANGE_MS) {
    throw new SummaryRangeError("Período inválido: o fim precisa ser depois do início, em até 400 dias.")
  }
}

export type SummaryGroup = "machine" | "line" | "unit" | "total"

export interface ProductionTotals {
  /** Id do grupo (máquina, linha ou unidade); `null` no total. */
  readonly id: string | null
  readonly name: string | null
  readonly minutes: number
  readonly runS: number
  readonly stopS: number
  readonly faultS: number
  readonly setupS: number
  readonly noCommS: number
  readonly total: number
  readonly reject: number
}

/** Somas de produção no período, agrupadas, só com as máquinas do escopo. */
export async function productionTotals(
  db: GatewayDb,
  ctx: TenantContext,
  range: SummaryRange,
  group: SummaryGroup,
): Promise<ProductionTotals[]> {
  assertPermission(ctx, "data.read")
  assertRange(range)
  const sums = {
    minutes: sql<number>`count(*)::int`,
    runS: sql<number>`coalesce(sum(${productionMinute.runS}), 0)::bigint`,
    stopS: sql<number>`coalesce(sum(${productionMinute.stopS}), 0)::bigint`,
    faultS: sql<number>`coalesce(sum(${productionMinute.faultS}), 0)::bigint`,
    setupS: sql<number>`coalesce(sum(${productionMinute.setupS}), 0)::bigint`,
    noCommS: sql<number>`coalesce(sum(${productionMinute.noCommS}), 0)::bigint`,
    total: sql<number>`coalesce(sum(${productionMinute.total}), 0)::bigint`,
    reject: sql<number>`coalesce(sum(${productionMinute.reject}), 0)::bigint`,
  }
  // O filtro de escopo vai na tabela `machine` (unidade e máquina), junto com o período.
  const where = and(
    gte(productionMinute.bucketStart, range.from),
    lt(productionMinute.bucketStart, range.to),
    machineScopeCondition(ctx.scope),
  )
  const joinMachine = and(eq(machine.id, productionMinute.machineId), eq(machine.organizationId, productionMinute.organizationId))

  const rows = await withContext(db, ctx, async (tx) => {
    switch (group) {
      case "total":
        return tx
          .select({ id: sql<string | null>`null`, name: sql<string | null>`null`, ...sums })
          .from(productionMinute)
          .innerJoin(machine, joinMachine)
          .where(where)
      case "machine":
        return tx
          .select({ id: machine.id, name: machine.name, ...sums })
          .from(productionMinute)
          .innerJoin(machine, joinMachine)
          .where(where)
          .groupBy(machine.id, machine.name)
          .orderBy(asc(machine.name), asc(machine.id))
      case "line":
        return tx
          .select({ id: line.id, name: line.name, ...sums })
          .from(productionMinute)
          .innerJoin(machine, joinMachine)
          .innerJoin(line, and(eq(line.id, machine.lineId), eq(line.organizationId, machine.organizationId)))
          .where(where)
          .groupBy(line.id, line.name)
          .orderBy(asc(line.name), asc(line.id))
      case "unit":
        return tx
          .select({ id: unit.id, name: unit.name, ...sums })
          .from(productionMinute)
          .innerJoin(machine, joinMachine)
          .innerJoin(unit, and(eq(unit.id, machine.unitId), eq(unit.organizationId, machine.organizationId)))
          .where(where)
          .groupBy(unit.id, unit.name)
          .orderBy(asc(unit.name), asc(unit.id))
    }
  })
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      minutes: Number(r.minutes),
      runS: Number(r.runS),
      stopS: Number(r.stopS),
      faultS: Number(r.faultS),
      setupS: Number(r.setupS),
      noCommS: Number(r.noCommS),
      total: Number(r.total),
      reject: Number(r.reject),
    }))
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value)
  // Fórmula no início vira texto (planilhas executam =, +, -, @); aspas duplicadas.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[";\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** CSV (separador `;`, padrão das planilhas em português) dos totais por máquina no escopo. */
export async function productionCsv(db: GatewayDb, ctx: TenantContext, range: SummaryRange): Promise<string> {
  const rows = await productionTotals(db, ctx, range, "machine")
  const header = ["Máquina", "Minutos", "Rodando (s)", "Parada (s)", "Falha (s)", "Setup (s)", "Sem comunicação (s)", "Peças", "Refugo"]
  const lines = rows.map((r) => [r.name, r.minutes, r.runS, r.stopS, r.faultS, r.setupS, r.noCommS, r.total, r.reject].map(csvCell).join(";"))
  return [header.join(";"), ...lines].join("\r\n")
}

export interface AlertCounts {
  readonly critical: number
  readonly warning: number
  readonly info: number
}

/** Alertas abertos por gravidade, no escopo. */
export async function openAlertCounts(db: GatewayDb, ctx: TenantContext): Promise<AlertCounts> {
  assertPermission(ctx, "data.read")
  const scoped: SQL =
    ctx.scope.kind === "all"
      ? sql`true`
      : sql`${alertEvent.machineId} IS NOT NULL AND ${machineIdScopeCondition(ctx.scope, alertEvent.machineId)}`
  const rows = await withContext(db, ctx, (tx) =>
    tx
      .select({ severity: alertEvent.severity, n: sql<number>`count(*)::int` })
      .from(alertEvent)
      .where(and(isNull(alertEvent.resolvedAt), scoped))
      .groupBy(alertEvent.severity),
  )
  const by = new Map(rows.map((r) => [r.severity as string, Number(r.n)]))
  return { critical: by.get("critical") ?? 0, warning: by.get("warning") ?? 0, info: by.get("info") ?? 0 }
}

export interface AuditEntry {
  readonly id: string
  readonly at: Date
  readonly actorType: string
  readonly actorLabel: string | null
  readonly action: string
  readonly entityType: string | null
  readonly entityId: string | null
  readonly unitId: string | null
  /** Concessão de suporte usada pela Engemase (chamado), quando houver. */
  readonly accessGrantId: string | null
  readonly before: unknown
  readonly after: unknown
}

/** Auditoria do cliente (mais recente primeiro), no escopo de quem lê. */
export async function listAuditEntries(
  db: GatewayDb,
  ctx: TenantContext,
  options: { readonly limit?: number; readonly before?: Date } = {},
): Promise<AuditEntry[]> {
  assertPermission(ctx, "audit.read")
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500)
  let scoped: SQL
  switch (ctx.scope.kind) {
    case "all":
      scoped = sql`true`
      break
    case "units":
      scoped = ctx.scope.unitIds.length > 0 ? inArray(auditLog.unitId, [...ctx.scope.unitIds]) : sql`false`
      break
    case "machines":
      scoped =
        ctx.scope.machineIds.length > 0
          ? and(eq(auditLog.entityType, "machine"), inArray(auditLog.entityId, [...ctx.scope.machineIds])) ?? sql`false`
          : sql`false`
      break
  }
  return withContext(db, ctx, (tx) =>
    tx
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorType: auditLog.actorType,
        actorLabel: auditLog.actorLabel,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        unitId: auditLog.unitId,
        accessGrantId: auditLog.accessGrantId,
        before: auditLog.before,
        after: auditLog.after,
      })
      .from(auditLog)
      .where(and(scoped, options.before === undefined ? undefined : lt(auditLog.at, options.before)))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit),
  )
}
