import { computeIndicators, indicatorWarnings, performanceStatus } from "./indicators.js";
import type { OeeSummary } from "./aggregate.js";
import { summarizeCounts, type ProductCount } from "./counts.js";
import { OeeInputError } from "./errors.js";
import { intersectIntervals, subtractIntervals, totalDurationMs, unionIntervals } from "./intervals.js";
import { resolveOptions } from "./options.js";
import { resolveStateTimeline, type SegmentCategory, type StateSegment } from "./states.js";
import type {
  IdealCycleTable,
  Interval,
  OeeOptions,
  OeeTotals,
  OeeWarning,
  ProductionMinute,
  QualityAdjustment,
  ScheduledWindow,
  StateEvent,
} from "./types.js";

export interface MachineOeeInput {
  /** Janela de cálculo `[t0, t1)`. Para o turno corrente, use `t1 = agora` (passado pelo chamador). */
  readonly window: Interval;
  /** Janelas de produção programada (turnos), com as pausas planejadas de cada uma. */
  readonly schedule: readonly ScheduledWindow[];
  /** Paradas planejadas do calendário (manutenção programada, sem programação…), já em UTC. */
  readonly plannedDowntimes?: readonly Interval[];
  /**
   * Eventos de estado que tocam a janela (com folga de pelo menos o limite de micro-parada
   * antes e depois, para conhecer a duração completa das paradas).
   */
  readonly stateEvents: readonly StateEvent[];
  /** Agregados por minuto. Contam os minutos cujo início está na janela. */
  readonly minutes: readonly ProductionMinute[];
  /** Lançamentos manuais de qualidade. Contam os que têm `at` dentro da janela. */
  readonly qualityAdjustments?: readonly QualityAdjustment[];
  /** Ciclo ideal por produto e ciclo padrão da máquina. */
  readonly idealCycles: IdealCycleTable;
  readonly options?: Partial<OeeOptions>;
}

/** Decomposição dos tempos da janela, em segundos. */
export interface TimeBreakdown {
  /** Duração da janela. */
  readonly windowS: number;
  /** Tempo programado pelo calendário: turnos − pausas − paradas planejadas do calendário. */
  readonly scheduledS: number;
  /** Tempo programado retirado por paradas com motivo planejado (ou setup/NO_COMM por política). */
  readonly plannedStopS: number;
  /** Tempo não programado em que a máquina rodou e que voltou a contar como planejado. */
  readonly recoveredS: number;
  /** Tempo planejado = programado − paradas planejadas + recuperado. */
  readonly plannedS: number;
  /** Tempo de operação (inclui micro-paradas). */
  readonly runS: number;
  /** Parte do tempo de operação que é micro-parada. */
  readonly microStopS: number;
  /** Paradas dentro do tempo planejado = planejado − operação. */
  readonly downtimeS: number;
  /** Paradas não planejadas (STOPPED/FAULT ou motivo não planejado). */
  readonly unplannedStopS: number;
  /** Setup contado como perda de disponibilidade. */
  readonly setupS: number;
  /** Sem comunicação contado como perda. */
  readonly noCommS: number;
  /** Sem nenhum evento de estado, contado como perda (mesma política de NO_COMM). */
  readonly noDataS: number;
}

export interface MachineOeeResult extends OeeSummary {
  readonly window: Interval;
  readonly times: TimeBreakdown;
  readonly products: readonly ProductCount[];
  /** Há NO_COMM ou falta de eventos dentro do tempo planejado (selo "dados incompletos"). */
  readonly incompleteData: boolean;
  /** Linha do tempo classificada e recortada na janela (útil para gráficos e conferência). */
  readonly timeline: readonly StateSegment[];
}

const toSeconds = (ms: number): number => ms / 1000;

/**
 * Calcula tempos, contagens, A, P, Q e OEE de uma máquina numa janela `[t0, t1)` (docs/07, "Algoritmo").
 *
 * Função pura: não lê relógio nem banco. Os totais são aditivos — calcular janelas adjacentes e
 * somar com `aggregateOee` dá o mesmo resultado que calcular a janela inteira.
 */
