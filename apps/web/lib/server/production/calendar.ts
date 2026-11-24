/**
 * Calendário de turnos (L2 do docs/17): conversão das linhas de `shift` para o formato do
 * `@engemase/oee-core` e as janelas de turno de uma unidade, já sem os feriados.
 *
 * - O turno pertence ao dia em que COMEÇA (turno noturno de segunda é de segunda).
 * - Feriado da unidade (`unit_holiday`): nenhum turno começa naquele dia (tempo não planejado).
 * - Mudança de turno vale dali para a frente: é uma linha nova com `valid_from` (e a antiga com `valid_to`).
 */
import type { ShiftBreak } from "@engemase/db"
import { generateShiftWindows, type IsoWeekday, type ShiftDefinition, type ShiftWindow } from "@engemase/oee-core"

/** Colunas de `shift` usadas no cálculo. */
export interface ShiftRow {
  readonly id: string
  readonly name: string
  /** `HH:MM` ou `HH:MM:SS` (como o Postgres devolve `time`). */
  readonly startTime: string
  readonly endTime: string
  readonly daysOfWeek: readonly number[]
  readonly breaks: readonly ShiftBreak[] | null
  readonly validFrom: string | null
  readonly validTo: string | null
}

/** `HH:MM:SS` → `HH:MM`. */
export function hhmm(time: string): string {
  return time.slice(0, 5)
}

export function toShiftDefinition(row: ShiftRow): ShiftDefinition {
  return {
    id: row.id,
    name: row.name,
    start: hhmm(row.startTime),
    end: hhmm(row.endTime),
    daysOfWeek: row.daysOfWeek as readonly IsoWeekday[],
    breaks: (row.breaks ?? []).map((b) => ({ start: hhmm(b.start), end: hhmm(b.end), ...(b.name !== undefined ? { name: b.name } : {}) })),
    ...(row.validFrom !== null ? { validFrom: row.validFrom } : {}),
    ...(row.validTo !== null ? { validTo: row.validTo } : {}),
  }
}

/** Janelas (UTC) dos turnos da unidade com data de início em `[from, to]`, sem os dias de feriado. */
export function unitShiftWindows(input: {
  readonly shifts: readonly ShiftRow[]
  readonly timeZone: string
  readonly from: string
  readonly to: string
  readonly holidays: ReadonlySet<string>
}): ShiftWindow[] {
  if (input.shifts.length === 0) return []
  return generateShiftWindows({
    shifts: input.shifts.map(toShiftDefinition),
    timeZone: input.timeZone,
    from: input.from,
    to: input.to,
  }).filter((w) => !input.holidays.has(w.shiftDate))
}

/**
 * A janela de UM turno numa data, mesmo que hoje o cadastro não o tenha mais naquele dia da semana ou
 * vigência (recálculo de um turno já consolidado: vale o horário do próprio turno, L2).
 */
export function shiftWindowOn(row: ShiftRow, shiftDate: string, timeZone: string): ShiftWindow | null {
  const [window] = generateShiftWindows({
    shifts: [{ ...toShiftDefinition({ ...row, validFrom: null, validTo: null }), daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }],
    timeZone,
    from: shiftDate,
    to: shiftDate,
  })
  return window ?? null
}
