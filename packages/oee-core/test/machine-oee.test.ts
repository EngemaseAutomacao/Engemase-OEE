import { describe, expect, it } from "vitest";
import {
  aggregateOee,
  calculateMachineOee,
  generateShiftWindows,
  OeeInputError,
  resolveStateTimeline,
  type MachineOeeInput,
  type ShiftDefinition,
} from "../src/index.js";
import { ev, iv, minutesBetween, pct, t } from "./helpers.js";

/** Turno simples em UTC 08:00–09:00, sem pausas, máquina rodando o tempo todo. */
function hourInput(overrides: Partial<MachineOeeInput> = {}): MachineOeeInput {
  const window = iv("2026-11-11T08:00:00Z", "2026-11-11T09:00:00Z");
  return {
    window,
    schedule: [window],
    stateEvents: [ev("RUNNING", "2026-11-11T07:00:00Z", null)],
    minutes: minutesBetween(window.start, window.end, () => ({ total: 10, reject: 0, productCode: "A" })),
    idealCycles: { byProduct: { A: 5 } },
    ...overrides,
  };
}

describe("micro-paradas", () => {
  const stateEvents = [
    ev("RUNNING", "2026-11-11T07:00:00Z", "2026-11-11T08:10:00Z"),
    ev("STOPPED", "2026-11-11T08:10:00Z", "2026-11-11T08:10:30Z"), // 30 s → micro
    ev("RUNNING", "2026-11-11T08:10:30Z", "2026-11-11T08:20:00Z"),
    ev("FAULT", "2026-11-11T08:20:00Z", "2026-11-11T08:20:45Z"), // 45 s → micro
    ev("RUNNING", "2026-11-11T08:20:45Z", "2026-11-11T08:30:00Z"),
    ev("STOPPED", "2026-11-11T08:30:00Z", "2026-11-11T08:31:30Z"), // 90 s → parada
    ev("RUNNING", "2026-11-11T08:31:30Z", "2026-11-11T08:40:00Z"),
    ev("STOPPED", "2026-11-11T08:40:00Z", "2026-11-11T08:40:30Z"), // 30 s + 40 s contíguos = 70 s → parada
    ev("FAULT", "2026-11-11T08:40:30Z", "2026-11-11T08:41:10Z"),
    ev("RUNNING", "2026-11-11T08:41:10Z", null),
  ];

  it("paradas menores que o limite contam como operação (afetam P, não A)", () => {
    const withMicro = calculateMachineOee(hourInput({ stateEvents, options: { microStopThresholdS: 60 } }));
    expect(withMicro.times.plannedS).toBe(3600);
    expect(withMicro.times.microStopS).toBe(75);
    expect(withMicro.times.unplannedStopS).toBe(160);
    expect(withMicro.times.runS).toBe(3600 - 160);

    const withoutMicro = calculateMachineOee(hourInput({ stateEvents, options: { microStopThresholdS: 0 } }));
    expect(withoutMicro.times.microStopS).toBe(0);
    expect(withoutMicro.times.runS).toBe(3600 - 235);

    // A regra só redistribui a perda entre A e P: o OEE final é o mesmo.
    expect(withMicro.indicators.availability).toBeGreaterThan(withoutMicro.indicators.availability ?? 1);
    expect(withMicro.indicators.performance).toBeLessThan(withoutMicro.indicators.performance ?? 0);
    expect(withMicro.indicators.oee).toBeCloseTo(withoutMicro.indicators.oee ?? -1, 12);
  });

  it("a duração da parada é a do episódio inteiro, mesmo cortado pela janela", () => {
    const events = [
      ev("RUNNING", "2026-11-11T08:00:00Z", "2026-11-11T08:59:45Z"),
      ev("STOPPED", "2026-11-11T08:59:45Z", "2026-11-11T09:00:15Z"), // 30 s atravessando 09:00 → micro
      ev("RUNNING", "2026-11-11T09:00:15Z", "2026-11-11T09:59:00Z"),
      ev("FAULT", "2026-11-11T09:59:00Z", "2026-11-11T10:00:30Z"), // 90 s atravessando 10:00 → parada
      ev("RUNNING", "2026-11-11T10:00:30Z", null),
    ];
    const options = { microStopThresholdS: 60 };
    const timeline = resolveStateTimeline(events, iv("2026-11-11T09:00:00Z", "2026-11-11T10:00:00Z"), options);
    expect(timeline.map((s) => s.category)).toEqual(["micro_stop", "run", "unplanned_stop"]);
    expect(timeline[0]).toMatchObject({ start: t("2026-11-11T09:00:00Z"), end: t("2026-11-11T09:00:15Z"), effect: "operating" });

    const window = iv("2026-11-11T09:00:00Z", "2026-11-11T10:00:00Z");
    const result = calculateMachineOee(hourInput({ window, schedule: [window], stateEvents: events, options }));
    expect(result.times.microStopS).toBe(15);
    expect(result.times.unplannedStopS).toBe(60);
  });

  it("parada em aberto nunca é micro-parada", () => {
    const events = [ev("RUNNING", "2026-11-11T08:00:00Z", "2026-11-11T08:59:40Z"), ev("STOPPED", "2026-11-11T08:59:40Z", null)];
    const result = calculateMachineOee(hourInput({ stateEvents: events, options: { microStopThresholdS: 60 } }));
    expect(result.times.microStopS).toBe(0);
    expect(result.times.unplannedStopS).toBe(20);
  });
});

