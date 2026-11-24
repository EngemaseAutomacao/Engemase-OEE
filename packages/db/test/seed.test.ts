/**
 * Seed sintético (src/seed): só roda liberado por variável de ambiente e fora de produção, recusa banco
 * com cliente real, é determinístico e idempotente, e os dados respeitam a RLS e as regras do banco.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  assertSeedAllowed,
  DEMO_CLIENTS,
  SEED_ENV_FLAG,
  SEED_ENV_VALUE,
  SeedRefusedError,
  seedId,
  seedSynthetic,
} from "../src/seed/index"
import { TENANT_TABLE_NAMES } from "../src/tenancy"
import { tenantTablesWithoutForcedRls } from "./catalog"
import { asTenant, count, createTestDatabase, expectDbError, ident, type TestDatabase } from "./helpers"

const NOW = new Date("2026-11-24T15:37:12Z")

describe("liberação do seed por ambiente", () => {
  it("exige ENGEMASE_SEED=sintetico", () => {
    expect(() => assertSeedAllowed({})).toThrow(SeedRefusedError)
    expect(() => assertSeedAllowed({ [SEED_ENV_FLAG]: "1" })).toThrow(SeedRefusedError)
    expect(() => assertSeedAllowed({ [SEED_ENV_FLAG]: SEED_ENV_VALUE })).not.toThrow()
  })

  it("recusa produção mesmo com a variável ligada", () => {
    expect(() => assertSeedAllowed({ [SEED_ENV_FLAG]: SEED_ENV_VALUE, VERCEL_ENV: "production" })).toThrow(
      /produção/,
    )
    expect(() => assertSeedAllowed({ [SEED_ENV_FLAG]: SEED_ENV_VALUE, NODE_ENV: "production" })).toThrow(/produção/)
    expect(() => assertSeedAllowed({ [SEED_ENV_FLAG]: SEED_ENV_VALUE, VERCEL_ENV: "preview" })).not.toThrow()
  })

  it("ids determinísticos em formato UUID", () => {
    expect(seedId("x")).toBe(seedId("x"))
    expect(seedId("x")).not.toBe(seedId("y"))
    expect(seedId("x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe("seed sintético num banco vazio", () => {
  let t: TestDatabase

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  it("grava os clientes de demonstração e devolve um token só dos gateways criados", async () => {
    const result = await seedSynthetic(t.db, { now: NOW, days: 1 })
    expect(result.organizations.map((o) => o.slug)).toEqual(DEMO_CLIENTS.map((c) => c.slug))
    expect(result.gatewayTokens).toHaveLength(DEMO_CLIENTS.length)
    const machines = DEMO_CLIENTS.reduce((n, c) => n + c.lines.reduce((m, l) => m + l.machines.length, 0), 0)
    // 1 dia inteiro + o dia de hoje até 15:37 UTC, minuto a minuto, por máquina.
    expect(result.productionMinutes).toBe(machines * (24 * 60 + 15 * 60 + 37))
    expect(await count(t.client, "SELECT 1 FROM production_minute")).toBe(result.productionMinutes)
  })

  it("é idempotente: rodar de novo não duplica nada nem gera token novo", async () => {
    const tables = [...TENANT_TABLE_NAMES, "organization", "user"]
    const before: Record<string, number> = {}
    for (const table of tables) before[table] = await count(t.client, `SELECT 1 FROM ${ident(table)}`)
    const again = await seedSynthetic(t.db, { now: NOW, days: 1 })
    expect(again.gatewayTokens).toEqual([])
    for (const table of tables) expect(await count(t.client, `SELECT 1 FROM ${ident(table)}`), table).toBe(before[table])
  })

  it("cobre as tabelas novas do W2b (feriados, motivos de refugo, operadores, estorno, gateway em trânsito)", async () => {
    for (const table of ["unit_holiday", "reject_reason", "unit_operator"]) {
      expect(await count(t.client, `SELECT 1 FROM ${ident(table)}`), table).toBeGreaterThan(0)
    }
    expect(await count(t.client, "SELECT 1 FROM quality_entry WHERE reverses_id IS NOT NULL")).toBeGreaterThan(0)
    expect(await count(t.client, "SELECT 1 FROM gateway WHERE in_transit_until > $1", [NOW])).toBe(DEMO_CLIENTS.length)
  })

  it("cada cliente de demonstração só enxerga os próprios dados (RLS)", async () => {
    const orgs = await t.client.query<{ id: string }>("SELECT id FROM organization ORDER BY slug")
    for (const { id } of orgs.rows) {
      await asTenant(t.client, id, async (tx) => {
        expect(await count(tx, "SELECT 1 FROM machine")).toBeGreaterThan(0)
        expect(await count(tx, "SELECT 1 FROM production_minute WHERE organization_id <> $1", [id])).toBe(0)
        expect(await count(tx, "SELECT 1 FROM unit_operator WHERE organization_id <> $1", [id])).toBe(0)
      })
    }
    expect(await tenantTablesWithoutForcedRls(t.client)).toEqual([])
  })

  it("o estado ao vivo bate com o último evento de cada máquina", async () => {
    const mismatched = await count(
      t.client,
      `SELECT 1 FROM machine_live l
       JOIN LATERAL (SELECT state FROM machine_state_event e WHERE e.machine_id = l.machine_id ORDER BY started_at DESC LIMIT 1) e ON true
       WHERE e.state <> l.state`,
    )
    expect(mismatched).toBe(0)
    expect(await count(t.client, "SELECT 1 FROM machine_state_event WHERE ended_at IS NULL")).toBe(
      await count(t.client, "SELECT 1 FROM machine_live"),
    )
  })
})

describe("seed sintético recusa banco com dados reais", () => {
  let t: TestDatabase

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  it("para se houver cliente sem slug demo-", async () => {
    await t.client.query("INSERT INTO organization (name, slug) VALUES ('Cliente real', 'cliente-real')")
    await expectDbError(seedSynthetic(t.db, { now: NOW, days: 0 }), /cliente-real/)
    expect(await count(t.client, "SELECT 1 FROM machine")).toBe(0)
  })

  it("para se a conexão não enxergar tudo (sem SUPERUSER nem BYPASSRLS)", async () => {
    await t.client.query("DELETE FROM organization")
    await t.client.exec("CREATE ROLE sem_bypass NOLOGIN NOSUPERUSER NOBYPASSRLS")
    await t.client.exec("SET ROLE sem_bypass")
    try {
      await expect(seedSynthetic(t.db, { now: NOW, days: 0 })).rejects.toThrow(/BYPASSRLS/)
    } finally {
      await t.client.exec("RESET ROLE")
    }
  })
})
