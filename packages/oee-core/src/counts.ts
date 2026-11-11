import { OeeInputError } from "./errors.js";
import type { IdealCycleTable, Interval, ProductionMinute, QualityAdjustment } from "./types.js";

const MINUTE_MS = 60_000;

/** Contagens e tempo ideal de um produto na janela. */
export interface ProductCount {
  readonly productCode: string | null;
  readonly total: number;
  readonly reject: number;
  readonly good: number;
  /** Ciclo ideal usado (s/peça), ou `null` se não há cadastro nem ciclo padrão. */
  readonly idealCycleS: number | null;
  /** total × ciclo ideal (s). */
  readonly idealTimeS: number | null;
  /** boas × ciclo ideal (s). */
  readonly goodIdealTimeS: number | null;
}

export interface CountSummary {
  readonly total: number;
  readonly reject: number;
  readonly good: number;
  /** Σ tempo ideal (s), ou `null` se algum produto com produção não tem ciclo ideal. */
  readonly idealTimeS: number | null;
  /** Σ boas × ciclo ideal (s), ou `null` se faltar ciclo ideal. */
  readonly goodIdealTimeS: number | null;
  /** Detalhe por produto, ordenado pelo código (`null` primeiro). */
  readonly products: readonly ProductCount[];
  /** Produtos com produção ou refugo mas sem ciclo ideal. */
  readonly missingIdealCycle: readonly (string | null)[];
}

export interface SummarizeCountsInput {
  readonly window: Interval;
  /** Minutos da máquina. Pertencem à janela os minutos cujo início está nela. */
  readonly minutes: readonly ProductionMinute[];
  /** Lançamentos manuais. Pertencem à janela os que têm `at` dentro dela. */
  readonly qualityAdjustments?: readonly QualityAdjustment[];
  readonly idealCycles: IdealCycleTable;
}

function isValidCycle(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Ciclo ideal (s/peça) de um produto: cadastro do produto na máquina, senão o ciclo padrão da máquina. */
export function idealCycleFor(table: IdealCycleTable, productCode: string | null): number | null {
  if (productCode !== null && Object.hasOwn(table.byProduct, productCode)) {
    const cycle = table.byProduct[productCode];
    if (isValidCycle(cycle)) return cycle;
  }
  return isValidCycle(table.defaultS) ? table.defaultS : null;
}

function assertCount(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new OeeInputError(`${label}: contagem inválida (${String(value)}).`);
}

function inWindow(instant: number, window: Interval): boolean {
  return instant >= window.start && instant < window.end;
}

/**
 * Soma as contagens da janela (minutos + ajustes manuais de qualidade) e calcula o tempo ideal
 * por produto. O ajuste sem produto herda o produto do minuto (alinhado ao minuto UTC) que contém `at`.
 */
export function summarizeCounts(input: SummarizeCountsInput): CountSummary {
  const { window, minutes, idealCycles } = input;
  // `active`: o produto teve alguma contagem ou lançamento não nulo (mesmo que a soma dê zero).
  const byProduct = new Map<string | null, { total: number; reject: number; active: boolean }>();
  const bucket = (code: string | null): { total: number; reject: number; active: boolean } => {
    let entry = byProduct.get(code);
    if (entry === undefined) {
      entry = { total: 0, reject: 0, active: false };
      byProduct.set(code, entry);
    }
    return entry;
  };

  const productByMinute = new Map<number, string | null>();
  for (const minute of minutes) {
    const label = `Minuto ${Number.isFinite(minute.start) ? new Date(minute.start).toISOString() : String(minute.start)}`;
    if (!Number.isFinite(minute.start)) throw new OeeInputError(`${label}: início inválido.`);
    assertCount(minute.total, label);
    assertCount(minute.reject, label);
    productByMinute.set(Math.floor(minute.start / MINUTE_MS) * MINUTE_MS, minute.productCode);
    if (!inWindow(minute.start, window)) continue;
    const entry = bucket(minute.productCode);
    entry.total += minute.total;
    entry.reject += minute.reject;
    if (minute.total !== 0 || minute.reject !== 0) entry.active = true;
  }

  for (const adjustment of input.qualityAdjustments ?? []) {
    if (!Number.isFinite(adjustment.at) || !Number.isFinite(adjustment.quantity)) {
      throw new OeeInputError("Lançamento de qualidade inválido.");
    }
    if (!inWindow(adjustment.at, window)) continue;
    const code =
      adjustment.productCode !== undefined && adjustment.productCode !== null
        ? adjustment.productCode
        : (productByMinute.get(Math.floor(adjustment.at / MINUTE_MS) * MINUTE_MS) ?? null);
    const entry = bucket(code);
    entry.reject += adjustment.quantity;
    if (adjustment.quantity !== 0) entry.active = true;
  }

  const entries = [...byProduct.entries()].sort(([a], [b]) =>
    a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1,
  );
  const products: ProductCount[] = entries.map(([productCode, { total, reject }]) => {
    const idealCycleS = idealCycleFor(idealCycles, productCode);
    const good = total - reject;
    return {
      productCode,
      total,
      reject,
      good,
      idealCycleS,
      idealTimeS: idealCycleS === null ? null : total * idealCycleS,
      goodIdealTimeS: idealCycleS === null ? null : good * idealCycleS,
    };
  });

  const missingIdealCycle = entries
    .filter(([productCode, { active }]) => active && idealCycleFor(idealCycles, productCode) === null)
    .map(([productCode]) => productCode);

  let total = 0;
  let reject = 0;
  let idealTimeS = 0;
  let goodIdealTimeS = 0;
  for (const p of products) {
    total += p.total;
    reject += p.reject;
    idealTimeS += p.idealTimeS ?? 0;
    goodIdealTimeS += p.goodIdealTimeS ?? 0;
  }
  const complete = missingIdealCycle.length === 0;

  return {
    total,
    reject,
    good: total - reject,
    idealTimeS: complete ? idealTimeS : null,
    goodIdealTimeS: complete ? goodIdealTimeS : null,
    products,
    missingIdealCycle,
  };
}
