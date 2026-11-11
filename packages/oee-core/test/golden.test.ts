import { describe, expect, it } from "vitest";
import {
  calculateMachineOee,
  generateShiftWindows,
  intersectIntervals,
  subtractIntervals,
  type ProductionMinute,
  type ShiftDefinition,
} from "../src/index.js";
import { ev, MINUTE, pct, t } from "./helpers.js";

/**
 * Caso golden do docs/07 ("Exemplo"):
 * turno de 8 h (480 min) com 30 min de refeição → 450 min planejados;
 * 45 min de paradas não planejadas → 405 min de operação;
 * ciclo ideal 6 s; 3.600 peças, 72 refugadas (3.528 boas).
 * Esperado: A 90,0% · P 88,9% · Q 98,0% · OEE 78,4%.
 */
describe("caso golden do docs/07", () => {
  const timeZone = "America/Sao_Paulo";
  const firstShift: ShiftDefinition = {
    id: "turno-1",
    name: "1º turno",
    start: "06:00",
    end: "14:00",
    daysOfWeek: [1, 2, 3, 4, 5],
    breaks: [{ name: "Refeição", start: "10:00", end: "10:30" }],
  };
  const [shift] = generateShiftWindows({ shifts: [firstShift], timeZone, from: "2026-11-11", to: "2026-11-11" });
  if (shift === undefined) throw new Error("turno não gerado");

  // Linha do tempo (UTC; São Paulo = −03:00): 45 min de paradas não planejadas no total.
  const stateEvents = [
    ev("RUNNING", "2026-11-11T09:00:00Z", "2026-11-11T11:00:00Z"),
    ev("FAULT", "2026-11-11T11:00:00Z", "2026-11-11T11:30:00Z"), // 30 min
    ev("RUNNING", "2026-11-11T11:30:00Z", "2026-11-11T13:00:00Z"),
    ev("STOPPED", "2026-11-11T13:00:00Z", "2026-11-11T13:30:00Z"), // refeição (fora do planejado)
    ev("RUNNING", "2026-11-11T13:30:00Z", "2026-11-11T15:00:00Z"),
    ev("STOPPED", "2026-11-11T15:00:00Z", "2026-11-11T15:15:00Z"), // 15 min
    ev("RUNNING", "2026-11-11T15:15:00Z", null),
  ];

  // 3.600 peças distribuídas nos 405 minutos rodando: 360 × 9 + 45 × 8; 1 refugo nos 72 primeiros.
  const running = intersectIntervals(
    stateEvents.filter((e) => e.state === "RUNNING").map((e) => ({ start: e.start, end: e.end ?? shift.end })),
    subtractIntervals([shift], shift.breaks),
  );
  const minutes: ProductionMinute[] = [];
  for (const { start, end } of running) {
    for (let s = start; s < end; s += MINUTE) {
      const i = minutes.length;
      minutes.push({ start: s, total: i < 360 ? 9 : 8, reject: i < 72 ? 1 : 0, productCode: "PRD-001" });
    }
  }

  const result = calculateMachineOee({
    window: { start: shift.start, end: shift.end },
    schedule: [shift],
    stateEvents,
    minutes,
    idealCycles: { byProduct: { "PRD-001": 6 } },
    options: { microStopThresholdS: 60 },
  });

  it("gera o turno no fuso da planta", () => {
    expect(shift.shiftDate).toBe("2026-11-11");
    expect(shift.start).toBe(t("2026-11-11T09:00:00Z"));
    expect(shift.end).toBe(t("2026-11-11T17:00:00Z"));
    expect(shift.breaks).toEqual([{ start: t("2026-11-11T13:00:00Z"), end: t("2026-11-11T13:30:00Z") }]);
    expect(minutes).toHaveLength(405);
  });

  it("calcula os tempos: 450 min planejados e 405 min de operação", () => {
    expect(result.times.windowS).toBe(480 * 60);
    expect(result.times.scheduledS).toBe(450 * 60);
    expect(result.times.plannedS).toBe(450 * 60);
    expect(result.times.runS).toBe(405 * 60);
    expect(result.times.downtimeS).toBe(45 * 60);
    expect(result.times.unplannedStopS).toBe(45 * 60);
    expect(result.times.recoveredS).toBe(0);
    expect(result.incompleteData).toBe(false);
  });

  it("calcula as contagens e o tempo ideal", () => {
    expect(result.totals.total).toBe(3600);
    expect(result.totals.reject).toBe(72);
    expect(result.totals.good).toBe(3528);
    expect(result.totals.idealTimeS).toBe(360 * 60);
    expect(result.totals.goodIdealTimeS).toBeCloseTo(352.8 * 60, 9);
  });

  it("chega a A 90,0% · P 88,9% · Q 98,0% · OEE 78,4%", () => {
    const { availability, performance, quality, qualityByCount, oee } = result.indicators;
    expect(pct(availability)).toBe("90.0");
    expect(pct(performance)).toBe("88.9");
    expect(pct(quality)).toBe("98.0");
    expect(pct(qualityByCount)).toBe("98.0");
    expect(pct(oee)).toBe("78.4");
    expect(availability).toBeCloseTo(0.9, 12);
    expect(performance).toBeCloseTo(360 / 405, 12);
    expect(quality).toBeCloseTo(0.98, 12);
    expect(oee).toBeCloseTo(0.784, 12);
  });

  it("confere: OEE = A × P × Q = (boas × ciclo) ÷ planejado", () => {
    const { availability, performance, quality, oee } = result.indicators;
    expect(oee).toBeCloseTo((availability ?? 0) * (performance ?? 0) * (quality ?? 0), 12);
    expect(oee).toBeCloseTo((3528 * 6) / (450 * 60), 12);
    expect(result.performanceStatus).toEqual({ above100: false, reviewIdealCycle: false, capped: performance });
    expect(result.warnings).toEqual([]);
  });
});
