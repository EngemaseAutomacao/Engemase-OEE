/**
 * Regras puras do login: rotas de /api/auth (lista de permissão), duração da sessão, contagem do
 * bloqueio, política de senha (com a consulta de vazamento falhando) e variáveis de ambiente.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { authEnforced, authSettings } from "@/lib/server/auth/env"
import { isPasswordPwned, newPasswordError, passwordPolicyError } from "@/lib/server/auth/password"
import { ALLOWED_AUTH_ROUTES, CLOSED_AUTH_ROUTES, isAuthRouteAllowed } from "@/lib/server/auth/routes"
import {
  evaluateSession,
  initialExpiry,
  SESSION_IDLE_MS,
  SESSION_REMEMBER_MS,
  SESSION_TOUCH_MS,
} from "@/lib/server/auth/session-policy"
import { LOGIN_LOCK_MS, LOGIN_WINDOW_MS, nextThrottleState } from "@/lib/server/auth/throttle"
import { type AuthHarness, createAuthHarness } from "./support"

const T0 = new Date("2026-11-24T12:00:00Z")
const at = (ms: number) => new Date(T0.getTime() + ms)
const HOUR = 3_600_000

describe("/api/auth fechado por padrão (docs/15, item 10)", () => {
  let h: AuthHarness

  beforeAll(async () => {
    h = await createAuthHarness()
  })

  afterAll(async () => {
    await h.t.client.close()
  })

  it("toda rota do Better Auth está classificada (aberta ou fechada com motivo)", () => {
    const paths = new Set<string>()
    for (const endpoint of Object.values(h.auth.api) as unknown[]) {
      const path = (endpoint as { path?: unknown }).path
      if (typeof path === "string") paths.add(path)
    }
    expect(paths.size).toBeGreaterThan(10)
    const unclassified = [...paths].filter((p) => !(p in ALLOWED_AUTH_ROUTES) && !(p in CLOSED_AUTH_ROUTES)).sort()
    expect(unclassified, "rota nova do Better Auth: classifique em lib/server/auth/routes.ts").toEqual([])
    for (const p of Object.keys(ALLOWED_AUTH_ROUTES)) expect(paths.has(p), p).toBe(true)
  })

  it("só a lista aberta responde, e só com o método certo", () => {
    expect(isAuthRouteAllowed("POST", "/sign-in/email")).toBe(true)
    expect(isAuthRouteAllowed("GET", "/sign-in/email")).toBe(false)
    expect(isAuthRouteAllowed("POST", "/sign-up/email")).toBe(false)
    expect(isAuthRouteAllowed("POST", "/two-factor/enable")).toBe(false)
    expect(isAuthRouteAllowed("GET", "/reset-password/abc")).toBe(false)
    expect(isAuthRouteAllowed("GET", "/get-session")).toBe(true)
  })
})

describe("duração da sessão (L20)", () => {
  const base = { createdAt: T0, lastActiveAt: null, rememberMe: false }

  it("sessão de 12 h: renovada a cada uso, cai depois de 12 h parada", () => {
    const expiresAt = initialExpiry(false, T0)
    expect(expiresAt.getTime() - T0.getTime()).toBe(SESSION_IDLE_MS)
    expect(evaluateSession({ ...base, expiresAt }, false, at(60_000))).toEqual({ valid: true, touch: null })
    const used = evaluateSession({ ...base, expiresAt }, false, at(2 * HOUR))
    expect(used).toEqual({ valid: true, touch: { lastActiveAt: at(2 * HOUR), expiresAt: at(14 * HOUR) } })
    expect(evaluateSession({ ...base, lastActiveAt: at(2 * HOUR), expiresAt: at(14 * HOUR) }, false, at(13 * HOUR)).valid).toBe(true)
    expect(evaluateSession({ ...base, lastActiveAt: at(2 * HOUR), expiresAt: at(30 * HOUR) }, false, at(14 * HOUR))).toEqual({
      valid: false,
      reason: "idle",
    })
  })

  it("'manter conectado': até 30 dias, mesmo sem uso; nunca além", () => {
    const expiresAt = initialExpiry(true, T0)
    expect(expiresAt.getTime() - T0.getTime()).toBe(SESSION_REMEMBER_MS)
    const s = { ...base, rememberMe: true, expiresAt }
    expect(evaluateSession(s, false, at(20 * 24 * HOUR)).valid).toBe(true)
    expect(evaluateSession({ ...s, expiresAt: at(40 * 24 * HOUR) }, false, at(30 * 24 * HOUR + 1))).toEqual({
      valid: false,
      reason: "max_age",
    })
  })

  it("equipe Engemase: 'manter conectado' não vale, regra das 12 h", () => {
    const s = { ...base, rememberMe: true, expiresAt: initialExpiry(true, T0) }
    expect(evaluateSession(s, true, at(13 * HOUR))).toEqual({ valid: false, reason: "idle" })
  })

  it("vencida no banco: inválida", () => {
    expect(evaluateSession({ ...base, expiresAt: T0 }, false, T0)).toEqual({ valid: false, reason: "expired" })
  })

  it("grava o uso no máximo a cada 5 min", () => {
    const expiresAt = initialExpiry(false, T0)
    expect(evaluateSession({ ...base, expiresAt }, false, at(SESSION_TOUCH_MS - 1)).valid && "ok").toBe("ok")
    const r = evaluateSession({ ...base, expiresAt }, false, at(SESSION_TOUCH_MS - 1))
    expect(r.valid && r.touch).toBeNull()
    const r2 = evaluateSession({ ...base, expiresAt }, false, at(SESSION_TOUCH_MS))
    expect(r2.valid && r2.touch !== null).toBe(true)
  })
})

describe("bloqueio por tentativas (função pura)", () => {
  it("5 erros dentro de 15 min bloqueiam por 15 min", () => {
    let state = nextThrottleState(null, T0)
    for (let i = 1; i < 4; i++) state = nextThrottleState(state, at(i * 60_000))
    expect(state).toMatchObject({ failures: 4, lockedUntil: null, justLocked: false })
    state = nextThrottleState(state, at(5 * 60_000))
    expect(state).toMatchObject({ failures: 5, justLocked: true, lockedUntil: at(5 * 60_000 + LOGIN_LOCK_MS) })
  })

  it("erros espalhados (janela de 15 min vencida) recomeçam a contagem", () => {
    let state = nextThrottleState(null, T0)
    for (let i = 1; i < 4; i++) state = nextThrottleState(state, at(i * 60_000))
    state = nextThrottleState(state, at(LOGIN_WINDOW_MS + 1))
    expect(state).toMatchObject({ failures: 1, lockedUntil: null })
  })

  it("depois do bloqueio, a contagem recomeça do zero", () => {
    const locked = { failures: 5, windowStartedAt: T0, lockedUntil: at(LOGIN_LOCK_MS) }
    expect(nextThrottleState(locked, at(60_000))).toMatchObject({ failures: 5, justLocked: false, lockedUntil: at(LOGIN_LOCK_MS) })
    expect(nextThrottleState(locked, at(LOGIN_LOCK_MS + 1))).toMatchObject({ failures: 1, lockedUntil: null })
  })
})

describe("senha (L20)", () => {
  it("12 caracteres ou mais, sem regra de composição", () => {
    expect(passwordPolicyError("onze-letras")).toMatch(/12 caracteres/)
    expect(passwordPolicyError("aaaaaaaaaaaa")).toBeNull()
    expect(passwordPolicyError("só minúsculas e espaços")).toBeNull()
    // Conta caracteres, não bytes: 12 emojis passam.
    expect(passwordPolicyError("🔒".repeat(12))).toBeNull()
    expect(passwordPolicyError("x".repeat(129))).toMatch(/no máximo/)
  })

  it("consulta de vazamento por k-anonimato: só o prefixo de 5 caracteres do SHA-1 sai", async () => {
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    let requested = ""
    const fakeFetch = (async (url: string | URL | Request) => {
      requested = String(url)
      return new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n0000000000000000000000000000000000A:0\r\n")
    }) as typeof fetch
    expect(await isPasswordPwned("password", { fetch: fakeFetch })).toBe(true)
    expect(requested).toBe("https://api.pwnedpasswords.com/range/5BAA6")
    expect(await isPasswordPwned("outra senha qualquer!", { fetch: fakeFetch })).toBe(false)
  })

  it("sem rede ou com erro do serviço: 'não sei' e a senha é aceita (nunca bloqueia)", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed")
    }) as typeof fetch
    const error500 = (async () => new Response("", { status: 503 })) as typeof fetch
    expect(await isPasswordPwned("frase longa o bastante", { fetch: offline })).toBeNull()
    expect(await isPasswordPwned("frase longa o bastante", { fetch: error500 })).toBeNull()
    expect(await newPasswordError("frase longa o bastante", async () => null)).toBeNull()
    expect(await newPasswordError("frase longa o bastante", async () => true)).toMatch(/vazamentos/)
  })
})

describe("variáveis de ambiente", () => {
  it("AUTH_ENFORCED: padrão em produção segue o login configurado", () => {
    const secret = "x".repeat(32)
    expect(authEnforced({ NODE_ENV: "production", BETTER_AUTH_SECRET: secret })).toBe(true)
    // Login ainda não configurado na Vercel: a demonstração (dados simulados) continua aberta.
    expect(authEnforced({ NODE_ENV: "production" })).toBe(false)
    expect(authEnforced({ NODE_ENV: "production", AUTH_ENFORCED: "true" })).toBe(true)
    expect(authEnforced({ NODE_ENV: "development" })).toBe(false)
    expect(authEnforced({ NODE_ENV: "production", AUTH_ENFORCED: "false" })).toBe(false)
    expect(authEnforced({ NODE_ENV: "development", AUTH_ENFORCED: "true" })).toBe(true)
    expect(authEnforced({ NODE_ENV: "production", BETTER_AUTH_SECRET: secret, AUTH_ENFORCED: "talvez" })).toBe(true)
  })

  it("Better Auth só liga com segredo de 32+ caracteres e URL válida", () => {
    expect(authSettings({})).toBeNull()
    expect(authSettings({ BETTER_AUTH_SECRET: "curto", BETTER_AUTH_URL: "https://x.test" })).toBeNull()
    expect(authSettings({ BETTER_AUTH_SECRET: "x".repeat(32), BETTER_AUTH_URL: "ftp://x.test" })).toBeNull()
    expect(authSettings({ BETTER_AUTH_SECRET: "x".repeat(32), BETTER_AUTH_URL: "https://x.test/caminho" })).toEqual({
      secret: "x".repeat(32),
      baseURL: "https://x.test",
    })
  })
})
