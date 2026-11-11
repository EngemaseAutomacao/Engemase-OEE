import type { Interval, ProductionMinute, StateEvent } from "../src/index.js";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** Instante (ms UTC) a partir de uma data ISO com fuso explícito. */
export function t(iso: string): number {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) throw new Error(`Data de teste inválida: ${iso}`);
  return value;
}

/** Intervalo a partir de duas datas ISO. */
export function iv(start: string, end: string): Interval {
  return { start: t(start), end: t(end) };
}

/** Evento de estado a partir de datas ISO (`end = null` para evento em aberto). */
export function ev(
  state: StateEvent["state"],
  start: string,
  end: string | null,
  reasonCategory?: StateEvent["reasonCategory"],
): StateEvent {
  return { state, start: t(start), end: end === null ? null : t(end), ...(reasonCategory ? { reasonCategory } : {}) };
}

/** Gera minutos `[start, end)` com contagens definidas por `fill`. */
export function minutesBetween(
  start: number,
  end: number,
  fill: (index: number, minuteStart: number) => Omit<ProductionMinute, "start">,
): ProductionMinute[] {
  const result: ProductionMinute[] = [];
  for (let s = start, i = 0; s < end; s += MINUTE, i++) result.push({ start: s, ...fill(i, s) });
  return result;
}

/** Percentual com uma casa decimal, como a interface exibe. */
export function pct(value: number | null): string | null {
  return value === null ? null : (value * 100).toFixed(1);
}
