import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { getTableName } from "drizzle-orm"
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as schema from "../src/schema/index"
import { ALL_TABLES } from "../src/tenancy"
import { tenantTablesWithoutForcedRls, tenantTablesWithoutIsolationPolicy } from "./catalog"
import { count, createTestDatabase, MIGRATIONS_FOLDER, type TestDatabase } from "./helpers"

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
      "0005_member_machine_owner_decisions",
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

describe("0005 aplicada sobre um banco que já tinha clientes", () => {
  let folder: string
  let client: PGlite

  beforeAll(async () => {
    // Cópia das migrações com o journal só até a 0004 (o migrator aplica o que o journal lista).
    folder = mkdtempSync(join(tmpdir(), "engemase-db-ate-0004-"))
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true })
    const upTo0004 = { ...journal, entries: journal.entries.filter((entry) => entry.idx <= 4) }
    writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify(upTo0004, null, 2))
    client = new PGlite()
    await migrate(drizzle({ client }), { migrationsFolder: folder })
  })

  afterAll(async () => {
    await client.close()
    rmSync(folder, { recursive: true, force: true })
  })

  it("liga managed_by_engemase dos clientes existentes (D13), mesmo com um dono SEM BYPASSRLS", async () => {
    // Cliente criado antes da 0005, quando o padrão era false.
    await client.exec(`
      INSERT INTO organization (name, slug) VALUES ('Cliente antigo', 'antigo');
      INSERT INTO client_account (organization_id, limits)
        SELECT id, '{"machines": 10}' FROM organization WHERE slug = 'antigo';`)
    const before = await client.query<{ managed: boolean }>("SELECT managed_by_engemase AS managed FROM client_account")
    expect(before.rows).toEqual([{ managed: false }])

    // Dono das tabelas como na Neon: papel comum, sem SUPERUSER nem BYPASSRLS.
    await client.exec(`
      CREATE ROLE migration_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
      DO $$
      DECLARE r record;
      BEGIN
        EXECUTE format('GRANT CREATE ON DATABASE %I TO migration_owner', current_database());
        FOR r IN
          SELECT c.oid::regclass AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'p')
        LOOP
          EXECUTE format('ALTER TABLE %s OWNER TO migration_owner', r.t);
        END LOOP;
      END
      $$;
      ALTER SCHEMA drizzle OWNER TO migration_owner;
      GRANT CREATE ON SCHEMA public TO migration_owner;
      GRANT USAGE ON SCHEMA app TO migration_owner;
      GRANT EXECUTE ON FUNCTION app.enable_tenant_rls(regclass) TO migration_owner;`)

    // A armadilha: com a RLS forçada, o dono sem BYPASSRLS não enxerga nenhuma linha (um UPDATE
    // simples não faria nada, sem erro).
    const seenByOwner = await client.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE migration_owner")
      const n = await count(tx, "SELECT 1 FROM client_account")
      await tx.rollback()
      return n
    })
    expect(seenByOwner).toBe(0)

    await client.exec("SET ROLE migration_owner")
    try {
      await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER })
    } finally {
      await client.exec("RESET ROLE")
    }

    const after = await client.query<{ managed: boolean; forced: boolean }>(`
      SELECT a.managed_by_engemase AS managed, c.relforcerowsecurity AS forced
      FROM client_account a, pg_class c WHERE c.oid = 'public.client_account'::regclass`)
    expect(after.rows).toEqual([{ managed: true, forced: true }])
    // A tabela nova e todas as outras de cliente continuam com RLS forçada e a política de cliente.
    expect(await tenantTablesWithoutForcedRls(client)).toEqual([])
    expect(await tenantTablesWithoutIsolationPolicy(client)).toEqual([])
    const applied = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")
    expect(applied.rows[0]?.n).toBe(journal.entries.length)
  })
})
