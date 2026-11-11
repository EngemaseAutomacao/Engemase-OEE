import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js"
import addFormats from "ajv-formats"
import type { z } from "zod"
import { CONTRACT_SCHEMAS, type ContractSchemaName } from "../src/index"
import type { FixtureManifest } from "../scripts/fixtures/build"

export const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..")
export const fixturesDir = join(packageDir, "fixtures")
export const schemaDir = join(packageDir, "schema")

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown
}

export function readFixture(file: string): unknown {
  return readJson(join(fixturesDir, file))
}

export function listJsonFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.split("\\").join("/"))
    .sort()
}

export function loadManifest(): FixtureManifest {
  return readFixture("manifest.json") as FixtureManifest
}

export function zodSchema(name: ContractSchemaName): z.ZodType {
  const entry = CONTRACT_SCHEMAS.find((e) => e.name === name)
  if (entry === undefined) throw new Error(`schema desconhecido: ${name}`)
  return entry.schema
}

/** Problemas do Zod resumidos como "caminho" e "caminho[regra]". */
export function issueKeys(schema: z.ZodType, data: unknown): string[] {
  const result = schema.safeParse(data)
  if (result.success) return []
  return result.error.issues.map((issue) => {
    const path = issue.path.map(String).join(".")
    const params = "params" in issue ? (issue.params as Record<string, unknown> | undefined) : undefined
    const rule = params?.["rule"]
    return typeof rule === "string" ? `${path}[${rule}]` : path
  })
}

/** Regras semânticas disparadas (params.rule). */
export function rulesOf(schema: z.ZodType, data: unknown): string[] {
  return issueKeys(schema, data)
    .map((k) => /\[(.+)\]$/.exec(k)?.[1])
    .filter((r): r is string => r !== undefined)
}

function compileAll(flavor: "tolerant" | "strict"): Map<ContractSchemaName, ValidateFunction> {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false })
  addFormats(ajv)
  const out = new Map<ContractSchemaName, ValidateFunction>()
  for (const { name } of CONTRACT_SCHEMAS) {
    const file = flavor === "strict" ? join(schemaDir, "strict", `${name}.json`) : join(schemaDir, `${name}.json`)
    out.set(name, ajv.compile(readJson(file) as object))
  }
  return out
}

let cache: { tolerant: Map<ContractSchemaName, ValidateFunction>; strict: Map<ContractSchemaName, ValidateFunction> } | undefined

/** Validadores ajv dos arquivos JSON Schema gerados (os mesmos que o agente Go usa). */
export function jsonSchemaValidator(name: ContractSchemaName, flavor: "tolerant" | "strict"): ValidateFunction {
  cache ??= { tolerant: compileAll("tolerant"), strict: compileAll("strict") }
  const fn = cache[flavor].get(name)
  if (fn === undefined) throw new Error(`validador ausente: ${name}`)
  return fn
}

export function clone<T>(value: T): T {
  return structuredClone(value)
}
