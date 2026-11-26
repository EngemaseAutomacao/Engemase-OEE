import { describe, expect, it } from "vitest"
import { resolveDatabaseUrl } from "@/lib/server/db"

const POOLED = "postgresql://neondb_owner:segredo@ep-x-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require"
const PASSWORD = "Abcdefghijklmnopqrstuvwxyz0123456789"

describe("resolveDatabaseUrl", () => {
  it("troca o dono pelo usuário da aplicação, mantendo host, banco e parâmetros", () => {
    const url = new URL(resolveDatabaseUrl({ VERCEL: "1", DATABASE_URL: POOLED, APP_DB_PASSWORD: PASSWORD }) ?? "")
    expect(url.username).toBe("app_login")
    expect(url.password).toBe(PASSWORD)
    expect(url.host).toBe("ep-x-pooler.sa-east-1.aws.neon.tech")
    expect(url.pathname).toBe("/neondb")
    expect(url.searchParams.get("sslmode")).toBe("require")
  })

  it("APP_DB_USER troca o nome do usuário", () => {
    const url = resolveDatabaseUrl({ DATABASE_URL: POOLED, APP_DB_PASSWORD: PASSWORD, APP_DB_USER: "outro" })
    expect(new URL(url ?? "").username).toBe("outro")
  })

  it("APP_DATABASE_URL tem prioridade", () => {
    expect(resolveDatabaseUrl({ APP_DATABASE_URL: "postgresql://a@b/c", DATABASE_URL: POOLED })).toBe("postgresql://a@b/c")
  })

  it("na Vercel, nunca conecta como o dono do DATABASE_URL da integração", () => {
    expect(resolveDatabaseUrl({ VERCEL: "1", DATABASE_URL: POOLED })).toBeNull()
  })

  it("fora da Vercel (dev, testes) usa o DATABASE_URL como está; sem nada, null", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: POOLED })).toBe(POOLED)
    expect(resolveDatabaseUrl({})).toBeNull()
  })
})
