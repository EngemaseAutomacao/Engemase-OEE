/**
 * "Esqueci minha senha" com o Better Auth de verdade no PGlite (docs/15, itens 2, 9 e 15): resposta igual
 * para e-mail que existe e que não existe, limite por e-mail e por IP, link com o token no fragmento, token
 * guardado como hash, uso único, sessões e bloqueio derrubados. Também o aviso de conta bloqueada (L20) e
 * o envio de e-mail (Resend ou log).
 */
import * as s from "@engemase/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { ResetPasswordMail } from "@/lib/server/auth/auth"
import { RESET_REQUEST_PER_EMAIL, RESET_REQUEST_PER_IP } from "@/lib/server/auth/attempts"
import { lockNotifier } from "@/lib/server/auth/lock-notice"
import { requestPasswordReset, resetPassword } from "@/lib/server/auth/password-reset"
import { LOGIN_MAX_FAILURES, throttleKey } from "@/lib/server/auth/throttle"
import { createEmailSender, type EmailMessage, maskEmail } from "@/lib/server/email"
import { type AuthHarness, BASE_URL, browserHeaders, createAuthHarness, createUserWithPassword } from "./support"

const NEW_PASSWORD = "girassol bússola chuva pandeiro"

function tokenFrom(mail: ResetPasswordMail | undefined): string {
  const match = /\/redefinir-senha#t=([A-Za-z0-9]{24})$/.exec(mail?.url ?? "")
  if (match?.[1] === undefined) throw new Error(`link inesperado: ${mail?.url}`)
  return match[1]
}

describe("redefinição de senha", () => {
  let h: AuthHarness
  const sent: ResetPasswordMail[] = []
  let ipSeq = 0
  const deps = (ip?: string) => ({ auth: h.auth, authDb: h.t.db, now: h.clock.now, ip: ip ?? `10.1.0.${++ipSeq}` })

  beforeAll(async () => {
    h = await createAuthHarness({ sendResetPassword: (mail) => void sent.push(mail) })
  })

  afterAll(async () => {
    await h.t.client.close()
  })

  it("conta que existe: link no endereço canônico, token no fragmento e só o hash no banco", async () => {
    const p = await createUserWithPassword(h)
    expect(await requestPasswordReset(deps(), p.email.toUpperCase())).toEqual({ status: "ok" })
    const mail = sent.at(-1)
    expect(mail?.user.email).toBe(p.email)
    expect(mail?.url.startsWith(`${BASE_URL}/redefinir-senha#t=`)).toBe(true)
    expect(mail?.expiresInMs).toBe(30 * 60_000)
    const token = tokenFrom(mail)
    const rows = await h.t.db.select({ identifier: s.verification.identifier }).from(s.verification)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.identifier.includes(token))).toBe(false)
  })

  it("e-mail que não existe: mesma resposta e nenhum envio", async () => {
    const before = sent.length
    expect(await requestPasswordReset(deps(), "ninguem@exemplo.test")).toEqual({ status: "ok" })
    expect(sent.length).toBe(before)
  })

  it("pessoa bloqueada (banned) não recebe link", async () => {
    const p = await createUserWithPassword(h, { banned: true })
    const before = sent.length
    expect(await requestPasswordReset(deps(), p.email)).toEqual({ status: "ok" })
    expect(sent.length).toBe(before)
  })

  it("limite por e-mail (3/h), exista a conta ou não, e por IP (10/h)", async () => {
    for (const email of ["limite@exemplo.test", (await createUserWithPassword(h)).email]) {
      for (let i = 0; i < RESET_REQUEST_PER_EMAIL.max; i++) expect((await requestPasswordReset(deps(), email)).status).toBe("ok")
      const blocked = await requestPasswordReset(deps(), email)
      expect(blocked.status).toBe("throttled")
    }
    const ip = "10.9.9.9"
    for (let i = 0; i < RESET_REQUEST_PER_IP.max; i++) expect((await requestPasswordReset(deps(ip), `ip${i}@exemplo.test`)).status).toBe("ok")
    expect((await requestPasswordReset(deps(ip), "outro@exemplo.test")).status).toBe("throttled")
  })

  it("redefine: senha nova entra, a antiga não, sessões e bloqueio derrubados, link de uso único", async () => {
    const p = await createUserWithPassword(h)
    await h.auth.api.signInEmail({ body: { email: p.email, password: p.password }, headers: browserHeaders() })
    await h.t.db.insert(s.authLoginThrottle).values({
      key: throttleKey(p.email),
      failures: LOGIN_MAX_FAILURES,
      windowStartedAt: new Date(),
      lockedUntil: new Date(Date.now() + 600_000),
    })
    await requestPasswordReset(deps(), p.email)
    const token = tokenFrom(sent.at(-1))

    expect(await resetPassword(deps(), { token, password: "curta" })).toMatchObject({ status: "password_rejected" })
    h.pwnedAnswer.value = true
    expect(await resetPassword(deps(), { token, password: NEW_PASSWORD })).toMatchObject({
      status: "password_rejected",
      message: expect.stringContaining("vazamentos"),
    })
    h.pwnedAnswer.value = false
    expect(await resetPassword(deps(), { token, password: NEW_PASSWORD })).toEqual({ status: "ok" })
    expect(await h.t.db.select().from(s.session).where(eq(s.session.userId, p.id))).toEqual([])
    expect(await h.t.db.select().from(s.authLoginThrottle).where(eq(s.authLoginThrottle.key, throttleKey(p.email)))).toEqual([])

    const signed = await h.auth.api.signInEmail({ body: { email: p.email, password: NEW_PASSWORD }, headers: browserHeaders() })
    expect("user" in signed).toBe(true)
    await expect(h.auth.api.signInEmail({ body: { email: p.email, password: p.password }, headers: browserHeaders() })).rejects.toThrow()
    expect(await resetPassword(deps(), { token, password: "mais uma frase bem longa" })).toEqual({ status: "invalid_token" })
  })

  it("token inventado ou malformado: inválido; muitos envios do mesmo IP: limite", async () => {
    expect(await resetPassword(deps(), { token: "a".repeat(24), password: NEW_PASSWORD })).toEqual({ status: "invalid_token" })
    expect(await resetPassword(deps(), { token: "../../x", password: NEW_PASSWORD })).toEqual({ status: "invalid_token" })
    const ip = "10.8.8.8"
    let last: string = ""
    for (let i = 0; i < 21; i++) last = (await resetPassword(deps(ip), { token: "b".repeat(24), password: NEW_PASSWORD })).status
    expect(last).toBe("throttled")
  })
})

