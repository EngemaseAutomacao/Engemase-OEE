/**
 * Particionamento das séries temporais (migração 0013) e manutenção diária (`app.maintain_partitions`,
 * `maintainPartitions()`): partições futuras, retenção, idempotência, RLS pela tabela-mãe e conversão de
 * uma tabela que já tinha dados (sem copiar nem perder linhas, com um dono SEM BYPASSRLS, como na Neon).
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { maintainPartitions, PARTITIONED_TABLES } from "../src/partitions"
import * as schema from "../src/schema/index"
import { partitions, tenantTablesWithoutForcedRls, tenantTablesWithoutIsolationPolicy } from "./catalog"
import { type SeededTenant, seedTenant } from "./fixtures"
import { asTenant, count, createTestDatabase, expectDbError, MIGRATIONS_FOLDER, type TestDatabase } from "./helpers"

const RLS_ERROR = /row-level security/

async function partitionsOf(client: PGlite, parent: string): Promise<string[]> {
  return (await partitions(client)).filter((p) => p.parent === parent).map((p) => p.partition)
}

describe("partições das séries temporais", () => {
  let t: TestDatabase
  let a: SeededTenant
  let b: SeededTenant

  beforeAll(async () => {
    t = await createTestDatabase()
    a = await seedTenant(t.db, "alfa")
    b = await seedTenant(t.db, "beta")
  })

  afterAll(async () => {
    await t.client.close()
  })

  it("production_minute é mensal e tag_sample semanal, com a tabela antiga como primeira partição", async () => {
    const kinds = await t.client.query<{ name: string; strategy: string; key: string }>(`
      SELECT c.relname AS name, p.partstrat AS strategy, pg_get_partkeydef(c.oid) AS key
      FROM pg_partitioned_table p JOIN pg_class c ON c.oid = p.partrelid ORDER BY 1`)
    expect(kinds.rows).toEqual([
      { name: "production_minute", strategy: "r", key: "RANGE (bucket_start)" },
      { name: "tag_sample", strategy: "r", key: "RANGE (at)" },
    ])
    const config = await t.client.query<{ parent_table: string; period: string; premake: number; retention: string }>(
      "SELECT parent_table, period, premake, retention::text AS retention FROM app.partitioned_table ORDER BY 1",
    )
    expect(config.rows).toEqual(
      Object.entries(PARTITIONED_TABLES).map(([parent_table, c]) => ({
        parent_table,
        period: c.period,
        premake: c.premake,
        retention: c.retention === "2 years" ? "2 years" : "90 days",
      })),
    )
    // A migração já deixou o período atual e os seguintes prontos (antes da primeira tarefa diária).
    const minute = await partitionsOf(t.client, "production_minute")
    expect(minute).toContain("production_minute_legacy")
    expect(minute.length).toBeGreaterThanOrEqual(1 + PARTITIONED_TABLES.production_minute.premake)
    const samples = await partitionsOf(t.client, "tag_sample")
    expect(samples).toContain("tag_sample_legacy")
    expect(samples.length).toBeGreaterThanOrEqual(1 + PARTITIONED_TABLES.tag_sample.premake)
  })

  it("a chave, os CHECKs e as FKs continuam na tabela-mãe com os nomes do drizzle-kit", async () => {
    const result = await t.client.query<{ name: string }>(`
      SELECT conname AS name FROM pg_constraint
      WHERE conrelid = 'public.production_minute'::regclass AND contype IN ('p', 'f', 'c')
      ORDER BY 1`)
    expect(result.rows.map((r) => r.name)).toEqual([
      "production_minute_bucket_chk",
      "production_minute_counts_chk",
      "production_minute_good_chk",
      "production_minute_machine_fk",
      "production_minute_organization_id_organization_id_fk",
      "production_minute_pk",
      "production_minute_seconds_chk",
    ])
    // ON CONFLICT na chave (como o /sync faz) funciona na tabela particionada.
    const inserted = await asTenant(t.client, a.organizationId, async (tx) => {
      const sqlText = `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject)
        VALUES ($1, $2, date_trunc('minute', now()) + interval '20 days', 60, 0, 0, 0, 5, 0)
        ON CONFLICT (machine_id, bucket_start) DO NOTHING`
      const first = await tx.query(sqlText, [a.organizationId, a.machineId])
      const second = await tx.query(sqlText, [a.organizationId, a.machineId])
      return [first.affectedRows, second.affectedRows]
    })
    expect(inserted).toEqual([1, 0])
    // A FK composta continua valendo: máquina de B não entra com o cliente A (nem como dono).
    await expectDbError(
      t.client.query(
        `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject)
         VALUES ($1, $2, date_trunc('minute', now()), 60, 0, 0, 0, 5, 0)`,
        [a.organizationId, b.machineId],
      ),
      /production_minute_machine_fk/,
    )
  })

  it("RLS pela tabela-mãe vale em todas as partições; o app não acessa partição direto", async () => {
    // Linha de B numa partição futura (gravada como dono).
    await t.client.query(
      `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject)
       VALUES ($1, $2, date_trunc('minute', now()) + interval '40 days', 60, 0, 0, 0, 9, 0)`,
      [b.organizationId, b.machineId],
    )
    await asTenant(t.client, a.organizationId, async (tx) => {
      expect(await count(tx, "SELECT 1 FROM production_minute WHERE organization_id <> $1", [a.organizationId])).toBe(0)
      expect(await count(tx, "SELECT 1 FROM production_minute")).toBeGreaterThan(0)
    })
    await expect(
      asTenant(t.client, a.organizationId, (tx) =>
        tx.query(
          `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject)
           VALUES ($1, $2, date_trunc('minute', now()) + interval '40 days', 60, 0, 0, 0, 9, 0)`,
          [b.organizationId, b.machineId],
        ),
      ),
    ).rejects.toThrow(RLS_ERROR)
    const [partition] = await partitionsOf(t.client, "production_minute")
    if (partition === undefined) throw new Error("sem partições")
    await expect(
      asTenant(t.client, a.organizationId, (tx) => tx.query(`SELECT 1 FROM public."${partition}"`)),
    ).rejects.toThrow(/permission denied/)
  })

  it("gravar além das partições criadas falha alto (a tarefa diária mantém meses de folga)", async () => {
    await expectDbError(
      asTenant(t.client, a.organizationId, (tx) =>
        tx.query(
          `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject)
           VALUES ($1, $2, date_trunc('minute', now()) + interval '2 years', 60, 0, 0, 0, 9, 0)`,
          [a.organizationId, a.machineId],
        ),
      ),
      /no partition of relation "production_minute" found for row/,
    )
  })

  it("dados antigos (antes da partição atual) vão para a partição _legacy", async () => {
    await asTenant(t.client, a.organizationId, async (tx) => {
      await tx.query(
        `INSERT INTO tag_sample (organization_id, tag_id, at, value) VALUES ($1, $2, '2020-01-01T00:00:00Z', 7)`,
        [a.organizationId, a.tagId],
      )
      const where = await tx.query<{ partition: string }>(
        "SELECT tableoid::regclass::text AS partition FROM tag_sample WHERE at = '2020-01-01T00:00:00Z'",
      )
      expect(where.rows).toEqual([{ partition: "tag_sample_legacy" }])
    })
  })

  it("maintainPartitions cria os períodos seguintes, é idempotente e o dry-run não muda nada", async () => {
    const future = new Date(Date.UTC(2027, 7, 15, 12)) // 15/08/2027
    const before = (await partitions(t.client)).length

    const preview = await maintainPartitions(t.db, { now: future, dryRun: true })
    expect((await partitions(t.client)).length).toBe(before)
    expect(preview.length).toBeGreaterThan(0)

    const actions = await maintainPartitions(t.db, { now: future })
    expect(actions).toEqual(preview)
    const created = actions.filter((x) => x.action === "created")
    expect(created.map((x) => x.partitionName)).toEqual(
      expect.arrayContaining(["production_minute_p2027_08", "production_minute_p2027_11", "tag_sample_p2027_08_09"]),
    )
    // tag_sample guarda 90 dias: em agosto de 2027 as semanas de 2026 (e a _legacy) já saem.
    expect(actions.filter((x) => x.action === "dropped").map((x) => x.partitionName)).toEqual(
      expect.arrayContaining(["tag_sample_legacy"]),
    )
    expect(actions.some((x) => x.action === "dropped" && x.parentTable === "production_minute")).toBe(false)
    const august = created.find((x) => x.partitionName === "production_minute_p2027_08")
    expect(august?.rangeFrom?.toISOString()).toBe("2027-08-01T00:00:00.000Z")
    expect(august?.rangeTo?.toISOString()).toBe("2027-09-01T00:00:00.000Z")
    // Semana começa na segunda-feira, em UTC.
    const week = created.find((x) => x.partitionName === "tag_sample_p2027_08_09")
    expect(week?.rangeFrom?.toISOString()).toBe("2027-08-09T00:00:00.000Z")
    expect(week?.rangeTo?.toISOString()).toBe("2027-08-16T00:00:00.000Z")

    // Segunda execução no mesmo dia: nada a fazer.
    expect(await maintainPartitions(t.db, { now: future })).toEqual([])
    // Partições novas também ficam com RLS forçada e a política de cliente.
    expect(await tenantTablesWithoutForcedRls(t.client)).toEqual([])
    expect(await tenantTablesWithoutIsolationPolicy(t.client)).toEqual([])
  })

  it("a retenção apaga só partições inteiras mais velhas que o prazo (inclusive a _legacy)", async () => {
    // Três anos depois: tudo de production_minute até 2 anos antes sai; tag_sample guarda 90 dias.
    const later = new Date(Date.UTC(2030, 2, 10, 3))
    const actions = await maintainPartitions(t.db, { now: later })
    const dropped = actions.filter((x) => x.action === "dropped")
    expect(dropped.map((x) => x.partitionName)).toEqual(
      expect.arrayContaining(["production_minute_legacy", "production_minute_p2027_08", "tag_sample_p2027_08_09"]),
    )
    const legacy = dropped.find((x) => x.partitionName === "production_minute_legacy")
    expect(legacy?.rangeFrom).toBeNull()
    const cutoffMinute = new Date(Date.UTC(2028, 2, 10, 3)).getTime()
    const cutoffSamples = later.getTime() - 90 * 24 * 3_600_000
    for (const x of dropped) {
      const limit = x.parentTable === "production_minute" ? cutoffMinute : cutoffSamples
      expect(x.rangeTo?.getTime(), x.partitionName).toBeLessThanOrEqual(limit)
    }
    const remaining = await partitions(t.client)
    expect(remaining.map((p) => p.partition)).not.toContain("production_minute_legacy")
    // Nenhuma partição que ainda tem dado dentro do prazo foi apagada.
    const bounds = await t.client.query<{ name: string; to: Date }>(`
      SELECT partition_name AS name, range_to AS "to" FROM app.partition_bounds('public.production_minute')`)
    for (const row of bounds.rows) expect(row.to.getTime()).toBeGreaterThan(cutoffMinute)
    expect(await maintainPartitions(t.db, { now: later })).toEqual([])
  })

  it("o app_user não executa a manutenção (só o dono das tabelas)", async () => {
    await expect(
      asTenant(t.client, a.organizationId, (tx) => tx.query("SELECT * FROM app.maintain_partitions()")),
    ).rejects.toThrow(/permission denied/)
    await expect(asTenant(t.client, null, (tx) => tx.query("SELECT * FROM app.partitioned_table"))).rejects.toThrow(
      /permission denied/,
    )
  })
})

/** A migração das partições é sempre a última: o teste aplica todas as anteriores, grava dados e só então a aplica. */
const PARTITIONS_TAG = "0013_w2b_partitions_maintenance"

