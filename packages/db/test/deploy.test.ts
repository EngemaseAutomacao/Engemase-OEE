import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { appLoginSql, DeployConfigError, planMigration, readAppLogin } from "../src/deploy"
import { createTestDatabase, type TestDatabase } from "./helpers"

const PASSWORD = "Abcdefghijklmnopqrstuvwxyz012345-._~"
const OWNER_URL = "postgresql://owner:x@db.example/neondb"

describe("planMigration", () => {
  it("produção migra com a URL sem pooler", () => {
    const plan = planMigration({
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://pooled",
      DATABASE_URL_UNPOOLED: OWNER_URL,
    })
    expect(plan).toMatchObject({ run: true, url: OWNER_URL, urlSource: "DATABASE_URL_UNPOOLED", appLogin: null })
  })

  it("MIGRATION_DATABASE_URL tem prioridade", () => {
    const plan = planMigration({ MIGRATION_DATABASE_URL: OWNER_URL, DATABASE_URL_UNPOOLED: "postgresql://outro" })
    expect(plan).toMatchObject({ run: true, urlSource: "MIGRATION_DATABASE_URL", target: "manual" })
  })

  it("preview não migra sem DB_MIGRATE_PREVIEW=1 (apontaria para a produção)", () => {
    expect(planMigration({ VERCEL_ENV: "preview", DATABASE_URL_UNPOOLED: OWNER_URL }).run).toBe(false)
    expect(planMigration({ VERCEL_ENV: "preview", DB_MIGRATE_PREVIEW: "1", DATABASE_URL_UNPOOLED: OWNER_URL }).run).toBe(
      true,
    )
  })

  it("desenvolvimento na Vercel não migra", () => {
    expect(planMigration({ VERCEL_ENV: "development", DATABASE_URL: OWNER_URL }).run).toBe(false)
  })

  it("sem banco: na Vercel só avisa; manual falha alto", () => {
    expect(planMigration({ VERCEL_ENV: "production" }).run).toBe(false)
    expect(() => planMigration({})).toThrow(DeployConfigError)
  })

  it("lê o usuário de login da aplicação", () => {
    const plan = planMigration({ VERCEL_ENV: "production", DATABASE_URL: OWNER_URL, APP_DB_PASSWORD: PASSWORD })
    expect(plan).toMatchObject({ run: true, appLogin: { user: "app_login", password: PASSWORD } })
  })
})

describe("readAppLogin", () => {
  it("recusa senha curta, com caracteres inseguros ou papel reservado", () => {
    expect(() => readAppLogin({ APP_DB_PASSWORD: "curta" })).toThrow(DeployConfigError)
    expect(() => readAppLogin({ APP_DB_PASSWORD: `${PASSWORD}'; DROP ROLE x; --` })).toThrow(DeployConfigError)
    expect(() => readAppLogin({ APP_DB_PASSWORD: `${PASSWORD}$$` })).toThrow(DeployConfigError)
    expect(() => readAppLogin({ APP_DB_PASSWORD: PASSWORD, APP_DB_USER: "app_user" })).toThrow(DeployConfigError)
    expect(() => readAppLogin({ APP_DB_PASSWORD: PASSWORD, APP_DB_USER: 'x"; DROP' })).toThrow(DeployConfigError)
  })

  it("a mensagem de erro não mostra a senha", () => {
    const bad = `${PASSWORD}!`
    try {
      readAppLogin({ APP_DB_PASSWORD: bad })
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).not.toContain(bad)
    }
  })
})

describe("appLoginSql no banco", () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase()
  })
  afterAll(async () => {
    await database.client.close()
  })

  it("cria o usuário membro de app_user, sem poderes, e é idempotente", async () => {
    const { client } = database
    const sql = appLoginSql({ user: "app_login", password: PASSWORD })
    await client.exec(sql)
    await client.exec(sql) // segunda vez: só atualiza a senha

    const role = await client.query<{ login: boolean; bypass: boolean; createrole: boolean; super: boolean }>(
      `SELECT rolcanlogin AS login, rolbypassrls AS bypass, rolcreaterole AS createrole, rolsuper AS super
       FROM pg_roles WHERE rolname = 'app_login'`,
    )
    expect(role.rows).toEqual([{ login: true, bypass: false, createrole: false, super: false }])

    const member = await client.query<{ ok: boolean }>("SELECT pg_has_role('app_login', 'app_user', 'MEMBER') AS ok")
    expect(member.rows[0]?.ok).toBe(true)
  })

  it("recusa reaproveitar um papel existente com poderes demais", async () => {
    const { client } = database
    await client.exec("CREATE ROLE poderoso LOGIN BYPASSRLS")
    await expect(client.exec(appLoginSql({ user: "poderoso", password: PASSWORD }))).rejects.toThrow(/poderes demais/)
  })

  it("como app_login, assume app_user e fica sob a RLS (sem cliente, nenhuma linha)", async () => {
    const { client } = database
    await client.exec(appLoginSql({ user: "app_login", password: PASSWORD }))
    await client.exec(
      `INSERT INTO organization (name, slug) VALUES ('Engemase Lab', 'engemase-lab') ON CONFLICT DO NOTHING`,
    )
    const rows = await client.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE app_login")
      await tx.exec("SET LOCAL ROLE app_user")
      const result = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM organization")
      await tx.rollback()
      return result.rows[0]?.n
    })
    expect(rows).toBe(0)
  })
})
