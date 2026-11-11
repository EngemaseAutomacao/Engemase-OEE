/**
 * Utilitários PUROS da tela de turnos (sem relógio): intervalos na semana, sobreposição,
 * tempo planejado e datas "AAAA-MM-DD" tratadas como datas civis (sem fuso).
 */
import { WEEKDAYS, hmToMin, spanMin } from "@/components/config/labels"

export interface ShiftBreak {
  name: string
  start: string
  end: string
}

export interface ShiftRow {
  id: string
  unitId: string
  name: string
  start: string
  end: string
  /** 0 = domingo */
  days: number[]
  breaks: ShiftBreak[]
}

export type Recurrence = "none" | "weekly" | "monthly"

export interface PlannedStop {
  id: string
  unitId: string
  title: string
  reasonId: string
  /** "unit" = unidade inteira; senão, IDs das máquinas. */
  scope: "unit" | string[]
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  recurrence: Recurrence
}

export const WEEK_MIN = 7 * 1440

/** Linha da régua (0 = segunda … 6 = domingo) a partir do dia da semana (0 = domingo). */
export const rowOfDay = (d: number) => (d + 6) % 7

/** Duração do turno e das pausas, em minutos. */
export function shiftMinutes(s: Pick<ShiftRow, "start" | "end" | "breaks">) {
  const total = spanMin(s.start, s.end)
  const breaks = s.breaks.reduce((acc, b) => acc + spanMin(b.start, b.end), 0)
  return { total, breaks, planned: Math.max(0, total - breaks) }
}

/** Minuto do início da pausa relativo ao início do turno (pausas depois da meia-noite caem no dia seguinte). */
export const breakOffset = (s: Pick<ShiftRow, "start">, b: ShiftBreak) => (hmToMin(b.start) - hmToMin(s.start) + 1440) % 1440

/** A pausa está dentro do horário do turno? */
export function breakInside(s: Pick<ShiftRow, "start" | "end">, b: ShiftBreak): boolean {
  const off = breakOffset(s, b)
  return off + spanMin(b.start, b.end) <= spanMin(s.start, s.end)
}

export interface WeekInterval {
  /** minutos desde segunda 00:00 (pode passar de WEEK_MIN; use `clipToRows`) */
  from: number
  to: number
}

/** Intervalos de trabalho de um turno na semana-modelo (um por dia ativo). */
export function shiftIntervals(s: Pick<ShiftRow, "start" | "end" | "days">): WeekInterval[] {
  const span = spanMin(s.start, s.end)
  return s.days.map((d) => {
    const from = rowOfDay(d) * 1440 + hmToMin(s.start)
    return { from, to: from + span }
  })
}

/** Intervalos das pausas de um turno na semana-modelo. */
export function breakIntervals(s: Pick<ShiftRow, "start" | "end" | "days" | "breaks">): (WeekInterval & { name: string })[] {
  return s.days.flatMap((d) =>
    s.breaks.map((b) => {
      const from = rowOfDay(d) * 1440 + hmToMin(s.start) + breakOffset(s, b)
      return { from, to: from + spanMin(b.start, b.end), name: b.name }
    }),
  )
}

/** Recorta um intervalo nas linhas da régua (dias), com volta de domingo para segunda. */
export function clipToRows(iv: WeekInterval): { row: number; from: number; to: number }[] {
  const out: { row: number; from: number; to: number }[] = []
  let a = iv.from
  while (a < iv.to) {
    const dayStart = Math.floor(a / 1440) * 1440
    const b = Math.min(iv.to, dayStart + 1440)
    out.push({ row: (Math.floor(a / 1440) % 7 + 7) % 7, from: a - dayStart, to: b - dayStart })
    a = b
  }
  return out
}

/** Pares de turnos que se sobrepõem em algum dia (mesma unidade). */
export function shiftOverlaps(list: ShiftRow[]): [ShiftRow, ShiftRow][] {
  const out: [ShiftRow, ShiftRow][] = []
  const norm = (iv: WeekInterval) => {
    const parts = [iv]
    if (iv.to > WEEK_MIN) parts.push({ from: iv.from - WEEK_MIN, to: iv.to - WEEK_MIN })
    return parts
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = shiftIntervals(list[i]).flatMap(norm)
      const b = shiftIntervals(list[j]).flatMap(norm)
      if (a.some((x) => b.some((y) => x.from < y.to && y.from < x.to))) out.push([list[i], list[j]])
    }
  }
  return out
}

/** Minutos de cobertura num dia da semana (0 = domingo), contando turnos que vêm da véspera. */
export function coverageMinutes(list: ShiftRow[], day: number): number {
  const row = rowOfDay(day)
  const mins = new Uint8Array(1440)
  for (const s of list) {
    for (const iv of shiftIntervals(s)) {
      for (const c of clipToRows(iv)) {
        if (c.row !== row) continue
        for (let m = c.from; m < c.to; m++) mins[m] = 1
      }
    }
  }
  return mins.reduce((a, v) => a + v, 0)
}

// ---------------------------------------------------------------------------
// Datas civis "AAAA-MM-DD"
// ---------------------------------------------------------------------------

const toUtc = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)

export function addDays(ymd: string, n: number): string {
  return new Date(toUtc(ymd) + n * 86_400_000).toISOString().slice(0, 10)
}

export const diffDays = (a: string, b: string) => Math.round((toUtc(a) - toUtc(b)) / 86_400_000)

/** 0 = domingo */
export const weekdayOf = (ymd: string) => new Date(toUtc(ymd)).getUTCDay()

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]

/** "20/11" */
export const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`

/** { day: "20", month: "nov", weekday: "Sex" } */
export function dateParts(ymd: string) {
  const w = WEEKDAYS.find((x) => x.d === weekdayOf(ymd))
  return { day: ymd.slice(8, 10), month: MONTHS[Number(ymd.slice(5, 7)) - 1], weekday: w?.label ?? "" }
}

/** Minutos desde o início da semana-modelo (segunda `weekStart`) para data + hora. */
export const weekMinutes = (weekStart: string, ymd: string, hm: string) => diffDays(ymd, weekStart) * 1440 + hmToMin(hm)

/** Duração de uma parada planejada em minutos. */
export const stopMinutes = (p: Pick<PlannedStop, "startDate" | "startTime" | "endDate" | "endTime">) => diffDays(p.endDate, p.startDate) * 1440 + hmToMin(p.endTime) - hmToMin(p.startTime)