describe("0013 (partições) aplicada sobre tabelas que já tinham dados", () => {
  let folder: string
  let client: PGlite

  beforeAll(async () => {
    interface Journal {
      readonly entries: readonly { readonly idx: number; readonly tag: string }[]
    }
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as Journal
    folder = mkdtempSync(join(tmpdir(), "engemase-db-antes-particoes-"))
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true })
    writeFileSync(
      join(folder, "meta", "_journal.json"),
      // Banco "de antes": só as migrações anteriores à 0013 (o migrator do Drizzle não aplica uma
      // migração mais antiga que a última aplicada, então as posteriores também ficam para depois).
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === PARTITIONS_TAG)) }, null, 2),
    )
    client = new PGlite()
    await migrate(drizzle({ client }), { migrationsFolder: folder })
  })

  afterAll(async () => {
    await client.close()
    rmSync(folder, { recursive: true, force: true })
  })

  it("mantém todas as linhas (sem cópia) e funciona com um dono SEM BYPASSRLS", async () => {
    const tenant = await seedTenant(drizzle({ client, schema }), "antes")
    // Dados espalhados: passado distante, agora e um pouco à frente (relógio adiantado de um gateway).
    await client.query(
      `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject)
       SELECT $1, $2, ts, 60, 0, 0, 0, 1, 0
       FROM unnest(ARRAY[timestamptz '2025-01-01T00:00:00Z', date_trunc('minute', now()) + interval '45 days']) AS ts`,
      [tenant.organizationId, tenant.machineId],
    )
    const before = await count(client, "SELECT 1 FROM production_minute")
    const oid = await client.query<{ oid: number }>("SELECT 'public.production_minute'::regclass::oid::int AS oid")

    // Dono das tabelas como na Neon: papel comum, sem SUPERUSER nem BYPASSRLS (ver migrations.test.ts).
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
      GRANT EXECUTE ON FUNCTION app.enable_tenant_rls(regclass) TO migration_owner;
      -- Na Neon o mesmo dono rodou a 0001: é dono do schema app e membro de app_lookup.
      ALTER SCHEMA app OWNER TO migration_owner;
      GRANT app_lookup TO migration_owner;`)
    await client.exec("SET ROLE migration_owner")
    try {
      await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER })
    } finally {
      await client.exec("RESET ROLE")
    }

    expect(await count(client, "SELECT 1 FROM production_minute")).toBe(before)
    // A tabela antiga (mesmo oid, sem cópia) virou a partição _legacy e guarda inclusive o minuto adiantado.
    const legacy = await client.query<{ oid: number }>("SELECT 'public.production_minute_legacy'::regclass::oid::int AS oid")
    expect(legacy.rows[0]?.oid).toBe(oid.rows[0]?.oid)
    expect(await count(client, "SELECT 1 FROM production_minute_legacy")).toBe(before)
    const bound = await client.query<{ to: Date }>(
      "SELECT range_to AS \"to\" FROM app.partition_bounds('public.production_minute') WHERE partition_name = 'production_minute_legacy'",
    )
    const maxRow = await client.query<{ max: Date }>("SELECT max(bucket_start) AS max FROM production_minute")
    expect(bound.rows[0]?.to.getTime()).toBeGreaterThan(maxRow.rows[0]?.max.getTime() ?? Number.POSITIVE_INFINITY)
    // O app continua lendo pela tabela-mãe, só o próprio cliente.
    await asTenant(client, tenant.organizationId, async (tx) => {
      expect(await count(tx, "SELECT 1 FROM production_minute")).toBe(before)
    })
    expect(await tenantTablesWithoutForcedRls(client)).toEqual([])
    expect(await tenantTablesWithoutIsolationPolicy(client)).toEqual([])
  })
})
