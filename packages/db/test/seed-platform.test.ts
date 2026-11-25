/**
 * Seed de plataforma (src/seed/platform.ts): Engemase Lab + primeiro super admin. Liberação por ambiente
 * (com confirmação extra em produção), conexão de dono, idempotência, link "definir senha" só como hash no
 * banco, auditoria e convivência com o seed sintético.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { sha256Hex } from "../src/lookups"
import { ACCOUNT_TOKEN_PATTERN, setPasswordUrl } from "../src/account-token"
import {
  assertPlatformSeedAllowed,
  ENGEMASE_LAB_SLUG,
  SeedRefusedError,
  seedPlatform,
  seedSynthetic,
} from "../src/seed/index"
import { asTenant, count, createTestDatabase, type TestDatabase } from "./helpers"

const NOW = new Date("2026-11-24T15:00:00Z")
const ADMIN = { adminEmail: "Diretor@Engemase.example", adminName: "Diretor Técnico" }

describe("liberação do seed de plataforma", () => {
  it("exige ENGEMASE_SEED=plataforma", () => {
    expect(() => assertPlatformSeedAllowed({})).toThrow(SeedRefusedError)
    expect(() => assertPlatformSeedAllowed({ ENGEMASE_SEED: "sintetico" })).toThrow(SeedRefusedError)
    expect(() => assertPlatformSeedAllowed({ ENGEMASE_SEED: "plataforma" })).not.toThrow()
  })

  it("em produção exige a confirmação explícita", () => {
    expect(() => assertPlatformSeedAllowed({ ENGEMASE_SEED: "plataforma", VERCEL_ENV: "production" })).toThrow(/PRODUÇÃO/)
    expect(() => assertPlatformSeedAllowed({ ENGEMASE_SEED: "plataforma", NODE_ENV: "production" })).toThrow(/confirmo/)
    expect(() =>
      assertPlatformSeedAllowed({ ENGEMASE_SEED: "plataforma", VERCEL_ENV: "production", ENGEMASE_SEED_PRODUCAO: "confirmo" }),
    ).not.toThrow()
  })

  it("monta o link com o token no fragmento, no endereço canônico", () => {
    expect(setPasswordUrl("https://oee.example.com/qualquer?x=1", "abc")).toBe("https://oee.example.com/definir-senha#t=abc")
  })
})

describe("seed de plataforma num banco", () => {
  let t: TestDatabase

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  it("grava a Engemase Lab, o super admin, o vínculo e um link de uso único (só o hash no banco)", async () => {
    const result = await seedPlatform(t.db, { ...ADMIN, now: NOW })
    expect(result).toMatchObject({ organizationCreated: true, adminCreated: true })
    expect(result.setPasswordToken).toMatch(ACCOUNT_TOKEN_PATTERN)
    expect(result.tokenExpiresAt?.getTime()).toBe(NOW.getTime() + 24 * 3_600_000)

    const org = await t.client.query<{ slug: string; status: string; machines: number }>(
      `SELECT o.slug, a.status, (a.limits ->> 'machines')::int AS machines
       FROM organization o JOIN client_account a ON a.organization_id = o.id`,
    )
    expect(org.rows).toEqual([{ slug: ENGEMASE_LAB_SLUG, status: "active", machines: 10 }])
    const person = await t.client.query<{ email: string; role: string }>(`SELECT email, role FROM "user"`)
    expect(person.rows).toEqual([{ email: "diretor@engemase.example", role: "super_admin" }])
    expect(await count(t.client, "SELECT 1 FROM member_access WHERE role = 'client_admin' AND scope = 'all'")).toBe(1)

    const tokens = await t.client.query<{ token_hash: string; purpose: string }>("SELECT token_hash, purpose FROM account_token")
    expect(tokens.rows).toEqual([{ token_hash: sha256Hex(result.setPasswordToken ?? ""), purpose: "set_password" }])
    const audit = await t.client.query<{ action: string; actor_type: string; after: string }>(
      "SELECT action, actor_type, after::text AS after FROM audit_log",
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]).toMatchObject({ action: "platform.seed", actor_type: "system" })
    // Nem o token nem o e-mail vão para a auditoria.
    expect(audit.rows[0]?.after).not.toContain(result.setPasswordToken ?? "x")

    // O token resolve pela função de busca (como a tela "definir senha" fará), sob o app_user.
    const resolved = await asTenant(t.client, null, (tx) =>
      tx.query<{ organization_id: string }>("SELECT organization_id FROM app.resolve_account_token($1)", [
        sha256Hex(result.setPasswordToken ?? ""),
      ]),
    )
    expect(resolved.rows).toEqual([{ organization_id: result.organizationId }])
  })

  it("rodar de novo não duplica nada e troca o link (o anterior deixa de valer)", async () => {
    const before = await count(t.client, "SELECT 1 FROM account_token WHERE used_at IS NULL")
    const again = await seedPlatform(t.db, { ...ADMIN, now: NOW })
    expect(again).toMatchObject({ organizationCreated: false, adminCreated: false })
    expect(before).toBe(1)
    expect(await count(t.client, "SELECT 1 FROM organization")).toBe(1)
    expect(await count(t.client, "SELECT 1 FROM unit")).toBe(1)
    expect(await count(t.client, `SELECT 1 FROM "user"`)).toBe(1)
    expect(await count(t.client, "SELECT 1 FROM member")).toBe(1)
    expect(await count(t.client, "SELECT 1 FROM account_token WHERE used_at IS NULL")).toBe(1)
    expect(await count(t.client, "SELECT 1 FROM account_token")).toBe(2)
  })

  it("com senha já definida, não gera link", async () => {
    await t.client.query(
      `INSERT INTO account (account_id, provider_id, user_id, password) SELECT id, 'credential', id, 'hash' FROM "user"`,
    )
    const result = await seedPlatform(t.db, { ...ADMIN, now: NOW })
    expect(result.setPasswordToken).toBeNull()
  })

  it("recusa promover a super admin uma pessoa que já existe sem esse papel", async () => {
    await t.client.query(`INSERT INTO "user" (name, email) VALUES ('Cliente', 'gerente@cliente.example')`)
    await expect(seedPlatform(t.db, { adminEmail: "gerente@cliente.example", adminName: "X", now: NOW })).rejects.toThrow(
      /sem o papel super_admin/,
    )
    const role = await t.client.query<{ role: string | null }>(`SELECT role FROM "user" WHERE email = 'gerente@cliente.example'`)
    expect(role.rows).toEqual([{ role: null }])
  })

  it("recusa entrada inválida e conexão sem BYPASSRLS", async () => {
    await expect(seedPlatform(t.db, { adminEmail: "sem-arroba", adminName: "X" })).rejects.toThrow(SeedRefusedError)
    await expect(seedPlatform(t.db, { adminEmail: "a@b.example", adminName: " " })).rejects.toThrow(SeedRefusedError)
    await t.client.exec("CREATE ROLE sem_bypass_plataforma NOLOGIN NOSUPERUSER NOBYPASSRLS")
    await t.client.exec("SET ROLE sem_bypass_plataforma")
    try {
      await expect(seedPlatform(t.db, { ...ADMIN })).rejects.toThrow(/BYPASSRLS/)
    } finally {
      await t.client.exec("RESET ROLE")
    }
  })

  it("o seed sintético aceita o banco que já tem a Engemase Lab", async () => {
    const result = await seedSynthetic(t.db, { now: NOW, days: 0 })
    expect(result.organizations.length).toBeGreaterThan(0)
  })
})
