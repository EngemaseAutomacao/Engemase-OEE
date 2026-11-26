import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { DeployConfigError, type LoginRole, loginRoleSql, planMigration, readLogin, readLogins } from "../src/deploy"
import { createTestDatabase, type TestDatabase } from "./helpers"

const PASSWORD = "Abcdefghijklmnopqrstuvwxyz012345-._~"
const OWNER_URL = "postgresql://owner:x@db.example/neondb"
const APP: LoginRole = { kind: "app", user: "app_login", password: PASSWORD, memberOf: "app_user", inherit: false }
const AUTH: LoginRole = { kind: "auth", user: "auth_login", password: PASSWORD, memberOf: "auth_service", inherit: true }

describe("planMigration", () => {
  it("produção migra com a URL sem pooler", () => {
    const plan = planMigration({
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://pooled",
      DATABASE_URL_UNPOOLED: OWNER_URL,
    })
    expect(plan).toMatchObject({ run: true, url: OWNER_URL, urlSource: "DATABASE_URL_UNPOOLED", logins: [] })
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

  it("lê os usuários de login do app e do Better Auth", () => {
    const plan = planMigration({
      VERCEL_ENV: "production",
      DATABASE_URL: OWNER_URL,
      APP_DB_PASSWORD: PASSWORD,
      AUTH_DB_PASSWORD: PASSWORD,
    })
    expect(plan).toMatchObject({ run: true, logins: [APP, AUTH] })
  })
})

describe("readLogin", () => {
  it("recusa senha curta, com caracteres inseguros ou papel reservado", () => {
    expect(() => readLogin({ APP_DB_PASSWORD: "curta" }, "app")).toThrow(DeployConfigError)
    expect(() => readLogin({ APP_DB_PASSWORD: `${PASSWORD}'; DROP ROLE x; --` }, "app")).toThrow(DeployConfigError)
    expect(() => readLogin({ AUTH_DB_PASSWORD: `${PASSWORD}$$` }, "auth")).toThrow(DeployConfigError)
    expect(() => readLogin({ APP_DB_PASSWORD: PASSWORD, APP_DB_USER: "app_user" }, "app")).toThrow(DeployConfigError)
    expect(() => readLogin({ APP_DB_PASSWORD: PASSWORD, APP_DB_USER: 'x"; DROP' }, "app")).toThrow(DeployConfigError)
  })

  it("app e auth não podem usar o mesmo usuário", () => {
    expect(() => readLogins({ APP_DB_PASSWORD: PASSWORD, AUTH_DB_PASSWORD: PASSWORD, AUTH_DB_USER: "app_login" })).toThrow(
      DeployConfigError,
    )
  })

  it("a mensagem de erro não mostra a senha", () => {
    const bad = `${PASSWORD}!`
    try {
      readLogin({ APP_DB_PASSWORD: bad }, "app")
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).not.toContain(bad)
    }
  })
})

describe("loginRoleSql no banco", () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase()
  })
  afterAll(async () => {
    await database.client.close()
  })

  async function roleInfo(user: string, memberOf: string) {
    const result = await database.client.query<{
      login: boolean
      inherit: boolean
      bypass: boolean
      createrole: boolean
      super: boolean
      member: boolean
      usage: boolean
    }>(
      `SELECT rolcanlogin AS login, rolinherit AS inherit, rolbypassrls AS bypass, rolcreaterole AS createrole,
              rolsuper AS super, pg_has_role($1, $2, 'MEMBER') AS member, pg_has_role($1, $2, 'USAGE') AS usage
       FROM pg_roles WHERE rolname = $1`,
      [user, memberOf],
    )
    return result.rows[0]
  }

  it("app_login: membro de app_user só com SET (não herda), sem poderes; idempotente", async () => {
    await database.client.exec(loginRoleSql(APP))
    await database.client.exec(loginRoleSql(APP)) // segunda vez: só atualiza a senha
    expect(await roleInfo("app_login", "app_user")).toEqual({
      login: true,
      inherit: false,
      bypass: false,
      createrole: false,
      super: false,
      member: true,
      usage: false,
    })
  })

  it("auth_login: herda auth_service (o Better Auth não troca de papel)", async () => {
    await database.client.exec(loginRoleSql(AUTH))
    await database.client.exec(loginRoleSql(AUTH))
    expect(await roleInfo("auth_login", "auth_service")).toMatchObject({ login: true, inherit: true, member: true, usage: true })
  })

  it("recusa reaproveitar um papel existente com poderes demais", async () => {
    await database.client.exec("CREATE ROLE poderoso LOGIN BYPASSRLS")
    await expect(database.client.exec(loginRoleSql({ ...APP, user: "poderoso" }))).rejects.toThrow(/poderes demais/)
  })

  it("como app_login, sem SET ROLE não lê nada; com app_user fica sob a RLS", async () => {
    const { client } = database
    await client.exec(loginRoleSql(APP))
    const result = await client.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE app_login")
      const denied = await tx.query("SELECT count(*) FROM organization").then(
        () => "leu",
        (error: unknown) => (error as Error).message,
      )
      await tx.rollback()
      return denied
    })
    expect(result).toMatch(/permission denied/)

    const rows = await client.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE app_login")
      await tx.exec("SET LOCAL ROLE app_user")
      const r = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM organization")
      await tx.rollback()
      return r.rows[0]?.n
    })
    expect(rows).toBe(0)
  })
})
