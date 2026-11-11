import type { OeeIndicators, OeeTotals, OeeWarning, PerformanceStatus } from "./types.js";

/** Tolerância para ruído de ponto flutuante ao comparar com 100%. */
const EPSILON = 1e-9;

/** Limite padrão do alerta "verificar ciclo ideal" (105%). */
export const DEFAULT_PERFORMANCE_ALERT_THRESHOLD = 1.05;

/**
 * Calcula A, P, Q e OEE a partir de totais aditivos.
 *
 * - Sem tempo planejado: A e OEE são `null` ("sem produção planejada"), nunca 0%.
 * - Sem tempo de operação: P é `null`.
 * - Sem contagem: Q é `null`.
 * - Sem ciclo ideal de algum produto produzido: P e OEE são `null`.
 * - OEE = Σ(boas × ciclo) ÷ planejado, que é igual a A × P × Q.
 */
export function computeIndicators(totals: OeeTotals): OeeIndicators {
  const { plannedS, runS, total, good, idealTimeS, goodIdealTimeS } = totals;
  const availability = plannedS > 0 ? runS / plannedS : null;
  const performance = runS > 0 && idealTimeS !== null ? idealTimeS / runS : null;
  const qualityByCount = total > 0 ? Math.max(0, good) / total : null;
  const quality =
    total > 0
      ? idealTimeS !== null && idealTimeS > 0 && goodIdealTimeS !== null
        ? Math.max(0, goodIdealTimeS) / idealTimeS
        : qualityByCount
      : null;
  const oee = plannedS > 0 && goodIdealTimeS !== null ? Math.max(0, goodIdealTimeS) / plannedS : null;
  return { availability, performance, quality, qualityByCount, oee };
}

/**
 * Situação da performance para a interface: guarda o valor real, marca acima de 100%,
 * pede revisão do ciclo ideal acima do limite (padrão 105%) e oferece o valor limitado a 100%.
 */
export function performanceStatus(
  performance: number | null,
  alertThreshold: number = DEFAULT_PERFORMANCE_ALERT_THRESHOLD,
): PerformanceStatus {
  if (performance === null) return { above100: false, reviewIdealCycle: false, capped: null };
  return {
    above100: performance > 1 + EPSILON,
    reviewIdealCycle: performance > alertThreshold + EPSILON,
    capped: Math.min(performance, 1),
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1).replace(".", ",")}%`;
}

function describeProducts(codes: readonly (string | null)[]): string {
  return codes.map((code) => (code === null ? "(sem produto)" : code)).join(", ");
}

/** Avisos derivados dos totais e indicadores (comuns a máquina e agregados). */
export function indicatorWarnings(
  totals: OeeTotals,
  indicators: OeeIndicators,
  missingIdealCycle: readonly (string | null)[],
): OeeWarning[] {
  const warnings: OeeWarning[] = [];
  if (missingIdealCycle.length > 0) {
    warnings.push({
      code: "MISSING_IDEAL_CYCLE",
      message: `Sem ciclo ideal cadastrado para: ${describeProducts(missingIdealCycle)}. Performance e OEE não podem ser calculados.`,
      productCodes: missingIdealCycle,
    });
  }
  if (indicators.performance !== null && indicators.performance > 1 + EPSILON) {
    warnings.push({
      code: "PERFORMANCE_ABOVE_100",
      message: `Performance acima de 100% (${formatPercent(indicators.performance)}). Verifique o ciclo ideal cadastrado.`,
    });
  }
  if (totals.reject > totals.total) {
    warnings.push({
      code: "REJECT_EXCEEDS_TOTAL",
      message: `O refugo (${totals.reject}) é maior que a contagem total (${totals.total}). Confira os lançamentos de qualidade.`,
    });
  }
  if (totals.total > 0 && totals.runS === 0) {
    warnings.push({
      code: "COUNT_WITHOUT_RUN_TIME",
      message: "Há peças contadas sem tempo de operação no período. Confira os sinais de estado da máquina.",
    });
  }
  return warnings;
}
