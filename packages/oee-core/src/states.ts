import { OeeInputError } from "./errors.js";
import { clipInterval, subtractIntervals } from "./intervals.js";
import { resolveOptions } from "./options.js";
import type { Interval, MachineState, OeeOptions, ReasonCategory, StateEvent } from "./types.js";

/** O que um trecho da linha do tempo representa. */
export type SegmentCategory =
  /** Máquina rodando. */
  | "run"
  /** Parada curta (< limite de micro-parada): conta como operação e reduz a performance. */
  | "micro_stop"
  /** Parada não planejada (STOPPED/FAULT ou motivo de categoria não planejada). */
  | "unplanned_stop"
  /** Setup / troca (estado SETUP ou motivo de categoria setup). */
  | "setup"
  /** Parada com motivo de categoria planejada. */
  | "planned_stop"
  /** Sem comunicação com o CLP. */
  | "no_comm"
  /** Nenhum evento de estado cobre o trecho. */
  | "no_data";

/** Como o trecho entra no cálculo. */
export type SegmentEffect =
  /** Tempo de operação. */
  | "operating"
  /** Excluído do tempo planejado. */
  | "planned_stop"
  /** Perda de disponibilidade (fica no tempo planejado, fora da operação). */
  | "loss";

/** Trecho da linha do tempo de estados, já classificado e recortado na janela. */
export interface StateSegment extends Interval {
  /** Estado bruto, ou `null` quando não há evento (sem dados). */
  readonly state: MachineState | null;
  readonly category: SegmentCategory;
  readonly effect: SegmentEffect;
}

export type TimelineOptions = Pick<OeeOptions, "microStopThresholdS" | "setupPolicy" | "noCommPolicy">;

const STATES: ReadonlySet<string> = new Set<MachineState>(["RUNNING", "STOPPED", "FAULT", "SETUP", "NO_COMM"]);
const REASON_CATEGORIES: ReadonlySet<string> = new Set<ReasonCategory>(["unplanned", "planned", "setup"]);

interface ResolvedEvent extends Interval {
  readonly state: MachineState;
  readonly category: SegmentCategory;
}

function baseCategory(event: StateEvent): SegmentCategory {
  if (event.state === "RUNNING") return "run";
  switch (event.reasonCategory ?? null) {
    case "planned":
      return "planned_stop";
    case "setup":
      return "setup";
    case "unplanned":
      return "unplanned_stop";
    case null:
      break;
  }
  switch (event.state) {
    case "STOPPED":
    case "FAULT":
      return "unplanned_stop";
    case "SETUP":
      return "setup";
    case "NO_COMM":
      return "no_comm";
  }
}

function effectOf(category: SegmentCategory, options: TimelineOptions): SegmentEffect {
  switch (category) {
    case "run":
    case "micro_stop":
      return "operating";
    case "planned_stop":
      return "planned_stop";
    case "unplanned_stop":
      return "loss";
    case "setup":
      return options.setupPolicy === "planned" ? "planned_stop" : "loss";
    case "no_comm":
    case "no_data":
      return options.noCommPolicy === "planned" ? "planned_stop" : "loss";
  }
}

function validateEvent(event: StateEvent, index: number): void {
  if (!Number.isFinite(event.start)) throw new OeeInputError(`Evento de estado #${index}: início inválido.`);
  if (event.end !== null && (Number.isNaN(event.end) || event.end < event.start)) {
    throw new OeeInputError(`Evento de estado #${index}: fim antes do início.`);
  }
  if (!STATES.has(event.state)) throw new OeeInputError(`Evento de estado #${index}: estado desconhecido "${String(event.state)}".`);
  const reason = event.reasonCategory ?? null;
  if (reason !== null && !REASON_CATEGORIES.has(reason)) {
    throw new OeeInputError(`Evento de estado #${index}: categoria de motivo desconhecida "${String(reason)}".`);
  }
}

/**
 * Normaliza os eventos: ordena por início, corta cada evento no início do seguinte
 * (o mais recente prevalece) e estende eventos em aberto até o próximo evento (ou ao infinito).
 */
function normalizeEvents(events: readonly StateEvent[]): ResolvedEvent[] {
  events.forEach(validateEvent);
  const sorted = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.start - b.event.start || a.index - b.index)
    .map(({ event }) => event);

  const resolved: ResolvedEvent[] = [];
  sorted.forEach((event, i) => {
    const next = sorted[i + 1];
    const end = Math.min(event.end ?? Infinity, next?.start ?? Infinity);
    if (end > event.start) resolved.push({ start: event.start, end, state: event.state, category: baseCategory(event) });
  });
  return resolved;
}

/**
 * Marca micro-paradas. Um episódio de parada é uma sequência contígua de eventos STOPPED/FAULT
 * não planejados; se a duração **total do episódio** (não recortada pela janela) for menor que o
 * limite, todos os seus trechos viram `micro_stop`. Episódios em aberto nunca são micro-paradas.
 */
function markMicroStops(events: ResolvedEvent[], thresholdS: number): ResolvedEvent[] {
  if (!(thresholdS > 0)) return events;
  const thresholdMs = thresholdS * 1000;
  const isStop = (e: ResolvedEvent): boolean =>
    e.category === "unplanned_stop" && (e.state === "STOPPED" || e.state === "FAULT");

  const result = [...events];
  let i = 0;
  while (i < result.length) {
    const first = result[i] as ResolvedEvent;
    if (!isStop(first)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < result.length) {
      const current = result[j] as ResolvedEvent;
      const next = result[j + 1] as ResolvedEvent;
      if (!isStop(next) || next.start !== current.end) break;
      j++;
    }
    const last = result[j] as ResolvedEvent;
    const duration = last.end - first.start;
    if (Number.isFinite(duration) && duration < thresholdMs) {
      for (let k = i; k <= j; k++) result[k] = { ...(result[k] as ResolvedEvent), category: "micro_stop" };
    }
    i = j + 1;
  }
  return result;
}

/**
 * Linha do tempo de estados recortada na janela, cobrindo a janela inteira
 * (trechos sem evento viram `no_data`).
 *
 * Passe todos os eventos que tocam a janela, com folga de pelo menos o limite de micro-parada
 * antes e depois, para que a duração dos episódios de parada seja conhecida por inteiro.
 */
export function resolveStateTimeline(
  events: readonly StateEvent[],
  window: Interval,
  partialOptions?: Partial<TimelineOptions>,
): StateSegment[] {
  const options = resolveOptions(partialOptions);
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.end < window.start) {
    throw new OeeInputError("Janela de cálculo inválida.");
  }
  const resolved = markMicroStops(normalizeEvents(events), options.microStopThresholdS);

  const segments: StateSegment[] = [];
  for (const event of resolved) {
    const clipped = clipInterval(event, window);
    if (clipped === null) continue;
    segments.push({
      start: clipped.start,
      end: clipped.end,
      state: event.state,
      category: event.category,
      effect: effectOf(event.category, options),
    });
  }
  for (const gap of subtractIntervals([window], segments)) {
    segments.push({ start: gap.start, end: gap.end, state: null, category: "no_data", effect: effectOf("no_data", options) });
  }
  return segments.sort((a, b) => a.start - b.start);
}
