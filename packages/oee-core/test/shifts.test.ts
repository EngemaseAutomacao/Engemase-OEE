import { describe, expect, it } from "vitest";
import {
  addDays,
  findShiftWindowAt,
  generateShiftWindows,
  isoWeekday,
  OeeInputError,
  plantDateOf,
  timeZoneOffsetMs,
  zonedDateTimeToInstant,
  type ShiftDefinition,
} from "../src/index.js";
import { HOUR, t } from "./helpers.js";

describe("fuso horário da planta", () => {
  it("converte horário local de São Paulo (−03:00) para UTC", () => {
    expect(zonedDateTimeToInstant("2026-11-11", "06:00", "America/Sao_Paulo")).toBe(t("2026-11-11T09:00:00Z"));
    expect(timeZoneOffsetMs(t("2026-11-11T12:00:00Z"), "America/Sao_Paulo")).toBe(-3 * HOUR);
    expect(plantDateOf(t("2026-11-12T02:59:59Z"), "America/Sao_Paulo")).toBe("2026-11-11");
    expect(plantDateOf(t("2026-11-12T03:00:00Z"), "America/Sao_Paulo")).toBe("2026-11-12");
  });

  it("não presume ausência de horário de verão (São Paulo em 2018/2019)", () => {
    // 04/11/2018: o relógio pulou de 00:00 para 01:00 → 00:00 não existe e vira 01:00 (−02:00).
    expect(zonedDateTimeToInstant("2018-11-04", "00:00", "America/Sao_Paulo")).toBe(t("2018-11-04T03:00:00Z"));
    expect(zonedDateTimeToInstant("2018-11-04", "00:30", "America/Sao_Paulo")).toBe(t("2018-11-04T03:30:00Z"));
    expect(zonedDateTimeToInstant("2018-11-03", "23:00", "America/Sao_Paulo")).toBe(t("2018-11-04T02:00:00Z"));
    // 17/02/2019: o relógio voltou de 00:00 para 23:00 → 23:30 do dia 16 ocorre duas vezes; vale a primeira.
    expect(zonedDateTimeToInstant("2019-02-16", "23:30", "America/Sao_Paulo")).toBe(t("2019-02-17T01:30:00Z"));
  });

  it("rejeita fuso, data e horário inválidos", () => {
    expect(() => zonedDateTimeToInstant("2026-11-11", "06:00", "America/Atlantida")).toThrow(OeeInputError);
    expect(() => zonedDateTimeToInstant("2026-02-30", "06:00", "UTC")).toThrow(/Data inexistente/);
    expect(() => zonedDateTimeToInstant("2026-11-11", "24:00", "UTC")).toThrow(/Horário inválido/);
    expect(() => zonedDateTimeToInstant("11/11/2026", "06:00", "UTC")).toThrow(/Data inválida/);
  });

  it("faz aritmética de datas locais", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(isoWeekday("2026-11-11")).toBe(3); // quarta
    expect(isoWeekday("2026-11-15")).toBe(7); // domingo
  });
});

