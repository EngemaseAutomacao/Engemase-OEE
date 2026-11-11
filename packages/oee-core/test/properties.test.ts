import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  aggregateOee,
  calculateMachineOee,
  generateShiftWindows,
  addDays,
  type Interval,
  type IsoWeekday,
  type MachineOeeInput,
  type MachineOeeResult,
  type OeeIndicators,
  type ProductionMinute,
  type QualityAdjustment,
  type ReasonCategory,
  type ShiftDefinition,
  type StateEvent,
  type TimeBreakdown,
} from "../src/index.js";

const NUM_RUNS = 300;
const BASE = Date.UTC(2026, 10, 11, 6, 0, 0);
const SPAN_S = 6 * 3600;
const at = (seconds: number): number => BASE + seconds * 1000;

const intervalArb = fc
  .tuple(fc.integer({ min: -600, max: SPAN_S + 600 }), fc.integer({ min: -600, max: SPAN_S + 600 }))
  .map(([a, b]): Interval => ({ start: at(Math.min(a, b)), end: at(Math.max(a, b)) }));

const scheduleArb = fc.array(
  fc.record({ window: intervalArb, breaks: fc.array(intervalArb, { maxLength: 2 }) }).map(({ window, breaks }) => ({ ...window, breaks })),
  { maxLength: 3 },
);

const stateEventsArb = fc
  .record({
    firstS: fc.integer({ min: -1800, max: 3600 }),
    lastOpen: fc.boolean(),
    segments: fc.array(
      fc.record({
        durationS: fc.oneof(fc.integer({ min: 1, max: 150 }), fc.integer({ min: 1, max: 3600 })),
        gapS: fc.oneof({ weight: 4, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.integer({ min: 1, max: 900 }) }),
        state: fc.constantFrom<StateEvent["state"]>("RUNNING", "RUNNING", "STOPPED", "FAULT", "SETUP", "NO_COMM"),
        reasonCategory: fc.constantFrom<ReasonCategory | null>(null, null, "unplanned", "planned", "setup"),
      }),
      { maxLength: 40 },
    ),
  })
  .map(({ firstS, lastOpen, segments }): StateEvent[] => {
    let cursor = firstS;
    return segments.map((segment, index) => {
      cursor += segment.gapS;
      const start = at(cursor);
      cursor += segment.durationS;
      const open = lastOpen && index === segments.length - 1;
      return { state: segment.state, start, end: open ? null : at(cursor), reasonCategory: segment.reasonCategory };
    });
  });

const minutesArb = fc
  .uniqueArray(
    fc.record({
      index: fc.integer({ min: -15, max: SPAN_S / 60 + 15 }),
      total: fc.integer({ min: 0, max: 30 }),
      reject: fc.integer({ min: 0, max: 30 }),
      productCode: fc.constantFrom<string | null>("A", "B", null),
    }),
    { selector: (m) => m.index, maxLength: 120 },
  )
  .map((list): ProductionMinute[] =>
    list.map(({ index, total, reject, productCode }) => ({
      start: BASE + index * 60_000,
      total,
      reject: Math.min(reject, total),
      productCode,
    })),
  );

const adjustmentsArb = fc.array(
  fc
    .record({
      atS: fc.integer({ min: -600, max: SPAN_S + 600 }),
      quantity: fc.integer({ min: -3, max: 5 }),
      product: fc.constantFrom<string | null | undefined>(undefined, null, "A", "B"),
    })
    .map(({ atS, quantity, product }): QualityAdjustment =>
      product === undefined ? { at: at(atS), quantity } : { at: at(atS), quantity, productCode: product },
    ),
  { maxLength: 4 },
);

const optionsArb = fc.record({
  microStopThresholdS: fc.constantFrom(0, 30, 60, 120),
  setupPolicy: fc.constantFrom("availability_loss" as const, "planned" as const),
  noCommPolicy: fc.constantFrom("unplanned" as const, "planned" as const),
  productionDuringPlannedStop: fc.constantFrom("count_as_planned" as const, "ignore" as const),
});

/** Três pontos a ≤ b ≤ c (b com fração de segundo, para janelas desalinhadas do minuto). */
const splitArb = fc
  .tuple(
    fc.integer({ min: -900, max: SPAN_S + 900 }),
    fc.integer({ min: -900, max: SPAN_S + 900 }),
    fc.integer({ min: -900, max: SPAN_S + 900 }),
    fc.integer({ min: 0, max: 999 }),
  )
  .map(([x, y, z, ms]) => {
    const [a, b, c] = [x, y, z].sort((p, q) => p - q) as [number, number, number];
    const mid = Math.min(at(b) + (b < c ? ms : 0), at(c));
    return { a: at(a), b: mid, c: at(c) };
  });

const scenarioArb = fc.record({
  schedule: scheduleArb,
  plannedDowntimes: fc.array(intervalArb, { maxLength: 2 }),
  stateEvents: stateEventsArb,
  minutes: minutesArb,
  qualityAdjustments: adjustmentsArb,
  options: optionsArb,
  defaultCycle: fc.constantFrom<number | null>(3, null),
  split: splitArb,
});

type Scenario = typeof scenarioArb extends fc.Arbitrary<infer T> ? T : never;

function run(scenario: Scenario, window: Interval): MachineOeeResult {
  const input: MachineOeeInput = {
    window,
    schedule: scenario.schedule,
    plannedDowntimes: scenario.plannedDowntimes,
    stateEvents: scenario.stateEvents,
    minutes: scenario.minutes,
    qualityAdjustments: scenario.qualityAdjustments,
    idealCycles: { byProduct: { A: 6, B: 12.5 }, defaultS: scenario.defaultCycle },
    options: scenario.options,
  };
  return calculateMachineOee(input);
}

