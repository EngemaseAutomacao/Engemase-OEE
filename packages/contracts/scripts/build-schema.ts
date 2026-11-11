/**
 * Gera packages/contracts/schema/*.json (tolerante) e schema/strict/*.json (estrito)
 * a partir dos schemas Zod. Uso: pnpm --filter @engemase/contracts build:schema
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildAllJsonSchemas, serializeJsonSchema } from "../src/json-schema"

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema")

async function removeStaleJson(dir: string, keep: Set<string>, prefix = ""): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const rel = `${prefix}${entry.name}`
    if (entry.isDirectory()) await removeStaleJson(join(dir, entry.name), keep, `${rel}/`)
    else if (entry.name.endsWith(".json") && !keep.has(rel)) await rm(join(dir, entry.name))
  }
}

const files = buildAllJsonSchemas()
await mkdir(join(schemaDir, "strict"), { recursive: true })
await removeStaleJson(schemaDir, new Set(files.keys()))
for (const [rel, schema] of files) {
  await writeFile(join(schemaDir, rel), serializeJsonSchema(schema), "utf8")
}
console.log(`JSON Schema gerado: ${files.size} arquivos em ${schemaDir}`)
