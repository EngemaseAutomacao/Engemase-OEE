/**
 * Dados do relatório de paradas, montados no SERVIDOR a partir de `getPareto` (últimos 7 dias).
 * As semanas anteriores e as paradas sem motivo são derivadas de forma determinística
 * (seededRandom), para permitir o filtro de 14 dias e a comparação com o período anterior.
 */
import { getPareto, seededRandom } from "@/lib/mock"
import type { ReasonCategory } from "@/lib/mock/types"
import { UNCLASSIFIED_ID, UNCLASSIFIED_NAME } from "./report-utils"

export interface StopRecord {
  machineId: string
  /** 0 = últimos 7 dias; 1 = de 8 a 14 dias atrás; 2 e 3 = semanas anteriores (base de comparação). */
  week: number
  reasonId: string
  reasonName: string
  category: ReasonCategory
  minutes: number
  occurrences: number
}

export const STOP_WEEKS = 4

export function buildStopRecords(machineIds: string[]): StopRecord[] {
  const out: StopRecord[] = []
  for (const machineId of machineIds) {
    const base = getPareto([machineId])
    if (base.length === 0) continue
    for (let week = 0; week < STOP_WEEKS; week++) {
      const r = seededRandom(`relatorio-paradas:${machineId}:${week}`)
      let unplannedMin = 0
      for (const item of base) {
        const minutes = week === 0 ? item.minutes : Math.round(item.minutes * (0.7 + r() * 0.6))
        const occurrences = week === 0 ? item.occurrences : Math.max(1, Math.round(item.occurrences * (0.75 + r() * 0.5)))
        if (minutes < 3) continue
        if (item.category === "unplanned") unplannedMin += minutes
        out.push({ machineId, week, reasonId: item.reasonId, reasonName: item.reasonName, category: item.category, minutes, occurrences })
      }
      // paradas não planejadas que o operador não classificou (em geral curtas, de 2 a 6 min)
      const noneMin = Math.round(unplannedMin * (0.02 + r() * 0.04))
      if (noneMin > 0) {
        out.push({
          machineId,
          week,
          reasonId: UNCLASSIFIED_ID,
          reasonName: UNCLASSIFIED_NAME,
          category: "unplanned",
          minutes: noneMin,
          occurrences: Math.max(1, Math.round(noneMin / (2.5 + r() * 3.5))),
        })
      }
    }
  }
  return out
}