describe("troca de produto no meio do turno", () => {
  const window = iv("2026-11-11T09:00:00Z", "2026-11-11T17:00:00Z");
  const change = t("2026-11-11T13:00:00Z");
  const minutes = minutesBetween(window.start, window.end, (i, start) =>
    start < change
      ? { total: 9, reject: i < 20 ? 1 : 0, productCode: "PRD-A" } // 240 min × 9 = 2.160, 20 refugos
      : { total: 4, reject: i < 250 ? 1 : 0, productCode: "PRD-B" }, // 240 min × 4 = 960, 10 refugos
  );
  const base: MachineOeeInput = {
    window,
    schedule: [window],
    stateEvents: [ev("RUNNING", "2026-11-11T08:00:00Z", null)],
    minutes,
    idealCycles: { byProduct: { "PRD-A": 6, "PRD-B": 12 } },
  };

  it("calcula o tempo ideal por produto", () => {
    const result = calculateMachineOee(base);
    expect(result.products).toEqual([
      { productCode: "PRD-A", total: 2160, reject: 20, good: 2140, idealCycleS: 6, idealTimeS: 12960, goodIdealTimeS: 12840 },
      { productCode: "PRD-B", total: 960, reject: 10, good: 950, idealCycleS: 12, idealTimeS: 11520, goodIdealTimeS: 11400 },
    ]);
    expect(result.totals.idealTimeS).toBe(24480);
    expect(result.indicators.performance).toBeCloseTo(24480 / 28800, 12); // 85,0%
    expect(result.indicators.oee).toBeCloseTo(24240 / 28800, 12);
    expect(result.indicators.quality).toBeCloseTo(24240 / 24480, 12); // ponderada pelo ciclo
    expect(result.indicators.qualityByCount).toBeCloseTo(3090 / 3120, 12);
    const { availability, performance, quality, oee } = result.indicators;
    expect(oee).toBeCloseTo((availability ?? 0) * (performance ?? 0) * (quality ?? 0), 12);
  });

  it("ajuste manual de qualidade herda o produto do minuto", () => {
    const result = calculateMachineOee({
      ...base,
      qualityAdjustments: [
        { at: t("2026-11-11T14:00:30Z"), quantity: 5 }, // minuto de PRD-B
        { at: t("2026-11-11T10:00:00Z"), quantity: 3, productCode: "PRD-A" },
        { at: t("2026-11-11T10:05:00Z"), quantity: -1 }, // estorno em PRD-A
        { at: t("2026-11-11T18:00:00Z"), quantity: 100 }, // fora da janela
      ],
    });
    expect(result.totals.total).toBe(3120);
    expect(result.totals.reject).toBe(30 + 5 + 3 - 1);
    expect(result.products.map((p) => [p.productCode, p.reject])).toEqual([
      ["PRD-A", 22],
      ["PRD-B", 15],
    ]);
    expect(result.totals.goodIdealTimeS).toBe(2138 * 6 + 945 * 12);
  });

  it("produto sem ciclo ideal: usa o ciclo padrão; sem padrão, P e OEE ficam null", () => {
    const withDefault = calculateMachineOee({ ...base, idealCycles: { byProduct: { "PRD-A": 6 }, defaultS: 12 } });
    expect(withDefault.totals.idealTimeS).toBe(24480);

    const missing = calculateMachineOee({ ...base, idealCycles: { byProduct: { "PRD-A": 6 } } });
    expect(missing.indicators.performance).toBeNull();
    expect(missing.indicators.oee).toBeNull();
    expect(missing.indicators.availability).toBe(1);
    expect(missing.indicators.quality).toBeCloseTo(3090 / 3120, 12);
    expect(missing.warnings.map((w) => w.code)).toEqual(["MISSING_IDEAL_CYCLE"]);
    expect(missing.warnings[0]?.productCodes).toEqual(["PRD-B"]);
  });
});

