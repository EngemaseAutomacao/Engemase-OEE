import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getTableName } from "drizzle-orm"
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api"
import { migrate } from "drizzle-orm/pglite/migrator"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as schema from "../src/schema/index"
import { ALL_TABLES } from "../src/tenancy"
import { createTestDatabase, MIGRATIONS_FOLDER, type TestDatabase } from "./helpers"

interface Journal {
  readonly entries: readonly { readonly idx: number; readonly tag: string }[]
}

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as Journal

describe("migrações", () => {
  let t: TestDatabase

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  it("aplicam do zero num Postgres 18 (PGlite)", async () => {
    const version = await t.client.query<{ v: number }>("SELECT current_setting('server_version_num')::int AS v")
    expect(version.rows[0]?.v).toBeGreaterThanOrEqual(180_000)

    const applied = await t.client.query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")
    expect(applied.rows[0]?.n).toBe(journal.entries.length)
    expect(journal.entries.map((e) => e.tag)).toEqual([
      "0000_init",
      "0001_rls",
      "0002_contract_columns_quality_reversal",
      "0003_organization_rls_state_lookups",
      "0004_organization_slug_check",
    ])
  })

  it("são idempotentes: rodar o migrator de novo não muda nada", async () => {
    await migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER })
    const applied = await t.client.query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")
    expect(applied.rows[0]?.n).toBe(journal.entries.length)
  })

  it("criam exatamente as tabelas declaradas no schema", async () => {
    const result = await t.client.query<{ name: string }>(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
    )
    const inDb = result.rows.map((r) => r.name)
    const inSchema = ALL_TABLES.map((table) => getTableName(table)).sort()
    expect(inDb).toEqual(inSchema)
  })

  it("geram ids UUIDv7 no banco", async () => {
    const result = await t.client.query<{ id: string }>(
      "INSERT INTO organization (name, slug) VALUES ('X', 'uuid-v7') RETURNING id",
    )
    expect(result.rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it("estão em dia com o schema TypeScript (rode `pnpm db:generate` se falhar)", async () => {
    const last = journal.entries.at(-1)
    if (last === undefined) throw new Error("journal vazio")
    const snapshotFile = join(MIGRATIONS_FOLDER, "meta", `${String(last.idx).padStart(4, "0")}_snapshot.json`)
    const previous = JSON.parse(readFileSync(snapshotFile, "utf8")) as Parameters<typeof generateMigration>[0]
    const current = generateDrizzleJson(schema, previous.id, ["public"])
    const pending = await generateMigration(previous, current)
    expect(pending).toEqual([])
  })
})
