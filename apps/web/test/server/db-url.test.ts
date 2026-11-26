import { describe, expect, it } from "vitest"
import { appDatabaseUrl, authDatabaseUrl, maintenanceDatabaseUrl, modoDemonstracao } from "@/lib/server/db-url"

const POOLED = "postgresql://neondb_owner:segredo@ep-x-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require"
const DIRECT = "postgresql://neondb_owner:segredo@ep-x.sa-east-1.aws.neon.tech/neondb?sslmode=require"
const PASSWORD = "Abcdefghijklmnopqrstuvwxyz0123456789"

describe("appDatabaseUrl", () => {
  it("troca o dono pelo usuário da aplicação, mantendo host, banco e parâmetros", () => {
    const url = new URL(appDatabaseUrl({ VERCEL: "1", DATABASE_URL: POOLED, APP_DB_PASSWORD: PASSWORD }) ?? "")
    expect(url.username).toBe("app_login")
    expect(url.password).toBe(PASSWORD)
    expect(url.host).toBe("ep-x-pooler.sa-east-1.aws.neon.tech")
    expect(url.pathname).toBe("/neondb")
    expect(url.searchParams.get("sslmode")).toBe("require")
  })

  it("APP_DB_USER troca o nome; APP_DATABASE_URL tem prioridade", () => {
    expect(new URL(appDatabaseUrl({ DATABASE_URL: POOLED, APP_DB_PASSWORD: PASSWORD, APP_DB_USER: "outro" }) ?? "").username).toBe(
      "outro",
    )
    expect(appDatabaseUrl({ APP_DATABASE_URL: "postgresql://a@b/c", DATABASE_URL: POOLED })).toBe("postgresql://a@b/c")
  })

  it("na Vercel, nunca conecta como o dono do DATABASE_URL da integração", () => {
    expect(appDatabaseUrl({ VERCEL: "1", DATABASE_URL: POOLED })).toBeNull()
    // A senha do Better Auth não serve para o app.
    expect(appDatabaseUrl({ VERCEL: "1", DATABASE_URL: POOLED, AUTH_DB_PASSWORD: PASSWORD })).toBeNull()
  })

  it("fora da Vercel (dev, testes) usa o DATABASE_URL como está; sem nada, null", () => {
    expect(appDatabaseUrl({ DATABASE_URL: POOLED })).toBe(POOLED)
    expect(appDatabaseUrl({})).toBeNull()
  })
})

describe("authDatabaseUrl", () => {
  it("usa auth_login com AUTH_DB_PASSWORD; AUTH_DATABASE_URL tem prioridade", () => {
    const url = new URL(authDatabaseUrl({ VERCEL: "1", DATABASE_URL: POOLED, AUTH_DB_PASSWORD: PASSWORD }) ?? "")
    expect(url.username).toBe("auth_login")
    expect(authDatabaseUrl({ AUTH_DATABASE_URL: "postgresql://x@y/z", DATABASE_URL: POOLED })).toBe("postgresql://x@y/z")
  })

  it("na Vercel, sem senha nem URL própria, não usa o dono", () => {
    expect(authDatabaseUrl({ VERCEL: "1", DATABASE_URL: POOLED, APP_DB_PASSWORD: PASSWORD })).toBeNull()
  })

  it("fora da Vercel usa o DATABASE_URL (banco local)", () => {
    expect(authDatabaseUrl({ DATABASE_URL: POOLED })).toBe(POOLED)
  })
})

describe("maintenanceDatabaseUrl", () => {
  it("DATABASE_MAINTENANCE_URL, senão a conexão direta da integração; nunca a com pooler", () => {
    expect(maintenanceDatabaseUrl({ DATABASE_MAINTENANCE_URL: "postgresql://m@h/d", DATABASE_URL_UNPOOLED: DIRECT })).toBe(
      "postgresql://m@h/d",
    )
    expect(maintenanceDatabaseUrl({ DATABASE_URL_UNPOOLED: DIRECT, DATABASE_URL: POOLED })).toBe(DIRECT)
    expect(maintenanceDatabaseUrl({ DATABASE_URL: POOLED })).toBeNull()
  })
})

describe("modo demonstração", () => {
  it("ENGEMASE_DEMONSTRACAO=1 desliga todos os endereços, mesmo com banco e senhas", () => {
    const env = {
      ENGEMASE_DEMONSTRACAO: "1",
      DATABASE_URL: POOLED,
      DATABASE_URL_UNPOOLED: DIRECT,
      APP_DB_PASSWORD: PASSWORD,
      AUTH_DB_PASSWORD: PASSWORD,
      APP_DATABASE_URL: "postgresql://a@b/c",
      DATABASE_MAINTENANCE_URL: DIRECT,
    }
    expect(modoDemonstracao(env)).toBe(true)
    expect(appDatabaseUrl(env)).toBeNull()
    expect(authDatabaseUrl(env)).toBeNull()
    expect(maintenanceDatabaseUrl(env)).toBeNull()
  })

  it("sem a variável (ou com outro valor), não é demonstração", () => {
    expect(modoDemonstracao({})).toBe(false)
    expect(modoDemonstracao({ ENGEMASE_DEMONSTRACAO: "0" })).toBe(false)
  })
})