describe("parada planejada com produção", () => {
  // 06:00–14:00 (UTC) com refeição 10:00–10:30; a máquina roda direto, inclusive no almoço.
  const shift = { start: t("2026-11-11T06:00:00Z"), end: t("2026-11-11T14:00:00Z"), breaks: [iv("2026-11-11T10:00:00Z", "2026-11-11T10:30:00Z")] };
  const base: MachineOeeInput = {
    window: { start: shift.start, end: shift.end },
    schedule: [shift],
    stateEvents: [ev("RUNNING", "2026-11-11T05:00:00Z", null)],
    minutes: minutesBetween(shift.start, shift.end, () => ({ total: 10, reject: 0, productCode: "A" })), // 4.800 peças
    idealCycles: { byProduct: { A: 6 } }, // 4.800 × 6 s = 480 min
  };

  it("por padrão, o tempo rodado na pausa volta a contar como planejado", () => {
    const result = calculateMachineOee(base);
    expect(result.times.scheduledS).toBe(450 * 60);
    expect(result.times.recoveredS).toBe(30 * 60);
    expect(result.times.plannedS).toBe(480 * 60);
    expect(result.indicators.performance).toBeCloseTo(1, 12);
    expect(result.performanceStatus.above100).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("sem a regra, a performance passa de 100% e é sinalizada", () => {
    const result = calculateMachineOee({ ...base, options: { productionDuringPlannedStop: "ignore" } });
    expect(result.times.plannedS).toBe(450 * 60);
    expect(result.indicators.performance).toBeCloseTo(480 / 450, 12);
    expect(result.performanceStatus).toEqual({ above100: true, reviewIdealCycle: true, capped: 1 });
    expect(result.warnings.map((w) => w.code)).toEqual(["PERFORMANCE_ABOVE_100"]);
    expect(result.warnings[0]?.message).toContain("106,7%");
  });

  it("paradas planejadas do calendário e motivos planejados saem do tempo planejado", () => {
    const result = calculateMachineOee({
      ...base,
      stateEvents: [
        ev("RUNNING", "2026-11-11T05:00:00Z", "2026-11-11T07:00:00Z"),
        ev("STOPPED", "2026-11-11T07:00:00Z", "2026-11-11T07:30:00Z", "planned"), // treinamento
        ev("RUNNING", "2026-11-11T07:30:00Z", "2026-11-11T12:00:00Z"),
        ev("STOPPED", "2026-11-11T12:00:00Z", "2026-11-11T13:00:00Z"), // preventiva (calendário)
        ev("RUNNING", "2026-11-11T13:00:00Z", null),
      ],
      plannedDowntimes: [iv("2026-11-11T12:00:00Z", "2026-11-11T13:00:00Z")],
      minutes: [],
    });
    expect(result.times.scheduledS).toBe((480 - 30 - 60) * 60);
    expect(result.times.plannedStopS).toBe(30 * 60);
    expect(result.times.recoveredS).toBe(30 * 60); // rodou na refeição
    expect(result.times.plannedS).toBe((480 - 30 - 60 - 30 + 30) * 60);
    expect(result.times.runS).toBe(result.times.plannedS);
    expect(result.indicators.availability).toBe(1);
  });
});

describe("janela sem planejamento", () => {
  const timeZone = "America/Sao_Paulo";
  const shifts: ShiftDefinition[] = [{ id: "adm", start: "08:00", end: "17:00", daysOfWeek: [1, 2, 3, 4, 5] }];
  // Sábado 14/11/2026 inteiro, no fuso da planta.
  const saturday = { start: t("2026-11-14T03:00:00Z"), end: t("2026-11-15T03:00:00Z") };
  const schedule = generateShiftWindows({ shifts, timeZone, from: "2026-11-13", to: "2026-11-16" });

  it("sem tempo planejado, A, P, Q e OEE são null (nunca 0%)", () => {
    const result = calculateMachineOee({
      window: saturday,
      schedule,
      stateEvents: [ev("STOPPED", "2026-11-13T20:00:00Z", null)],
      minutes: [],
      idealCycles: { byProduct: {}, defaultS: 6 },
    });
    expect(result.times.plannedS).toBe(0);
    expect(result.indicators).toEqual({ availability: null, performance: null, quality: null, qualityByCount: null, oee: null });
    expect(result.performanceStatus).toEqual({ above100: false, reviewIdealCycle: false, capped: null });
    expect(result.warnings).toEqual([]);
  });

  it("se a máquina produziu no sábado, esse tempo volta a ser planejado", () => {
    const stateEvents = [
      ev("STOPPED", "2026-11-13T20:00:00Z", "2026-11-14T12:00:00Z"),
      ev("RUNNING", "2026-11-14T12:00:00Z", "2026-11-14T14:00:00Z"),
      ev("STOPPED", "2026-11-14T14:00:00Z", null),
    ];
    const minutes = minutesBetween(t("2026-11-14T12:00:00Z"), t("2026-11-14T14:00:00Z"), () => ({ total: 10, reject: 0, productCode: null }));
    const input: MachineOeeInput = { window: saturday, schedule, stateEvents, minutes, idealCycles: { byProduct: {}, defaultS: 6 } };

    const counted = calculateMachineOee(input);
    expect(counted.times.plannedS).toBe(7200);
    expect(pct(counted.indicators.oee)).toBe("100.0");

    const ignored = calculateMachineOee({ ...input, options: { productionDuringPlannedStop: "ignore" } });
    expect(ignored.times.plannedS).toBe(0);
    expect(ignored.indicators.oee).toBeNull();
    expect(ignored.indicators.quality).toBe(1);
    expect(ignored.warnings.map((w) => w.code)).toEqual(["COUNT_WITHOUT_RUN_TIME"]);
  });

  it("máquina parada o turno inteiro: OEE 0%, P e Q null", () => {
    const wednesday = generateShiftWindows({ shifts, timeZone, from: "2026-11-11", to: "2026-11-11" });
    const window = iv("2026-11-11T11:00:00Z", "2026-11-11T20:00:00Z"); // 08:00–17:00 local
    const result = calculateMachineOee({
      window,
      schedule: wednesday,
      stateEvents: [ev("FAULT", "2026-11-11T10:00:00Z", null)],
      minutes: [],
      idealCycles: { byProduct: {}, defaultS: 6 },
    });
    expect(result.indicators).toEqual({ availability: 0, performance: null, quality: null, qualityByCount: null, oee: 0 });
  });
});

describe("turno noturno atravessando a meia-noite", () => {
  const timeZone = "America/Sao_Paulo";
  const [night] = generateShiftWindows({
    shifts: [{ id: "t3", start: "22:00", end: "06:00", daysOfWeek: [3], breaks: [{ start: "02:00", end: "02:30" }] }],
    timeZone,
    from: "2026-11-11",
    to: "2026-11-11",
  });
  if (night === undefined) throw new Error("turno não gerado");
  const midnight = t("2026-11-12T03:00:00Z"); // 00:00 local
  const stateEvents = [
    ev("RUNNING", "2026-11-12T00:00:00Z", "2026-11-12T02:30:00Z"),
    ev("FAULT", "2026-11-12T02:30:00Z", "2026-11-12T03:30:00Z"), // 23:30–00:30 local, atravessa a meia-noite
    ev("RUNNING", "2026-11-12T03:30:00Z", "2026-11-12T05:00:00Z"),
    ev("STOPPED", "2026-11-12T05:00:00Z", "2026-11-12T05:30:00Z"), // ceia
    ev("RUNNING", "2026-11-12T05:30:00Z", null),
  ];
  const minutes = minutesBetween(night.start, night.end, (i) => ({ total: 6, reject: i % 50 === 0 ? 1 : 0, productCode: "P" }));
  const input = (window: { start: number; end: number }): MachineOeeInput => ({
    window,
    schedule: [night],
    stateEvents,
    minutes,
    idealCycles: { byProduct: { P: 8 } },
  });

  it("calcula o turno inteiro (22:00–06:00) com a data de início", () => {
    expect(night.shiftDate).toBe("2026-11-11");
    const result = calculateMachineOee(input(night));
    expect(result.times.plannedS).toBe(450 * 60);
    expect(result.times.runS).toBe(390 * 60);
    expect(result.times.unplannedStopS).toBe(60 * 60);
  });

  it("antes e depois da meia-noite somados dão o turno inteiro", () => {
    const before = calculateMachineOee(input({ start: night.start, end: midnight }));
    const after = calculateMachineOee(input({ start: midnight, end: night.end }));
    const whole = calculateMachineOee(input(night));
    expect(before.times.plannedS + after.times.plannedS).toBe(whole.times.plannedS);
    expect(before.times.runS + after.times.runS).toBe(whole.times.runS);
    expect(before.totals.total + after.totals.total).toBe(whole.totals.total);
    const combined = aggregateOee([before.totals, after.totals]);
    expect(combined.indicators.oee).toBeCloseTo(whole.indicators.oee ?? -1, 12);
    expect(combined.indicators.availability).toBeCloseTo(whole.indicators.availability ?? -1, 12);
  });
});

describe("setup, NO_COMM e lacunas", () => {
  const events = [
    ev("RUNNING", "2026-11-11T07:00:00Z", "2026-11-11T08:10:00Z"),
    ev("SETUP", "2026-11-11T08:10:00Z", "2026-11-11T08:30:00Z"),
    ev("RUNNING", "2026-11-11T08:30:00Z", "2026-11-11T08:40:00Z"),
    ev("NO_COMM", "2026-11-11T08:40:00Z", "2026-11-11T08:50:00Z"),
    ev("RUNNING", "2026-11-11T08:50:00Z", "2026-11-11T08:55:00Z"),
    // 08:55–09:00 sem eventos (lacuna)
  ];

  it("por padrão, setup, NO_COMM e lacunas são perda de disponibilidade e marcam dados incompletos", () => {
    const result = calculateMachineOee(hourInput({ stateEvents: events }));
    expect(result.times).toMatchObject({ plannedS: 3600, setupS: 1200, noCommS: 600, noDataS: 300, runS: 1500 });
    expect(result.incompleteData).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("INCOMPLETE_STATE_DATA");
  });

  it("com políticas 'planned', setup e NO_COMM saem do tempo planejado", () => {
    const result = calculateMachineOee(hourInput({ stateEvents: events, options: { setupPolicy: "planned", noCommPolicy: "planned" } }));
    expect(result.times).toMatchObject({ plannedS: 1500, plannedStopS: 2100, setupS: 0, noCommS: 0, noDataS: 0, runS: 1500 });
    expect(result.incompleteData).toBe(false);
  });

  it("o motivo apontado prevalece sobre o estado bruto", () => {
    const result = calculateMachineOee(
      hourInput({
        stateEvents: [
          ev("RUNNING", "2026-11-11T07:00:00Z", "2026-11-11T08:10:00Z"),
          ev("STOPPED", "2026-11-11T08:10:00Z", "2026-11-11T08:20:00Z", "setup"),
          ev("SETUP", "2026-11-11T08:20:00Z", "2026-11-11T08:30:00Z", "unplanned"),
          ev("RUNNING", "2026-11-11T08:30:00Z", null),
        ],
      }),
    );
    expect(result.times).toMatchObject({ setupS: 600, unplannedStopS: 600 });
  });

  it("eventos sobrepostos: o mais recente corta o anterior; evento em aberto vai até o próximo", () => {
    const result = calculateMachineOee(
      hourInput({
        stateEvents: [
          ev("STOPPED", "2026-11-11T08:30:00Z", "2026-11-11T08:45:00Z"),
          ev("RUNNING", "2026-11-11T07:00:00Z", null), // em aberto, cortado em 08:30
          ev("RUNNING", "2026-11-11T08:40:00Z", null), // corta a parada em 08:40
        ],
      }),
    );
    expect(result.times.unplannedStopS).toBe(600);
    expect(result.times.runS).toBe(3000);
  });
});

describe("validação de entrada", () => {
  it("rejeita dados incoerentes com OeeInputError", () => {
    expect(() => calculateMachineOee(hourInput({ window: { start: t("2026-11-11T09:00:00Z"), end: t("2026-11-11T08:00:00Z") } }))).toThrow(
      OeeInputError,
    );
    expect(() => calculateMachineOee(hourInput({ stateEvents: [ev("RUNNING", "2026-11-11T08:00:00Z", "2026-11-11T07:00:00Z")] }))).toThrow(
      /fim antes do início/,
    );
    expect(() => calculateMachineOee(hourInput({ minutes: [{ start: t("2026-11-11T08:00:00Z"), total: -1, reject: 0, productCode: null }] }))).toThrow(
      /contagem inválida/,
    );
    expect(() => calculateMachineOee(hourInput({ options: { microStopThresholdS: -5 } }))).toThrow(/micro-parada/);
  });

  it("refugo maior que o total gera aviso e Q não fica negativa", () => {
    const result = calculateMachineOee(hourInput({ qualityAdjustments: [{ at: t("2026-11-11T08:30:00Z"), quantity: 1000 }] }));
    expect(result.totals.good).toBe(600 - 1000);
    expect(result.indicators.quality).toBe(0);
    expect(result.indicators.oee).toBe(0);
    expect(result.warnings.map((w) => w.code)).toContain("REJECT_EXCEEDS_TOTAL");
  });

  it("minutos fora da janela não contam", () => {
    const result = calculateMachineOee(
      hourInput({ minutes: [{ start: t("2026-11-11T07:59:00Z"), total: 50, reject: 0, productCode: "A" }, { start: t("2026-11-11T08:00:00Z"), total: 7, reject: 1, productCode: "A" }] }),
    );
    expect(result.totals.total).toBe(7);
  });
});
