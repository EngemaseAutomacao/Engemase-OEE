import { OeeInputError } from "./errors.js";
import type { Interval } from "./types.js";

/**
 * Álgebra de intervalos semiabertos `[start, end)` em milissegundos.
 *
 * As funções aceitam listas em qualquer ordem e devolvem listas **normalizadas**:
 * ordenadas, sem sobreposição, sem intervalos vazios e com vizinhos encostados fundidos.
 * `end` pode ser `Infinity` (evento em aberto); a interseção com uma janela finita o limita.
 */

function assertValid(interval: Interval): void {
  const { start, end } = interval;
  if (Number.isNaN(start) || Number.isNaN(end) || start === Infinity || end === -Infinity) {
    throw new OeeInputError(`Intervalo inválido: [${String(start)}, ${String(end)}).`);
  }
  if (end < start) {
    throw new OeeInputError(
      `Intervalo com fim antes do início: [${new Date(start).toISOString()}, ${String(end)}).`,
    );
  }
}

/** Ordena, descarta vazios e funde intervalos sobrepostos ou encostados. */
export function normalizeIntervals(intervals: readonly Interval[]): Interval[] {
  const valid: Interval[] = [];
  for (const interval of intervals) {
    assertValid(interval);
    if (interval.end > interval.start) valid.push({ start: interval.start, end: interval.end });
  }
  valid.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Interval[] = [];
  for (const current of valid) {
    const last = merged[merged.length - 1];
    if (last !== undefined && current.start <= last.end) {
      if (current.end > last.end) merged[merged.length - 1] = { start: last.start, end: current.end };
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/** Recorta um intervalo pela janela. Devolve `null` se não houver sobreposição. */
export function clipInterval<T extends Interval>(interval: T, window: Interval): T | null {
  const start = Math.max(interval.start, window.start);
  const end = Math.min(interval.end, window.end);
  if (end <= start) return null;
  return { ...interval, start, end };
}

/** Recorta uma lista de intervalos pela janela (resultado normalizado). */
export function clipIntervals(intervals: readonly Interval[], window: Interval): Interval[] {
  return intersectIntervals(intervals, [window]);
}

/** União de várias listas. */
export function unionIntervals(...lists: readonly (readonly Interval[])[]): Interval[] {
  return normalizeIntervals(lists.flat());
}

/** Interseção de duas listas. */
export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const left = normalizeIntervals(a);
  const right = normalizeIntervals(b);
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const x = left[i] as Interval;
    const y = right[j] as Interval;
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (end > start) result.push({ start, end });
    if (x.end < y.end) i++;
    else j++;
  }
  return result;
}

/** Diferença `a \ b`: partes de `a` que não estão em `b`. */
export function subtractIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const left = normalizeIntervals(a);
  const right = normalizeIntervals(b);
  const result: Interval[] = [];
  let j = 0;
  for (const x of left) {
    let cursor = x.start;
    while (j < right.length && (right[j] as Interval).end <= cursor) j++;
    let k = j;
    while (k < right.length && (right[k] as Interval).start < x.end) {
      const y = right[k] as Interval;
      if (y.start > cursor) result.push({ start: cursor, end: y.start });
      cursor = Math.max(cursor, y.end);
      if (cursor >= x.end) break;
      k++;
    }
    if (cursor < x.end) result.push({ start: cursor, end: x.end });
  }
  return result;
}

/** Soma das durações (ms). Listas sobrepostas são normalizadas antes. */
export function totalDurationMs(intervals: readonly Interval[]): number {
  let total = 0;
  for (const { start, end } of normalizeIntervals(intervals)) total += end - start;
  return total;
}