describe("gerador de janelas de turno", () => {
  const timeZone = "America/Sao_Paulo";
  const weekdays = [1, 2, 3, 4, 5] as const;
  const shifts: ShiftDefinition[] = [
    { id: "t1", start: "06:00", end: "14:00", daysOfWeek: [...weekdays], breaks: [{ start: "10:00", end: "10:30" }] },
    { id: "t2", start: "14:00", end: "22:00", daysOfWeek: [...weekdays], breaks: [{ start: "18:00", end: "18:30" }] },
    {
      id: "t3",
      name: "3º turno",
      start: "22:00",
      end: "06:00",
      daysOfWeek: [...weekdays],
      breaks: [{ name: "Ceia", start: "02:00", end: "02:30" }],
    },
  ];

  it("turno noturno atravessa a meia-noite e pertence à data de início", () => {
    // Sexta 13/11 a segunda 16/11: sábado e domingo não têm turno.
    const windows = generateShiftWindows({ shifts, timeZone, from: "2026-11-13", to: "2026-11-16" });
    expect(windows.map((w) => `${w.shiftDate} ${w.shiftId}`)).toEqual([
      "2026-11-13 t1",
      "2026-11-13 t2",
      "2026-11-13 t3",
      "2026-11-16 t1",
      "2026-11-16 t2",
      "2026-11-16 t3",
    ]);
    const fridayNight = windows[2];
    expect(fridayNight).toEqual({
      shiftId: "t3",
      shiftDate: "2026-11-13",
      start: t("2026-11-14T01:00:00Z"), // sexta 22:00 local
      end: t("2026-11-14T09:00:00Z"), // sábado 06:00 local
      breaks: [{ start: t("2026-11-14T05:00:00Z"), end: t("2026-11-14T05:30:00Z") }], // sábado 02:00 local
    });
    expect(plantDateOf(fridayNight?.end ?? 0, timeZone)).toBe("2026-11-14");
  });

  it("encontra o turno de um instante (o turno noturno de sábado de madrugada é o de sexta)", () => {
    const windows = generateShiftWindows({ shifts, timeZone, from: "2026-11-12", to: "2026-11-14" });
    const found = findShiftWindowAt(windows, t("2026-11-14T04:00:00Z")); // sábado 01:00 local
    expect(found?.shiftId).toBe("t3");
    expect(found?.shiftDate).toBe("2026-11-13");
    expect(findShiftWindowAt(windows, t("2026-11-14T12:00:00Z"))).toBeNull(); // sábado 09:00
  });

  it("respeita a vigência (validFrom/validTo) pela data de início do turno", () => {
    const windows = generateShiftWindows({
      shifts: [{ id: "x", start: "08:00", end: "17:00", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], validFrom: "2026-11-10", validTo: "2026-11-11" }],
      timeZone,
      from: "2026-11-09",
      to: "2026-11-12",
    });
    expect(windows.map((w) => w.shiftDate)).toEqual(["2026-11-10", "2026-11-11"]);
  });

  it("turno de 24 h quando início = fim", () => {
    const [w] = generateShiftWindows({
      shifts: [{ id: "24h", start: "06:00", end: "06:00", daysOfWeek: [3], breaks: [{ start: "05:00", end: "06:00" }] }],
      timeZone,
      from: "2026-11-11",
      to: "2026-11-11",
    });
    expect(w?.end).toBe((w?.start ?? 0) + 24 * HOUR);
    expect(w?.breaks).toEqual([{ start: t("2026-11-12T08:00:00Z"), end: t("2026-11-12T09:00:00Z") }]);
  });

  it("turno noturno dura 9 h ou 7 h nas trocas de horário de verão (Nova York)", () => {
    const night: ShiftDefinition = { id: "n", start: "22:00", end: "06:00", daysOfWeek: [6] };
    const [fallBack] = generateShiftWindows({ shifts: [night], timeZone: "America/New_York", from: "2026-10-31", to: "2026-10-31" });
    const [springForward] = generateShiftWindows({ shifts: [night], timeZone: "America/New_York", from: "2026-03-07", to: "2026-03-07" });
    expect(fallBack?.start).toBe(t("2026-11-01T02:00:00Z")); // 22:00 EDT (−04:00)
    expect(fallBack?.end).toBe(t("2026-11-01T11:00:00Z")); // 06:00 EST (−05:00)
    expect((fallBack?.end ?? 0) - (fallBack?.start ?? 0)).toBe(9 * HOUR);
    expect((springForward?.end ?? 0) - (springForward?.start ?? 0)).toBe(7 * HOUR);
  });

  it("rejeita definições inválidas com mensagens em português", () => {
    const base = { id: "x", start: "06:00", end: "14:00", daysOfWeek: [1] as const };
    expect(() =>
      generateShiftWindows({ shifts: [{ ...base, daysOfWeek: [1], breaks: [{ start: "13:30", end: "14:30" }] }], timeZone, from: "2026-11-09", to: "2026-11-09" }),
    ).toThrow(/fora do turno/);
    expect(() =>
      generateShiftWindows({ shifts: [{ ...base, daysOfWeek: [8 as never] }], timeZone, from: "2026-11-09", to: "2026-11-09" }),
    ).toThrow(/dia da semana inválido/);
    expect(() => generateShiftWindows({ shifts: [{ ...base, daysOfWeek: [1] }], timeZone, from: "2026-11-10", to: "2026-11-09" })).toThrow(
      /Período inválido/,
    );
    expect(() => generateShiftWindows({ shifts: [{ ...base, daysOfWeek: [1] }], timeZone: "Brasil/SP", from: "2026-11-09", to: "2026-11-09" })).toThrow(
      /Fuso horário inválido/,
    );
  });
});
