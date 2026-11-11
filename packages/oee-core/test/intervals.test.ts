import { describe, expect, it } from "vitest";
import {
  clipInterval,
  clipIntervals,
  intersectIntervals,
  normalizeIntervals,
  OeeInputError,
  subtractIntervals,
  totalDurationMs,
  unionIntervals,
} from "../src/index.js";

const i = (start: number, end: number) => ({ start, end });

describe("álgebra de intervalos", () => {
  it("normaliza: ordena, descarta vazios e funde sobrepostos/encostados", () => {
    expect(normalizeIntervals([i(10, 20), i(0, 5), i(5, 8), i(15, 30), i(40, 40)])).toEqual([i(0, 8), i(10, 30)]);
  });

  it("rejeita intervalo com fim antes do início", () => {
    expect(() => normalizeIntervals([i(10, 5)])).toThrow(OeeInputError);
    expect(() => normalizeIntervals([i(Number.NaN, 5)])).toThrow(OeeInputError);
  });

  it("recorta pela janela, inclusive intervalos em aberto (fim infinito)", () => {
    expect(clipInterval({ start: 0, end: Infinity, tag: "x" }, i(10, 20))).toEqual({ start: 10, end: 20, tag: "x" });
    expect(clipInterval(i(0, 10), i(10, 20))).toBeNull();
    expect(clipIntervals([i(0, 12), i(15, 25)], i(10, 20))).toEqual([i(10, 12), i(15, 20)]);
  });

  it("interseção, união e diferença", () => {
    const a = [i(0, 10), i(20, 30)];
    const b = [i(5, 25)];
    expect(intersectIntervals(a, b)).toEqual([i(5, 10), i(20, 25)]);
    expect(unionIntervals(a, b)).toEqual([i(0, 30)]);
    expect(subtractIntervals(a, b)).toEqual([i(0, 5), i(25, 30)]);
    expect(subtractIntervals([i(0, 100)], [i(10, 20), i(15, 30), i(50, 60), i(90, 200)])).toEqual([i(0, 10), i(30, 50), i(60, 90)]);
    expect(subtractIntervals([i(0, 10), i(20, 30)], [i(-5, 100)])).toEqual([]);
  });

  it("duração total não conta sobreposição duas vezes", () => {
    expect(totalDurationMs([i(0, 10), i(5, 15), i(20, 25)])).toBe(20);
  });
});
