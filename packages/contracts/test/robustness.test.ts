/**
 * As regras semânticas rodam mesmo quando há outros problemas "continuáveis" (faixas),
 * então não podem lançar exceção com entrada malformada. Este teste altera cada folha
 * das fixtures válidas para valores estranhos e confere que o parse nunca lança.
 */
import { describe, expect, it } from "vitest"
import { loadManifest, readFixture, zodSchema } from "./helpers"

const WEIRD: unknown[] = [null, -1, 1e12, 0.5, "", "x", true, {}, [], [1], { a: 1 }]

function leafPaths(node: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(node)) return [prefix, ...node.flatMap((n, i) => leafPaths(n, [...prefix, i]))]
  if (typeof node === "object" && node !== null) {
    return [prefix, ...Object.entries(node).flatMap(([k, v]) => leafPaths(v, [...prefix, k]))]
  }
  return [prefix]
}

function setAt(root: unknown, path: (string | number)[], value: unknown): unknown {
  if (path.length === 0) return value
  const copy = structuredClone(root) as Record<string | number, unknown>
  let node: Record<string | number, unknown> = copy
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>
  const last = path[path.length - 1]
  if (last !== undefined) node[last] = value
  return copy
}

describe("robustez das regras semânticas", () => {
  const fixtures = loadManifest().fixtures.filter((f) => f.valid)

  it.each(fixtures)("$file: nenhuma mutação faz o parse lançar exceção", (fixture) => {
    const data = readFixture(fixture.file)
    const schema = zodSchema(fixture.schema)
    let runs = 0
    for (const path of leafPaths(data)) {
      for (const weird of WEIRD) {
        const mutated = setAt(data, path, weird)
        expect(() => schema.safeParse(mutated), `${path.join(".")} = ${JSON.stringify(weird)}`).not.toThrow()
        runs++
      }
    }
    expect(runs).toBeGreaterThan(0)
  })
})