const TIME_KEYS: readonly (keyof TimeBreakdown)[] = [
  "windowS",
  "scheduledS",
  "plannedStopS",
  "recoveredS",
  "plannedS",
  "runS",
  "microStopS",
  "downtimeS",
  "unplannedStopS",
  "setupS",
  "noCommS",
  "noDataS",
];
const INDICATOR_KEYS: readonly (keyof OeeIndicators)[] = ["availability", "performance", "quality", "qualityByCount", "oee"];

function expectClose(actual: number | null, expected: number | null, label: string): void {
  if (expected === null || actual === null) {
    expect(actual, label).toBe(expected);
  } else {
    expect(Math.abs(actual - expected), `${label}: ${actual} ≠ ${expected}`).toBeLessThan(1e-6);
  }
}

describe("propriedades", () => {
  it("somar janelas adjacentes dá o mesmo resultado que a janela inteira (tempos, contagens e indicadores)", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { a, b, c } = scenario.split;
        const left = run(scenario, { start: a, end: b });
        const right = run(scenario, { start: b, end: c });
        const whole = run(scenario, { start: a, end: c });

        for (const key of TIME_KEYS) expectClose(left.times[key] + right.times[key], whole.times[key], `tempo ${key}`);
        expect(left.totals.total + right.totals.total).toBe(whole.totals.total);
        expect(left.totals.reject + right.totals.reject).toBe(whole.totals.reject);
        expect(left.totals.good + right.totals.good).toBe(whole.totals.good);

        const combined = aggregateOee([left.totals, right.totals]);
        expectClose(combined.totals.idealTimeS, whole.totals.idealTimeS, "idealTimeS");
        expectClose(combined.totals.goodIdealTimeS, whole.totals.goodIdealTimeS, "goodIdealTimeS");
        for (const key of INDICATOR_KEYS) expectClose(combined.indicators[key], whole.indicators[key], `indicador ${key}`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("os tempos fecham: planejado = operação + perdas = programado − paradas planejadas + recuperado", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { times } = run(scenario, { start: scenario.split.a, end: scenario.split.c });
        expectClose(times.plannedS, times.runS + times.unplannedStopS + times.setupS + times.noCommS + times.noDataS, "perdas");
        expectClose(times.downtimeS, times.plannedS - times.runS, "paradas");
        expectClose(times.plannedS, times.scheduledS - times.plannedStopS + times.recoveredS, "planejado");
        expect(times.runS).toBeLessThanOrEqual(times.plannedS);
        expect(times.microStopS).toBeLessThanOrEqual(times.runS);
        expect(times.plannedS).toBeLessThanOrEqual(times.windowS);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("OEE = A × P × Q e, quando cada um ≤ 1, OEE ≤ min(A, P, Q)", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { availability: a, performance: p, quality: q, oee } = run(scenario, {
          start: scenario.split.a,
          end: scenario.split.c,
        }).indicators;
        if (a === null || p === null || q === null) return;
        expectClose(oee, a * p * q, "A × P × Q");
        if (a <= 1 && p <= 1 && q <= 1) expect(oee ?? 0).toBeLessThanOrEqual(Math.min(a, p, q) + 1e-12);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("gerar turnos num período = gerar em dois subperíodos consecutivos", () => {
    const hhmm = (minute: number): string =>
      `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const shiftArb = fc
      .record({
        id: fc.constantFrom("t1", "t2", "t3"),
        startMinute: fc.integer({ min: 0, max: 1439 }),
        durationMinutes: fc.integer({ min: 1, max: 1440 }),
        days: fc.subarray<IsoWeekday>([1, 2, 3, 4, 5, 6, 7], { minLength: 1 }),
        breakOffsets: fc.option(fc.tuple(fc.nat(), fc.nat()), { nil: undefined }),
      })
      .map(({ id, startMinute, durationMinutes, days, breakOffsets }): ShiftDefinition => {
        const end = (startMinute + durationMinutes) % 1440;
        const base: ShiftDefinition = { id, start: hhmm(startMinute), end: hhmm(end), daysOfWeek: days };
        if (breakOffsets === undefined) return base;
        const [x, y] = [breakOffsets[0] % (durationMinutes + 1), breakOffsets[1] % (durationMinutes + 1)].sort((m, n) => m - n) as [number, number];
        if (x === y) return base;
        return { ...base, breaks: [{ start: hhmm((startMinute + x) % 1440), end: hhmm((startMinute + y) % 1440) }] };
      });

    fc.assert(
      fc.property(
        fc.array(shiftArb, { minLength: 1, maxLength: 3 }),
        fc.constantFrom("America/Sao_Paulo", "America/New_York", "Europe/Lisbon", "Australia/Lord_Howe", "Asia/Kolkata", "UTC"),
        fc.integer({ min: 0, max: 360 }),
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 15 }),
        (shifts, timeZone, offsetDays, firstLength, secondLength) => {
          const from = addDays("2026-01-01", offsetDays);
          const mid = addDays(from, firstLength);
          const to = addDays(mid, secondLength + 1);
          const whole = generateShiftWindows({ shifts, timeZone, from, to });
          const parts = [
            ...generateShiftWindows({ shifts, timeZone, from, to: mid }),
            ...generateShiftWindows({ shifts, timeZone, from: addDays(mid, 1), to }),
          ].sort((m, n) => m.start - n.start || (m.shiftId < n.shiftId ? -1 : m.shiftId > n.shiftId ? 1 : 0));
          expect(parts).toEqual(whole);
          for (const w of whole) {
            expect(w.end).toBeGreaterThan(w.start);
            for (const br of w.breaks) {
              expect(br.start).toBeGreaterThanOrEqual(w.start);
              expect(br.end).toBeLessThanOrEqual(w.end);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
