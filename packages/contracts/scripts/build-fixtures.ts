/**
 * Gera packages/contracts/fixtures/*.json a partir de scripts/fixtures/*.ts.
 * Uso: pnpm --filter @engemase/contracts build:fixtures
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildFixtureFiles } from "./fixtures/build"

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures")

const files = buildFixtureFiles()
await mkdir(fixturesDir, { recursive: true })
for (const name of await readdir(fixturesDir)) {
  if (name.endsWith(".json") && !files.has(name)) await rm(join(fixturesDir, name))
}
for (const [name, content] of files) {
  await writeFile(join(fixturesDir, name), content, "utf8")
}
console.log(`Fixtures geradas: ${files.size} arquivos em ${fixturesDir}`)
