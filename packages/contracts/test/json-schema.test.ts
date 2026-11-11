import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CONTRACT_SCHEMAS,
  JSON_SCHEMA_BASE_URL,
  buildAllJsonSchemas,
  serializeJsonSchema,
} from "../src/index"
import { listJsonFiles, readJson, schemaDir } from "./helpers"

const generated = buildAllJsonSchemas()

function collect(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) node.forEach((n) => collect(n, key, out))
  else if (typeof node === "object" && node !== null) {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push(v)
      collect(v, key, out)
    }
  }
  return out
}

describe("JSON Schema gerado", () => {
  it("os arquivos em schema/ estão em dia (rode build:schema se falhar)", () => {
    for (const [rel, schema] of generated) {
      expect(readFileSync(join(schemaDir, rel), "utf8"), rel).toBe(serializeJsonSchema(schema))
    }
    expect(listJsonFiles(schemaDir)).toEqual([...generated.keys()].sort())
  })

  it("cada schema tem $schema 2020-12, $id, título e descrição", () => {
    for (const entry of CONTRACT_SCHEMAS) {
      for (const rel of [`${entry.name}.json`, `strict/${entry.name}.json`]) {
        const schema = readJson(join(schemaDir, rel)) as Record<string, unknown>
        expect(schema["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema")
        expect(schema["$id"]).toBe(`${JSON_SCHEMA_BASE_URL}/${rel}`)
        expect(schema["title"]).toBe(entry.title)
        expect(typeof schema["description"]).toBe("string")
      }
    }
  })

  it("o sabor tolerante aceita campos novos; o estrito não", () => {
    for (const entry of CONTRACT_SCHEMAS) {
      const tolerant = generated.get(`${entry.name}.json`)
      const strict = generated.get(`strict/${entry.name}.json`)
      // additionalProperties: false nunca aparece no tolerante (records usam additionalProperties com schema)
      expect(collect(tolerant, "additionalProperties").filter((v) => v === false)).toEqual([])
      expect(collect(strict, "additionalProperties").filter((v) => v === false).length).toBeGreaterThan(0)
    }
  })

  it("os patterns são compatíveis com RE2 (regexp do Go): sem lookaround nem backreference", () => {
    const patterns = new Set<string>()
    for (const schema of generated.values()) {
      for (const p of collect(schema, "pattern")) if (typeof p === "string") patterns.add(p)
    }
    expect(patterns.size).toBeGreaterThan(5)
    for (const p of patterns) {
      expect(p, p).not.toMatch(/\(\?<?[=!]/)
      expect(p, p).not.toMatch(/\\[1-9]/)
      expect(() => new RegExp(p, "u")).not.toThrow()
    }
  })

  it("expressa os limites estruturais principais", () => {
    const config = JSON.stringify(generated.get("gateway-config.json"))
    expect(config).toContain('"maximum":125')
    expect(config).toContain('"maximum":247')
    expect(config).toContain('"maximum":65535')
    const sync = JSON.stringify(generated.get("sync-request.json"))
    expect(sync).toContain('"maxItems":2000')
    expect(sync).toContain("-7[0-9a-fA-F]{3}") // UUIDv7 nos eventos
  })
})
