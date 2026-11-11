import { describe, expect, it } from "vitest";
import { aggregateOee, calculateMachineOee, computeIndicators, EMPTY_TOTALS, sumTotals, type OeeTotals } from "../src/index.js";
import { iv, minutesBetween } from "./helpers.js";

/** Máquina do caso golden: 450 min planejados, 405 de operação, 3.600 peças, 72 refugos, ciclo 6 s (OEE 78,4%). */
const golden: OeeTotals = {
  plannedS: 27000,
  runS: 24300,
  total: 3600,
  reject: 72,
  good: 3528,
  idealTimeS: 21600,
  goodIdealTimeS: 21168,
};

/** Máquina lenta: 480 min planejados, 240 de operação, 400 peças boas, ciclo 30 s (OEE ≈ 41,7%). */
const slow: OeeTotals = {
  plannedS: 28800,
  runS: 14400,
  total: 400,
  reject: 0,
  good: 400,
  idealTimeS: 12000,
  goodIdealTimeS: 12000,
};

describe("agregação de linha/planta", () => {
  it("OEE da linha = Σ(boas × ciclo) ÷ Σ planejado, nunca a média simples", () => {
    const line = aggregateOee([golden, slow]);
    const expected = (21168 + 12000) / (27000 + 28800);
    expect(line.indicators.oee).toBeCloseTo(expected, 12); // 59,4%

    const simpleAverage = ((computeIndicators(golden).oee ?? 0) + (computeIndicators(slow).oee ?? 0)) / 2; // 60,0%
    expect(Math.abs((line.indicators.oee ?? 0) - simpleAverage)).toBeGreaterThan(0.005);
  });

  it("A, P e Q da linha também são somas, e A × P × Q = OEE", () => {
    const { availability, performance, quality, oee } = aggregateOee([golden, slow]).indicators;
    expect(availability).toBeCloseTo((24300 + 14400) / (27000 + 28800), 12);
    expect(performance).toBeCloseTo((21600 + 12000) / (24300 + 14400), 12);
    expect(quality).toBeCloseTo((21168 + 12000) / (21600 + 12000), 12);
    expect(oee).toBeCloseTo((availability ?? 0) * (performance ?? 0) * (quality ?? 0), 12);
  });

  it("máquina sem tempo planejado não distorce a linha", () => {
    const idle: OeeTotals = { ...EMPTY_TOTALS };
    expect(aggregateOee([golden, slow, idle]).indicators).toEqual(aggregateOee([golden, slow]).indicators);
  });

  it("máquina sem ciclo ideal deixa P e OEE da linha indefinidos", () => {
    const unknown: OeeTotals = { ...slow, idealTimeS: null, goodIdealTimeS: null };
    const line = aggregateOee([golden, unknown]);
    expect(line.indicators.oee).toBeNull();
    expect(line.indicators.performance).toBeNull();
    expect(line.indicators.availability).toBeCloseTo((24300 + 14400) / (27000 + 28800), 12);
    expect(line.warnings.map((w) => w.code)).toEqual(["MISSING_IDEAL_CYCLE"]);
  });

  it("lista vazia: tudo null", () => {
    expect(sumTotals([])).toEqual(EMPTY_TOTALS);
    expect(aggregateOee([]).indicators).toEqual({ availability: null, performance: null, quality: null, qualityByCount: null, oee: null });
  });

  it("agrega resultados de máquinas calculadas com ciclos diferentes", () => {
    const window = iv("2026-11-11T09:00:00Z", "2026-11-11T10:00:00Z");
    const machine = (cycle: number, perMinute: number, stoppedMin: number) =>
      calculateMachineOee({
        window,
        schedule: [window],
        stateEvents: [
          { state: "STOPPED", start: window.start, end: window.start + stoppedMin * 60_000 },
          { state: "RUNNING", start: window.start + stoppedMin * 60_000, end: null },
        ],
        minutes: minutesBetween(window.start + stoppedMin * 60_000, window.end, () => ({ total: perMinute, reject: 0, productCode: "X" })),
        idealCycles: { byProduct: { X: cycle } },
      });
    const fast = machine(2, 25, 10); // 50 min × 25 peças × 2 s = 2.500 s ideais
    const heavy = machine(60, 1, 30); // 30 min × 1 peça × 60 s = 1.800 s ideais
    const line = aggregateOee([fast.totals, heavy.totals]);
    expect(line.indicators.oee).toBeCloseTo((2500 + 1800) / 7200, 12);
    expect(line.totals.total).toBe(50 * 25 + 30);
  });

  it("sinaliza performance acima de 100% no agregado", () => {
    const over: OeeTotals = { ...slow, idealTimeS: 16000, goodIdealTimeS: 16000 };
    const line = aggregateOee([over]);
    expect(line.performanceStatus).toEqual({ above100: true, reviewIdealCycle: true, capped: 1 });
    expect(line.warnings.map((w) => w.code)).toEqual(["PERFORMANCE_ABOVE_100"]);
  });
});
