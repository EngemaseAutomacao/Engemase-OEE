/**
 * Login com o Better Auth de verdade (mesma configuração do app) sobre o PGlite (L20, D14):
 * senha, bloqueio depois de 5 erros, duração da sessão, pessoa bloqueada, 2FA com TOTP e códigos de
 * recuperação, política de senha nova.
 */
import * as s from "@engemase/db"
import { eq } from "drizzle-orm"
import { isAPIError } from "better-auth/api"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readSession } from "@/lib/server/auth/session"
import { SESSION_IDLE_MS, SESSION_REMEMBER_MS } from "@/lib/server/auth/session-policy"
import { LOGIN_LOCK_MS } from "@/lib/server/auth/throttle"
import {
  type AuthHarness,
  browserHeaders,
  cookiesFrom,
  createAuthHarness,
  createUserWithPassword,
  GOOD_PASSWORD,
  totpCode,
} from "./support"

const HOUR = 3_600_000

async function signIn(h: AuthHarness, email: string, password: string, rememberMe = false, cookie = "") {
  const result = await outcome(
    h.auth.api.signInEmail({ body: { email, password, rememberMe }, headers: browserHeaders(cookie), asResponse: true }),
  )
  return {
    status: result.status,
    code: result.code,
    headers: result.response?.headers ?? new Headers(),
    json: async () => (result.response ? ((await result.response.clone().json()) as unknown) : null),
  }
}

/**
 * Status e código de erro, venha a resposta como Response ou como APIError lançado (erro lançado
 * pelos nossos hooks "before" chega como exceção nas chamadas diretas `auth.api.*`).
 */
async function outcome(call: Promise<Response>): Promise<{ status: number; code?: string; response?: Response }> {
  try {
    const response = await call
    const body = (await response.clone().json().catch(() => ({}))) as { code?: string }
    return { status: response.status, code: body.code, response }
  } catch (error) {
    if (isAPIError(error)) return { status: error.statusCode, code: (error.body as { code?: string } | undefined)?.code }
    throw error
  }
}

async function sessionRow(h: AuthHarness, userId: string) {
  const rows = await h.t.db.select().from(s.session).where(eq(s.session.userId, userId))
  return rows
}

