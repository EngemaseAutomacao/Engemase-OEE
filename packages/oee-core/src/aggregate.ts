import { computeIndicators, indicatorWarnings, performanceStatus, DEFAULT_PERFORMANCE_ALERT_THRESHOLD } from "./indicators.js";
import type { OeeIndicators, OeeTotals, OeeWarning, PerformanceStatus } from "./types.js";

/** Resultado consolidado: totais aditivos, indicadores e avisos. */
export interface OeeSummary {
  readonly totals: OeeTotals;
  readonly indicators: OeeIndicators;
  readonly performanceStatus: PerformanceStatus;
  readonly warnings: readonly OeeWarning[];
}

/** Totais "vazios" (elemento neutro da soma). */
export const EMPTY_TOTALS: OeeTotals = {
  plannedS: 0,
  runS: 0,
  total: 0,
  reject: 0,
  good: 0,
  idealTimeS: 0,
  goodIdealTimeS: 0,
};

/**
 * Soma totais de máquinas ou de janelas adjacentes.
 * Se algum item não tem tempo ideal (falta ciclo ideal), a soma também não tem.
 */
export function sumTotals(items: readonly OeeTotals[]): OeeTotals {
  let plannedS = 0;
  let runS = 0;
  let total = 0;
  let reject = 0;
  let good = 0;
  let idealTimeS: number | null = 0;
  let goodIdealTimeS: number | null = 0;
  for (const item of items) {
    plannedS += item.plannedS;
    runS += item.runS;
    total += item.total;
    reject += item.reject;
    good += item.good;
    idealTimeS = idealTimeS === null || item.idealTimeS === null ? null : idealTimeS + item.idealTimeS;
    goodIdealTimeS = goodIdealTimeS === null || item.goodIdealTimeS === null ? null : goodIdealTimeS + item.goodIdealTimeS;
  }
  return { plannedS, runS, total, reject, good, idealTimeS, goodIdealTimeS };
}

/**
 * OEE agregado (linha, planta, ou várias janelas de uma máquina):
 * **OEE = Σ(boas × ciclo ideal) ÷ Σ tempo planejado** — nunca a média simples dos OEEs.
 * A, P e Q seguem a mesma lógica (Σ operação ÷ Σ planejado, Σ ideal ÷ Σ operação, …),
 * de modo que A × P × Q = OEE também no agregado.
 */
export function aggregateOee(
  items: readonly OeeTotals[],
  alertThreshold: number = DEFAULT_PERFORMANCE_ALERT_THRESHOLD,
): OeeSummary {
  const totals = sumTotals(items);
  const indicators = computeIndicators(totals);
  const warnings = indicatorWarnings(totals, indicators, []);
  if (totals.idealTimeS === null) {
    warnings.unshift({
      code: "MISSING_IDEAL_CYCLE",
      message: "Há produção sem ciclo ideal cadastrado em pelo menos um item. Performance e OEE não podem ser calculados.",
    });
  }
  return { totals, indicators, performanceStatus: performanceStatus(indicators.performance, alertThreshold), warnings };
}
