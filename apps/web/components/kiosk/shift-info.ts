/**
 * Turno corrente de uma unidade a partir do cadastro de turnos (lib/mock).
 * Funções puras, seguras em componentes de servidor: o "agora" é sempre MOCK_NOW
 * (ou um ISO informado), nunca o relógio do sistema.
 */
import { DEFAULT_TZ, MOCK_NOW, getShifts, getUnit } from "@/lib/mock"

export interface ShiftInfo {
  id: string
  name: string
  /** "06:00" */
  start: string
  /** "14:00" */
  end: string
  /** Minutos corridos desde o início do turno. */
  elapsedMin: number
  /** Duração total do turno em minutos. */
  totalMin: number
  /** Tempo planejado já decorrido (sem pausas), em minutos. */
  plannedElapsedMin: number
  /** Tempo planejado total do turno (sem pausas), em minutos. */
  plannedTotalMin: number
  /** 0–1: fração do turno já decorrida. */
  progress: number
  /** 0–1: fração do tempo planejado já decorrida (base do "ritmo esperado"). */
  plannedProgress: number
  remainingMin: number
  /** Pausa em andamento agora, se houver. */
  onBreak: string | null
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function localClock(iso: string, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(iso))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "0"
  return { minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")), weekday: WEEKDAY[get("weekday")] ?? 0 }
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/** Turno em andamento na unidade (considera turnos que atravessam a meia-noite). */
export function currentShift(clientId: string, unitId: string, nowIso: string = MOCK_NOW): ShiftInfo | null {
  const tz = getUnit(unitId)?.timezone ?? DEFAULT_TZ
  const { minutes, weekday } = localClock(nowIso, tz)

  for (const s of getShifts(clientId, unitId)) {
    const start = toMin(s.start)
    let end = toMin(s.end)
    if (end <= start) end += 24 * 60
    const totalMin = end - start

    let rel = minutes - start
    let day = weekday
    if (rel < 0) {
      // turno que começou ontem e atravessa a meia-noite
      rel += 24 * 60
      day = (weekday + 6) % 7
    }
    if (rel >= totalMin || !s.days.includes(day)) continue

    const breaks = s.breaks.map((b) => {
      let b0 = toMin(b.start) - start
      if (b0 < 0) b0 += 24 * 60
      let b1 = toMin(b.end) - start
      if (b1 <= b0) b1 += 24 * 60
      return { name: b.name, b0, b1 }
    })
    const breakTotal = breaks.reduce((acc, b) => acc + overlap(b.b0, b.b1, 0, totalMin), 0)
    const breakElapsed = breaks.reduce((acc, b) => acc + overlap(b.b0, b.b1, 0, rel), 0)
    const plannedTotalMin = Math.max(1, totalMin - breakTotal)
    const plannedElapsedMin = Math.max(0, rel - breakElapsed)

    return {
      id: s.id,
      name: s.name,
      start: s.start,
      end: s.end,
      elapsedMin: rel,
      totalMin,
      plannedElapsedMin,
      plannedTotalMin,
      progress: rel / totalMin,
      plannedProgress: Math.min(1, plannedElapsedMin / plannedTotalMin),
      remainingMin: totalMin - rel,
      onBreak: breaks.find((b) => rel >= b.b0 && rel < b.b1)?.name ?? null,
    }
  }
  return null
}

/** Peças esperadas até agora para manter o ritmo da meta do turno. */
export function expectedByNow(targetShift: number, shift: ShiftInfo | null): number | null {
  if (!shift || targetShift <= 0) return null
  return Math.round(targetShift * shift.plannedProgress)
}
