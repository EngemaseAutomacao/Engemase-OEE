/**
 * Cálculos PUROS do relatório de OEE (agregação por período, turno, máquina).
 * Regra de docs/07: OEE agregado = Σ(boas × ciclo ideal) ÷ Σ tempo planejado — nunca média simples.
 * Aqui o tempo ideal de cada turno é derivado de operação × performance, e o tempo
 * efetivo (boas × ciclo ideal) de ideal × boas ÷ total. Assim D × P × Q fecha com o OEE.
 */
import type { ShiftOeeRow } from "@/lib/mock"

export type GroupBy = "day" | "shift" | "machine"

export interface MachineOption {
  id: string
  name: string
  code: string
  unitId: string
  lineId: string
}

export interface OeeAgg {
  rows: number
  plannedMin: number
  runMin: number
  /** Tempo ideal (contagem total × ciclo ideal). */
  idealMin: number
  /** Tempo efetivo (peças boas × ciclo ideal). */
  effectiveMin: number
  total: number
  good: number
  reject: number
  availability: number | null
  performance: number | null
  quality: number | null
  oee: number | null
}

export function aggregate(rows: ShiftOeeRow[]): OeeAgg {
  let plannedMin = 0
  let runMin = 0
  let idealMin = 0
  let effectiveMin = 0
  let total = 0
  let good = 0
  let reject = 0
  for (const r of rows) {
    const ideal = r.runMin * r.performance
    plannedMin += r.plannedMin
    runMin += r.runMin
    idealMin += ideal
    effectiveMin += r.total > 0 ? ideal * (r.good / r.total) : 0
    total += r.total
    good += r.good
    reject += r.reject
  }
  return {
    rows: rows.length,
    plannedMin,
    runMin,
    idealMin,
    effectiveMin,
    total,
    good,
    reject,
    availability: plannedMin > 0 ? runMin / plannedMin : null,
    performance: runMin > 0 ? idealMin / runMin : null,
    quality: idealMin > 0 ? effectiveMin / idealMin : null,
    oee: plannedMin > 0 ? effectiveMin / plannedMin : null,
  }
}

/** Datas do período atual (últimos N dias com dados) e do período anterior de mesmo tamanho. */
export function splitPeriods(dates: string[], days: number) {
  const sorted = [...new Set(dates)].sort()
  return {
    dates: sorted.slice(-days),
    previousDates: sorted.slice(Math.max(0, sorted.length - 2 * days), Math.max(0, sorted.length - days)),
  }
}

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    const list = out.get(k)
    if (list) list.push(it)
    else out.set(k, [it])
  }
  return out
}

export interface TableGroup {
  key: string
  agg: OeeAgg
  rows: ShiftOeeRow[]
  days: number
  shifts: number
  machines: number
}

/** Agrupa as linhas da tabela detalhada (com subtotal por grupo). */
export function tableGroups(rows: ShiftOeeRow[], by: GroupBy, machineOrder: Map<string, number>): TableGroup[] {
  const keyOf = (r: ShiftOeeRow) => (by === "day" ? r.date : by === "shift" ? r.shiftName : r.machineId)
  const mo = (id: string) => machineOrder.get(id) ?? 999
  const groups = [...groupBy(rows, keyOf)].map(([key, list]) => ({
    key,
    agg: aggregate(list),
    rows: [...list].sort((a, b) => {
      if (by !== "day" && a.date !== b.date) return b.date.localeCompare(a.date)
      if (by !== "shift" && a.shiftName !== b.shiftName) return a.shiftName.localeCompare(b.shiftName)
      return mo(a.machineId) - mo(b.machineId)
    }),
    days: new Set(list.map((r) => r.date)).size,
    shifts: new Set(list.map((r) => r.shiftName)).size,
    machines: new Set(list.map((r) => r.machineId)).size,
  }))
  return groups.sort((a, b) =>
    by === "day" ? b.key.localeCompare(a.key) : by === "shift" ? a.key.localeCompare(b.key) : mo(a.key) - mo(b.key),
  )
}

export interface TrendPoint {
  date: string
  oee: number | null
  availability: number | null
  performance: number | null
  quality: number | null
}

export function dailyTrend(rows: ShiftOeeRow[], dates: string[]): TrendPoint[] {
  const byDate = groupBy(rows, (r) => r.date)
  return dates.map((date) => {
    const a = aggregate(byDate.get(date) ?? [])
    return { date, oee: a.oee, availability: a.availability, performance: a.performance, quality: a.quality }
  })
}

export interface RankingItem {
  machineId: string
  name: string
  code: string
  oee: number
  availability: number
  performance: number
  quality: number
}

export function machineRanking(rows: ShiftOeeRow[], machines: MachineOption[]): RankingItem[] {
  const byMachine = groupBy(rows, (r) => r.machineId)
  const out: RankingItem[] = []
  for (const m of machines) {
    const list = byMachine.get(m.id)
    if (!list?.length) continue
    const a = aggregate(list)
    if (a.oee === null) continue
    out.push({
      machineId: m.id,
      name: m.name,
      code: m.code,
      oee: a.oee,
      availability: a.availability ?? 0,
      performance: a.performance ?? 0,
      quality: a.quality ?? 0,
    })
  }
  return out.sort((a, b) => b.oee - a.oee)
}