describe("aviso de conta bloqueada (L20)", () => {
  let h: AuthHarness

  beforeAll(async () => {
    h = await createAuthHarness()
  })

  afterAll(async () => {
    await h.t.client.close()
  })

  it("avisa a dona da conta que existe; e-mail inexistente ou pessoa banida: nenhum envio", async () => {
    const mails: EmailMessage[] = []
    const tasks: (() => Promise<unknown>)[] = []
    const notify = lockNotifier(h.t.db, BASE_URL, (task) => void tasks.push(task), () => async (m) => {
      mails.push(m)
      return { status: "logged" }
    })
    const p = await createUserWithPassword(h)
    const banned = await createUserWithPassword(h, { banned: true })
    const until = new Date("2026-11-24T18:15:00Z")
    await notify({ key: throttleKey(p.email), email: p.email.toUpperCase(), until })
    await notify({ key: throttleKey("x@x.test"), email: "ninguem@exemplo.test", until })
    await notify({ key: throttleKey(banned.email), email: banned.email, until })
    // O envio fica para depois da resposta (after); aqui roda na mão.
    expect(tasks).toHaveLength(1)
    await Promise.all(tasks.map((t) => t()))
    expect(mails).toHaveLength(1)
    expect(mails[0]?.to).toBe(p.email)
    expect(mails[0]?.text).toContain("15:15")
    expect(mails[0]?.text).toContain(`${BASE_URL}/login`)
  })

  it("o 5º erro de senha dispara o aviso pelo Better Auth", async () => {
    const notices: string[] = []
    const h2 = await createAuthHarness({ onLock: (n) => void notices.push(n.email) })
    try {
      const p = await createUserWithPassword(h2)
      for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
        await h2.auth.api.signInEmail({ body: { email: p.email, password: "senha errada demais" }, headers: browserHeaders() }).catch(() => undefined)
      }
      expect(notices).toEqual([p.email])
    } finally {
      await h2.t.client.close()
    }
  })
})

describe("envio de e-mail", () => {
  const message: EmailMessage = { to: "ana@cliente.example", subject: "Assunto", text: "link secreto", html: "<p>x</p>" }

  it("sem provedor: registra só destinatário mascarado e assunto em produção; o texto só fora de produção", async () => {
    const lines: string[] = []
    const prod = createEmailSender({ env: { NODE_ENV: "production" }, log: (l) => void lines.push(l) })
    expect(await prod(message)).toEqual({ status: "logged" })
    expect(lines.join("\n")).toContain("a***@cliente.example")
    expect(lines.join("\n")).not.toContain("link secreto")
    expect(lines.join("\n")).not.toContain("ana@")

    const devLines: string[] = []
    await createEmailSender({ env: { NODE_ENV: "development" }, log: (l) => void devLines.push(l) })(message)
    expect(devLines.join("\n")).toContain("link secreto")
    expect(maskEmail("bruno@x.example")).toBe("b***@x.example")
  })

  it("com RESEND_API_KEY e EMAIL_FROM: manda pela API do Resend; falha vira resultado (sem lançar)", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    let status = 200
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return status === 200 ? Response.json({ id: "email-1" }) : new Response("erro com ana@cliente.example", { status })
    }) as unknown as typeof fetch
    const send = createEmailSender({ env: { RESEND_API_KEY: "re_teste", EMAIL_FROM: "OEE <oee@exemplo.com>" }, fetch: fakeFetch })
    expect(await send({ ...message, idempotencyKey: "k1" })).toEqual({ status: "sent", provider: "resend", id: "email-1" })
    expect(calls[0]?.url).toBe("https://api.resend.com/emails")
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer re_teste")
    expect(headers["Idempotency-Key"]).toBe("k1")
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ from: "OEE <oee@exemplo.com>", to: ["ana@cliente.example"] })
    status = 500
    const failed = await send(message)
    expect(failed).toEqual({ status: "failed", error: "Resend respondeu 500" })
  })
})