export function calculateMachineOee(input: MachineOeeInput): MachineOeeResult {
  const options = resolveOptions(input.options);
  const { window } = input;
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.end < window.start) {
    throw new OeeInputError("Janela de cálculo inválida: o fim deve ser maior ou igual ao início.");
  }
  const windowList: Interval[] = [window];

  // 1–2. Tempo programado: turnos ∩ janela, menos pausas e paradas planejadas do calendário.
  const shifts = intersectIntervals(unionIntervals(input.schedule), windowList);
  const calendarStops = unionIntervals(
    input.schedule.flatMap((w) => w.breaks ?? []),
    input.plannedDowntimes ?? [],
  );
  const scheduled = subtractIntervals(shifts, calendarStops);

  // Linha do tempo de estados, classificada (motivos, setup, NO_COMM, micro-paradas).
  const timeline = resolveStateTimeline(input.stateEvents, window, options);
  const byEffect = (effect: StateSegment["effect"]): Interval[] => timeline.filter((s) => s.effect === effect);
  const operating = byEffect("operating");
  const plannedStops = byEffect("planned_stop");

  // Regra "produção durante parada planejada": operação fora do programado volta a contar.
  const notScheduled = subtractIntervals(windowList, scheduled);
  const recovered =
    options.productionDuringPlannedStop === "count_as_planned" ? intersectIntervals(operating, notScheduled) : [];
  const planned = unionIntervals(subtractIntervals(scheduled, plannedStops), recovered);

  // 3. Tempo de operação: RUNNING + micro-paradas dentro do planejado.
  const run = intersectIntervals(operating, planned);
  const plannedMsOf = (predicate: (segment: StateSegment) => boolean): number =>
    totalDurationMs(intersectIntervals(timeline.filter(predicate), planned));
  const lossOf = (category: SegmentCategory): number =>
    plannedMsOf((s) => s.category === category && s.effect === "loss");

  const plannedMs = totalDurationMs(planned);
  const runMs = totalDurationMs(run);
  const times: TimeBreakdown = {
    windowS: toSeconds(window.end - window.start),
    scheduledS: toSeconds(totalDurationMs(scheduled)),
    plannedStopS: toSeconds(totalDurationMs(intersectIntervals(plannedStops, scheduled))),
    recoveredS: toSeconds(totalDurationMs(recovered)),
    plannedS: toSeconds(plannedMs),
    runS: toSeconds(runMs),
    microStopS: toSeconds(plannedMsOf((s) => s.category === "micro_stop")),
    downtimeS: toSeconds(plannedMs - runMs),
    unplannedStopS: toSeconds(lossOf("unplanned_stop")),
    setupS: toSeconds(lossOf("setup")),
    noCommS: toSeconds(lossOf("no_comm")),
    noDataS: toSeconds(lossOf("no_data")),
  };

  // 4–5. Contagens e tempo ideal por produto.
  const counts = summarizeCounts({
    window,
    minutes: input.minutes,
    qualityAdjustments: input.qualityAdjustments ?? [],
    idealCycles: input.idealCycles,
  });

  // 6–7. Indicadores.
  const totals: OeeTotals = {
    plannedS: times.plannedS,
    runS: times.runS,
    total: counts.total,
    reject: counts.reject,
    good: counts.good,
    idealTimeS: counts.idealTimeS,
    goodIdealTimeS: counts.goodIdealTimeS,
  };
  const indicators = computeIndicators(totals);
  const warnings: OeeWarning[] = indicatorWarnings(totals, indicators, counts.missingIdealCycle);

  const incompleteMs = plannedMsOf((s) => s.state === null || s.state === "NO_COMM");
  const incompleteData = incompleteMs > 0;
  if (incompleteData) {
    const minutes = (incompleteMs / 60_000).toFixed(1).replace(".", ",");
    warnings.push({
      code: "INCOMPLETE_STATE_DATA",
      message: `Há ${minutes} min sem comunicação ou sem dados dentro do tempo planejado: dados incompletos.`,
    });
  }

  return {
    window: { start: window.start, end: window.end },
    times,
    totals,
    indicators,
    performanceStatus: performanceStatus(indicators.performance, options.performanceAlertThreshold),
    products: counts.products,
    incompleteData,
    warnings,
    timeline,
  };
}
