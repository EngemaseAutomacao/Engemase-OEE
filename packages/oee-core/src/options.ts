import { OeeInputError } from "./errors.js";
import { DEFAULT_PERFORMANCE_ALERT_THRESHOLD } from "./indicators.js";
import type { OeeOptions } from "./types.js";

/** Opções padrão (docs/07): setup e NO_COMM como perda; produção em parada planejada volta a contar. */
export const DEFAULT_OEE_OPTIONS: OeeOptions = {
  microStopThresholdS: 0,
  setupPolicy: "availability_loss",
  noCommPolicy: "unplanned",
  productionDuringPlannedStop: "count_as_planned",
  performanceAlertThreshold: DEFAULT_PERFORMANCE_ALERT_THRESHOLD,
};

/** Completa opções parciais com os padrões e valida os valores. */
export function resolveOptions(partial: Partial<OeeOptions> | undefined): OeeOptions {
  const options: OeeOptions = { ...DEFAULT_OEE_OPTIONS, ...partial };
  if (!Number.isFinite(options.microStopThresholdS) || options.microStopThresholdS < 0) {
    throw new OeeInputError("Limite de micro-parada inválido: use um número de segundos maior ou igual a zero.");
  }
  if (!Number.isFinite(options.performanceAlertThreshold) || options.performanceAlertThreshold <= 0) {
    throw new OeeInputError("Limite de alerta de performance inválido.");
  }
  if (options.setupPolicy !== "availability_loss" && options.setupPolicy !== "planned") {
    throw new OeeInputError(`Política de setup desconhecida: "${String(options.setupPolicy)}".`);
  }
  if (options.noCommPolicy !== "unplanned" && options.noCommPolicy !== "planned") {
    throw new OeeInputError(`Política de NO_COMM desconhecida: "${String(options.noCommPolicy)}".`);
  }
  if (options.productionDuringPlannedStop !== "count_as_planned" && options.productionDuringPlannedStop !== "ignore") {
    throw new OeeInputError(`Regra de produção em parada planejada desconhecida: "${String(options.productionDuringPlannedStop)}".`);
  }
  return options;
}
