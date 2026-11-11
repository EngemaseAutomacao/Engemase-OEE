/**
 * Cálculos PUROS do relatório de paradas (Pareto, MTBF/MTTR, % sem motivo).
 */
import type { ReasonCategory } from "@/lib/mock/types"
import type { StopRecord } from "./stops-data"
import { CATEGORY_ORDER, UNCLASSIFIED_ID } from "./report-utils"

/**
 * Tempo planejado de produção por máquina e por dia usado nas estimativas de MTBF:
 * 2 turnos de 7h30 (a mesma base do relatório de OEE).
 */
export const PLANNED_MIN_PER_MACHINE_DAY = 900

export type CategoryFilter = "all" | ReasonCategory

export interface ReasonRow {
  reasonId: string
  reasonName: string
  category: ReasonCategory
  minutes: number
  occurrences: number
  /** Fração do tempo total parado (0–1). */
  share: number
  /** Fração acumulada (Pareto). */
  cumulative: number
}

export function paretoRows(records: StopRecord[]): ReasonRow[] {
  const acc = new Map<string, Omit<ReasonRow, "share" | "cumulative">>()
  for (const r of records) {
    const cur = acc.get(r.reasonId) ?? { reasonId: r.reasonId, reasonName: r.reasonName, category: r.category, minutes: 0, occurrences: 0 }
    cur.minutes += r.minutes
    cur.occurrences += r.occurrences
    acc.set(r.reasonId, cur)
  }
  const list = [...acc.values()].sort((a, b) => b.minutes - a.minutes || a.reasonName.localeCompare(b.reasonName))
  const total = list.reduce((s, x) => s + x.minutes, 0)
  let run = 0
  return list.map((x) => {
    run += x.minutes
    return { ...x, share: total > 0 ? x.minutes / total : 0, cumulative: total > 0 ? run / total : 0 }
  })
}

export interface CategoryTotal {
  category: ReasonCategory
  minutes: number
  occurrences: number
}

export function categoryTotals(records: StopRecord[]): CategoryTotal[] {
  return CATEGORY_ORDER.map((category) => {
    const list = records.filter((r) => r.category === category)
    return {
      category,
      minutes: list.reduce((s, r) => s + r.minutes, 0),
      occurrences: list.reduce((s, r) => s + r.occurrences, 0),
    }
  })
}

export interface StopSummary {
  /** Tempo e ocorrências na categoria filtrada. */
  totalMin: number
  occurrences: number
  /** Tempo planejado de produção (base de MTBF e de % do tempo). */
  plannedMin: number
  /** MTBF/MTTR consideram só as paradas NÃO planejadas (independem do filtro de categoria). */
  mtbfMin: number | null
  mttrMin: number | null
  /** Paradas sem motivo ÷ paradas que exigem motivo (não planejadas + setup). */
  unclassifiedRate: number | null
  unclassifiedOcc: number
  unclassifiedMin: number
}

export function summarize(records: StopRecord[], category: CategoryFilter, machineCount: number, days: number): StopSummary {
  const inCat = category === "all" ? records : records.filter((r) => r.category === category)
  const sum = (list: StopRecord[], k: "minutes" | "occurrences") => list.reduce((s, r) => s + r[k], 0)
  const unplanned = records.filter((r) => r.category === "unplanned")
  const setup = records.filter((r) => r.category === "setup")
  const none = unplanned.filter((r) => r.reasonId === UNCLASSIFIED_ID)
  const plannedMin = machineCount * days * PLANNED_MIN_PER_MACHINE_DAY
  const unplannedMin = sum(unplanned, "minutes")
  const unplannedOcc = sum(unplanned, "occurrences")
  const runMin = Math.max(0, plannedMin - unplannedMin - sum(setup, "minutes"))
  const needReason = unplannedOcc + sum(setup, "occurrences")
  return {
    totalMin: sum(inCat, "minutes"),
    occurrences: sum(inCat, "occurrences"),
    plannedMin,
    mtbfMin: unplannedOcc > 0 ? runMin / unplannedOcc : null,
    mttrMin: unplannedOcc > 0 ? unplannedMin / unplannedOcc : null,
    unclassifiedRate: needReason > 0 ? sum(none, "occurrences") / needReason : null,
    unclassifiedOcc: sum(none, "occurrences"),
    unclassifiedMin: sum(none, "minutes"),
  }
}
