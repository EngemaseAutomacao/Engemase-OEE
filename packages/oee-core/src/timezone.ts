import { OeeInputError } from "./errors.js";
import type { Instant } from "./types.js";

/**
 * Conversões entre horário local da planta (fuso IANA) e UTC, sem dependências externas
 * (usa `Intl.DateTimeFormat`). Não presume ausência de horário de verão.
 *
 * Horários locais ambíguos ou inexistentes seguem a regra "compatible" do Temporal/RFC 5545:
 * - na **sobreposição** (o relógio volta), vale a primeira ocorrência;
 * - no **buraco** (o relógio adianta), o horário é empurrado para depois do buraco.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Data local `YYYY-MM-DD` já validada, em partes. */
export interface PlainDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Data e hora locais (sem fuso). */
export interface LocalDateTime extends PlainDateParts {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** Dia da semana ISO: 1 = segunda … 7 = domingo. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      throw new OeeInputError(`Fuso horário inválido: "${timeZone}". Use um nome IANA, ex.: "America/Sao_Paulo".`);
    }
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Lança `OeeInputError` se o fuso não for um nome IANA reconhecido. */
export function assertTimeZone(timeZone: string): void {
  formatterFor(timeZone);
}

/** Data e hora locais de um instante no fuso indicado. */
export function toLocalDateTime(instant: Instant, timeZone: string): LocalDateTime {
  if (!Number.isFinite(instant)) throw new OeeInputError(`Instante inválido: ${String(instant)}.`);
  const parts = formatterFor(timeZone).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) throw new Error(`Intl não devolveu a parte "${type}".`);
    return Number(part.value);
  };
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour") % 24,
    minute: pick("minute"),
    second: pick("second"),
  };
}

/** Diferença (ms) entre o horário local e o UTC no instante dado. Ex.: São Paulo = −3 h. */
export function timeZoneOffsetMs(instant: Instant, timeZone: string): number {
  const msPart = ((instant % 1000) + 1000) % 1000;
  const whole = instant - msPart;
  const local = toLocalDateTime(whole, timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return asUtc - whole;
}

/** Converte data e hora locais da planta em instante UTC (regra "compatible"). */
export function localDateTimeToInstant(
  local: PlainDateParts & { readonly hour: number; readonly minute: number },
  timeZone: string,
): Instant {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const offsetBefore = timeZoneOffsetMs(wall - DAY_MS, timeZone);
  const offsetAfter = timeZoneOffsetMs(wall + DAY_MS, timeZone);
  const candidates = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => wall - offset)
    .filter((utc) => utc + timeZoneOffsetMs(utc, timeZone) === wall)
    .sort((a, b) => a - b);
  const first = candidates[0];
  if (first !== undefined) return first;
  // Buraco (horário inexistente): aplica o deslocamento de antes da transição.
  return wall - offsetBefore;
}

/** Converte `YYYY-MM-DD` + `HH:MM` locais da planta em instante UTC. */
export function zonedDateTimeToInstant(date: string, time: string, timeZone: string): Instant {
  const { year, month, day } = parsePlainDate(date);
  const minutes = parseTimeOfDay(time);
  return localDateTimeToInstant({ year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60 }, timeZone);
}

/** Data local (`YYYY-MM-DD`) da planta no instante dado. */
export function plantDateOf(instant: Instant, timeZone: string): string {
  return formatPlainDate(toLocalDateTime(instant, timeZone));
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Valida e decompõe uma data `YYYY-MM-DD`. */
export function parsePlainDate(date: string): PlainDateParts {
  const match = DATE_RE.exec(date);
  if (match === null) throw new OeeInputError(`Data inválida: "${date}". Use o formato AAAA-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new OeeInputError(`Data inexistente: "${date}".`);
  }
  return { year, month, day };
}

/** Formata partes de data como `YYYY-MM-DD`. */
export function formatPlainDate({ year, month, day }: PlainDateParts): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Valida `HH:MM` (00:00 a 23:59) e devolve minutos desde a meia-noite. */
export function parseTimeOfDay(time: string): number {
  const match = TIME_RE.exec(time);
  if (match === null) throw new OeeInputError(`Horário inválido: "${time}". Use o formato HH:MM (00:00 a 23:59).`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Soma dias a uma data `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parsePlainDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return formatPlainDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** Dia da semana ISO (1 = segunda … 7 = domingo) de uma data `YYYY-MM-DD`. */
export function isoWeekday(date: string): IsoWeekday {
  const { year, month, day } = parsePlainDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (weekday === 0 ? 7 : weekday) as IsoWeekday;
}

/** Converte minutos em ms (atalho legível). */
export function minutesToMs(minutes: number): number {
  return minutes * MINUTE_MS;
}