describe("login (Better Auth)", () => {
  let h: AuthHarness

  beforeAll(async () => {
    h = await createAuthHarness()
  })

  afterAll(async () => {
    await h.t.client.close()
  })

  describe("senha e sessão", () => {
    it("senha certa entra; sem 'manter conectado' a sessão vale 12 h", async () => {
      const p = await createUserWithPassword(h)
      const before = Date.now()
      const res = await signIn(h, p.email, p.password, false)
      expect(res.status).toBe(200)
      const [row] = await sessionRow(h, p.id)
      expect(row?.rememberMe).toBe(false)
      const ttl = (row?.expiresAt.getTime() ?? 0) - before
      expect(ttl).toBeGreaterThan(SESSION_IDLE_MS - 60_000)
      expect(ttl).toBeLessThan(SESSION_IDLE_MS + 60_000)

      const cookie = cookiesFrom(res.headers)
      const current = await readSession(h.auth, h.t.db, browserHeaders(cookie), new Date())
      expect(current?.user).toMatchObject({ id: p.id, email: p.email, twoFactorEnabled: false, role: null })
    })

    it("'manter conectado' vale 30 dias", async () => {
      const p = await createUserWithPassword(h)
      const before = Date.now()
      expect((await signIn(h, p.email, p.password, true)).status).toBe(200)
      const [row] = await sessionRow(h, p.id)
      expect(row?.rememberMe).toBe(true)
      expect((row?.expiresAt.getTime() ?? 0) - before).toBeGreaterThan(SESSION_REMEMBER_MS - 60_000)
    })

    it("equipe Engemase fica sempre em 12 h, mesmo pedindo para manter conectado", async () => {
      const p = await createUserWithPassword(h, { role: "technician" })
      const before = Date.now()
      expect((await signIn(h, p.email, p.password, true)).status).toBe(200)
      const [row] = await sessionRow(h, p.id)
      expect(row?.rememberMe).toBe(false)
      expect((row?.expiresAt.getTime() ?? 0) - before).toBeLessThan(SESSION_IDLE_MS + 60_000)
    })

    it("sessão parada há mais de 12 h cai (e é apagada); com uso, é renovada", async () => {
      const p = await createUserWithPassword(h)
      const res = await signIn(h, p.email, p.password, false)
      const cookie = cookiesFrom(res.headers)
      // Uso depois de 2 h: renova o vencimento para agora + 12 h. O Better Auth confere o vencimento
      // pelo relógio real, então simulamos o tempo puxando as datas da sessão para trás.
      await h.t.db
        .update(s.session)
        .set({
          createdAt: new Date(Date.now() - 2 * HOUR),
          lastActiveAt: new Date(Date.now() - 2 * HOUR),
          expiresAt: new Date(Date.now() + 10 * HOUR),
        })
        .where(eq(s.session.userId, p.id))
      const touched = await readSession(h.auth, h.t.db, browserHeaders(cookie), new Date())
      expect(touched).not.toBeNull()
      const [renewed] = await sessionRow(h, p.id)
      expect((renewed?.expiresAt.getTime() ?? 0) - Date.now()).toBeGreaterThan(SESSION_IDLE_MS - 60_000)

      // Parada há 13 h: cai e some do banco.
      await h.t.db
        .update(s.session)
        .set({ lastActiveAt: new Date(Date.now() - 13 * HOUR), expiresAt: new Date(Date.now() + HOUR) })
        .where(eq(s.session.userId, p.id))
      expect(await readSession(h.auth, h.t.db, browserHeaders(cookie), new Date())).toBeNull()
      expect(await sessionRow(h, p.id)).toHaveLength(0)
    })

    it("pessoa bloqueada (banned) não entra", async () => {
      const p = await createUserWithPassword(h, { banned: true })
      const res = await signIn(h, p.email, p.password)
      expect(res.status).not.toBe(200)
      expect(await sessionRow(h, p.id)).toHaveLength(0)
    })
  })

  describe("bloqueio depois de 5 senhas erradas (15 min)", () => {
    it("5 erros bloqueiam; nem a senha certa entra; depois de 15 min volta", async () => {
      const p = await createUserWithPassword(h)
      h.clock.now = new Date()
      for (let i = 0; i < 4; i++) expect((await signIn(h, p.email, "senha errada qualquer")).status).toBe(401)
      expect(h.locks).toHaveLength(0)
      expect((await signIn(h, p.email, "senha errada qualquer")).status).toBe(401)
      expect(h.locks.map((l) => l.email)).toEqual([p.email])

      const locked = await signIn(h, p.email, p.password)
      expect(locked.status).toBe(429)
      expect(locked.code).toBe("ACCOUNT_LOCKED")
      // O e-mail em outra caixa/espaços é a mesma conta.
      expect((await signIn(h, `  ${p.email.toUpperCase()} `, p.password)).status).not.toBe(200)

      h.clock.now = new Date(h.clock.now.getTime() + LOGIN_LOCK_MS + 1000)
      expect((await signIn(h, p.email, p.password)).status).toBe(200)
      h.clock.now = new Date()
    })

    it("login certo zera a contagem", async () => {
      const p = await createUserWithPassword(h)
      for (let i = 0; i < 4; i++) await signIn(h, p.email, "senha errada qualquer")
      expect((await signIn(h, p.email, p.password)).status).toBe(200)
      for (let i = 0; i < 4; i++) expect((await signIn(h, p.email, "senha errada qualquer")).status).toBe(401)
      expect((await signIn(h, p.email, p.password)).status).toBe(200)
    })

    it("e-mail que não existe é tratado igual (não revela quem tem conta)", async () => {
      const email = "ninguem@exemplo.test"
      for (let i = 0; i < 5; i++) expect((await signIn(h, email, "qualquer senha longa")).status).toBe(401)
      const res = await signIn(h, email, "qualquer senha longa")
      expect(res.status).toBe(429)
      // A tabela guarda só o hash do e-mail.
      const rows = await h.t.client.query<{ key: string }>("SELECT key FROM auth_login_throttle")
      expect(rows.rows.every((r) => /^[0-9a-f]{64}$/.test(r.key))).toBe(true)
      expect(JSON.stringify(rows.rows)).not.toContain("ninguem")
    })
  })

  describe("2FA (TOTP + 10 códigos de recuperação)", () => {
    it("ativa, pede o código no login seguinte, aceita TOTP e código de recuperação (uma vez)", async () => {
      const p = await createUserWithPassword(h)
      const first = await signIn(h, p.email, p.password)
      let cookie = cookiesFrom(first.headers)

      const enabled = await h.auth.api.enableTwoFactor({
        body: { password: p.password, method: "totp" },
        headers: browserHeaders(cookie),
      })
      if (enabled.method !== "totp") throw new Error("esperava o método totp")
      expect(enabled.backupCodes).toHaveLength(10)
      expect(enabled.totpURI).toMatch(/^otpauth:\/\/totp\//)
      // Ainda não está ligado: falta confirmar com um código do aplicativo.
      const [beforeVerify] = await h.t.db.select().from(s.user).where(eq(s.user.id, p.id))
      expect(beforeVerify?.twoFactorEnabled).toBe(false)
      const confirmed = await h.auth.api.verifyTOTP({
        body: { code: totpCode(enabled.totpURI) },
        headers: browserHeaders(cookie),
        asResponse: true,
      })
      expect(confirmed.status).toBe(200)
      cookie = cookiesFrom(confirmed.headers, cookie)
      const [afterVerify] = await h.t.db.select().from(s.user).where(eq(s.user.id, p.id))
      expect(afterVerify?.twoFactorEnabled).toBe(true)
      // Ao ativar, o Better Auth troca a sessão: a nova herda a regra das 12 h (não vira 30 dias).
      const rotated = await sessionRow(h, p.id)
      expect(rotated).toHaveLength(1)
      expect(rotated[0]?.rememberMe).toBe(false)
      expect((rotated[0]?.expiresAt.getTime() ?? 0) - Date.now()).toBeLessThan(SESSION_IDLE_MS + 60_000)
      // Segredo e códigos guardados cifrados.
      const [tf] = await h.t.db.select().from(s.twoFactor).where(eq(s.twoFactor.userId, p.id))
      expect(tf?.secret).not.toContain(new URL(enabled.totpURI).searchParams.get("secret") ?? "x")
      expect(tf?.backupCodes).not.toContain(enabled.backupCodes[0] ?? "x")

      // Novo login: senha certa NÃO abre sessão, só o desafio do 2FA.
      const second = await signIn(h, p.email, p.password)
      expect(second.status).toBe(200)
      expect(await second.json()).toMatchObject({ twoFactorRedirect: true })
      const challenge = cookiesFrom(second.headers)
      expect(challenge).not.toMatch(/session_token/)

      // "Confiar neste dispositivo" fica desligado (D14).
      const trust = await outcome(
        h.auth.api.verifyTOTP({
          body: { code: totpCode(enabled.totpURI), trustDevice: true },
          headers: browserHeaders(challenge),
          asResponse: true,
        }),
      )
      expect(trust).toMatchObject({ status: 400, code: "TRUST_DEVICE_DISABLED" })

      const wrong = await outcome(
        h.auth.api.verifyTOTP({ body: { code: "000000" }, headers: browserHeaders(challenge), asResponse: true }),
      )
      expect(wrong.status).toBe(401)
      const ok = await h.auth.api.verifyTOTP({
        body: { code: totpCode(enabled.totpURI) },
        headers: browserHeaders(challenge),
        asResponse: true,
      })
      expect(ok.status).toBe(200)
      expect(cookiesFrom(ok.headers)).toMatch(/session_token/)

      // Código de recuperação: entra uma vez; a segunda vez o mesmo código é recusado.
      const third = await signIn(h, p.email, p.password)
      const challenge2 = cookiesFrom(third.headers)
      const code = enabled.backupCodes[0] ?? ""
      const viaBackup = await h.auth.api.verifyBackupCode({ body: { code }, headers: browserHeaders(challenge2), asResponse: true })
      expect(viaBackup.status).toBe(200)
      const fourth = await signIn(h, p.email, p.password)
      const challenge3 = cookiesFrom(fourth.headers)
      const reused = await outcome(
        h.auth.api.verifyBackupCode({ body: { code }, headers: browserHeaders(challenge3), asResponse: true }),
      )
      expect(reused.status).toBe(401)
    })
  })

  describe("senha nova", () => {
    it("menos de 12 caracteres, ou vazada, é recusada; falha da consulta de vazamento não bloqueia", async () => {
      const p = await createUserWithPassword(h)
      const res = await signIn(h, p.email, p.password)
      const cookie = cookiesFrom(res.headers)
      const change = (newPassword: string) =>
        outcome(
          h.auth.api.changePassword({
            body: { currentPassword: p.password, newPassword },
            headers: browserHeaders(cookie),
            asResponse: true,
          }),
        )

      expect(await change("curta123")).toMatchObject({ status: 400, code: "PASSWORD_REJECTED" })

      h.pwnedAnswer.value = true
      expect(await change("senha vazada muito longa")).toMatchObject({ status: 400, code: "PASSWORD_REJECTED" })

      h.pwnedAnswer.value = null // rede fora: aceita
      expect((await change("frase nova bem comprida ok")).status).toBe(200)
      h.pwnedAnswer.value = false
      expect(GOOD_PASSWORD.length).toBeGreaterThanOrEqual(12)
    })
  })
})
