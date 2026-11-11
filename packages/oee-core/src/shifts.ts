import { OeeInputError } from "./errors.js";
import { clipInterval, normalizeIntervals } from "./intervals.js";
import {
  addDays,
  assertTimeZone,
  isoWeekday,
  localDateTimeToInstant,
  parsePlainDate,
  parseTimeOfDay,
  type IsoWeekday,
} from "./timezone.js";
import type { Instant, Interval, ScheduledWindow } from "./types.js";

const DAY_MINUTES = 24 * 60;

/** Pausa planejada dentro do turno (ex.: refeição), em horário local `HH:MM`. */
export interface ShiftBreakDefinition {
  readonly start: string;
  readonly end: string;
  readonly name?: string;
}

/**
 * Definição de turno (`shift`).
 *
 * - `end <= start` significa que o turno atravessa a meia-noite; `end === start` é um turno de 24 h.
 * - `daysOfWeek` são os dias ISO (1 = segunda … 7 = domingo) em que o turno **começa**.
 * - Pausas são interpretadas dentro do turno: num turno 22:00–06:00, a pausa 02:00–02:30
 *   cai no dia seguinte à data do turno.
 * - `validFrom`/`validTo` (vigência, inclusivas) comparam com a data de início do turno.
 */
export interface ShiftDefinition {
  readonly id: string;
  readonly name?: string;
  readonly start: string;
  readonly end: string;
  readonly daysOfWeek: readonly IsoWeekday[];
  readonly breaks?: readonly ShiftBreakDefinition[];
  readonly validFrom?: string;
  readonly validTo?: string;
}

/** Ocorrência concreta de um turno, em UTC. */
export interface ShiftWindow extends ScheduledWindow {
  readonly shiftId: string;
  /** Data local de início do turno (`shift_date`). Turno noturno pertence à data em que começa. */
  readonly shiftDate: string;
  readonly start: Instant;
  readonly end: Instant;
  /** Pausas planejadas do turno, em UTC, ordenadas e dentro do turno. */
  readonly breaks: readonly Interval[];
}

export interface GenerateShiftWindowsInput {
  readonly shifts: readonly ShiftDefinition[];
  /** Fuso IANA da planta, ex.: `America/Sao_Paulo`. */
  readonly timeZone: string;
  /** Primeira data de turno (inclusiva), `YYYY-MM-DD`. */
  readonly from: string;
  /** Última data de turno (inclusiva), `YYYY-MM-DD`. */
  readonly to: string;
}

interface CompiledShift {
  readonly definition: ShiftDefinition;
  readonly startMinute: number;
  readonly durationMinutes: number;
  readonly breaks: readonly { readonly from: number; readonly to: number }[];
  readonly days: ReadonlySet<IsoWeekday>;
}

function compileShift(shift: ShiftDefinition): CompiledShift {
  const label = shift.name ?? shift.id;
  const startMinute = parseTimeOfDay(shift.start);
  const endMinute = parseTimeOfDay(shift.end);
  const durationMinutes = (endMinute - startMinute + DAY_MINUTES) % DAY_MINUTES || DAY_MINUTES;

  for (const day of shift.daysOfWeek) {
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      throw new OeeInputError(`Turno "${label}": dia da semana inválido (${String(day)}). Use 1 (segunda) a 7 (domingo).`);
    }
  }
  if (shift.validFrom !== undefined) parsePlainDate(shift.validFrom);
  if (shift.validTo !== undefined) parsePlainDate(shift.validTo);

  const breaks = (shift.breaks ?? []).map((b) => {
    const offset = (time: string): number => (parseTimeOfDay(time) - startMinute + DAY_MINUTES) % DAY_MINUTES;
    const from = offset(b.start);
    const rawTo = offset(b.end);
    const to = rawTo === 0 ? DAY_MINUTES : rawTo;
    if (to <= from || to > durationMinutes) {
      throw new OeeInputError(
        `Turno "${label}" (${shift.start}–${shift.end}): pausa ${b.name ? `"${b.name}" ` : ""}(${b.start}–${b.end}) fora do turno.`,
      );
    }
    return { from, to };
  });

  return { definition: shift, startMinute, durationMinutes, breaks, days: new Set(shift.daysOfWeek) };
}

/** Instante UTC de "data do turno + N minutos a partir da meia-noite local" (N pode passar de 24 h). */
function instantAt(shiftDate: string, minuteOfDay: number, timeZone: string): Instant {
  const date = addDays(shiftDate, Math.floor(minuteOfDay / DAY_MINUTES));
  const minute = minuteOfDay % DAY_MINUTES;
  return localDateTimeToInstant({ ...parsePlainDate(date), hour: Math.floor(minute / 60), minute: minute % 60 }, timeZone);
}

/**
 * Gera as janelas de turno (UTC) para as datas `[from, to]` no fuso da planta.
 * O resultado vem ordenado por início (e pelo id do turno em caso de empate).
 */
export function generateShiftWindows(input: GenerateShiftWindowsInput): ShiftWindow[] {
  const { timeZone, from, to } = input;
  assertTimeZone(timeZone);
  parsePlainDate(from);
  parsePlainDate(to);
  if (from > to) throw new OeeInputError(`Período inválido: ${from} é depois de ${to}.`);

  const compiled = input.shifts.map(compileShift);
  const windows: ShiftWindow[] = [];

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const weekday = isoWeekday(date);
    for (const shift of compiled) {
      const { definition } = shift;
      if (!shift.days.has(weekday)) continue;
      if (definition.validFrom !== undefined && date < definition.validFrom) continue;
      if (definition.validTo !== undefined && date > definition.validTo) continue;

      const start = instantAt(date, shift.startMinute, timeZone);
      const end = instantAt(date, shift.startMinute + shift.durationMinutes, timeZone);
      if (end <= start) continue; // turno engolido por uma transição de fuso (caso patológico)
      const window = { start, end };
      const breaks = normalizeIntervals(
        shift.breaks
          .map((b) =>
            clipInterval(
              {
                start: instantAt(date, shift.startMinute + b.from, timeZone),
                end: instantAt(date, shift.startMinute + b.to, timeZone),
              },
              window,
            ),
          )
          .filter((b): b is Interval => b !== null),
      );
      windows.push({ shiftId: definition.id, shiftDate: date, start, end, breaks });
    }
  }

  return windows.sort((a, b) => a.start - b.start || (a.shiftId < b.shiftId ? -1 : a.shiftId > b.shiftId ? 1 : 0));
}

/** Janela de turno que contém o instante (a primeira, se houver sobreposição), ou `null`. */
export function findShiftWindowAt(windows: readonly ShiftWindow[], instant: Instant): ShiftWindow | null {
  return windows.find((w) => w.start <= instant && instant < w.end) ?? null;
}
