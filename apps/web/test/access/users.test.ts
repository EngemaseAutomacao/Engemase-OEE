/**
 * Gestão de usuários do cliente (D11, D12, D14; docs/15 seção 5) com o Better Auth de verdade no PGlite:
 * convite (pessoa achada pelo e-mail no servidor, achado W11 §3.2), "definir senha" com token de uso único,
 * reenvio e reinício do 2FA de outra pessoa. Inclui os testes de isolamento de NÍVEL 3 (docs/15 §4 item 7):
 * quem é do cliente A tentando ids do cliente B (unidade, máquina, vínculo, token).
 */
import * as s from "@engemase/db"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import { setPasswordWithToken } from "@/lib/server/auth/set-password"
import { attemptKey, takeAttempt } from "@/lib/server/auth/attempts"
import { LOGIN_MAX_FAILURES, recordLoginFailure, throttleKey } from "@/lib/server/auth/throttle"
import type { EmailMessage } from "@/lib/server/email"
import { inviteMember, resendInvite, type UsersDeps } from "@/lib/server/users/invite"
import { resetMemberTwoFactor } from "@/lib/server/users/two-factor-reset"
import { type AuthHarness, BASE_URL, browserHeaders, createAuthHarness, createUserWithPassword, GOOD_PASSWORD } from "../auth/support"
import { createPerson, type SeededClient, type SeededPerson, seedClient } from "./support"

// Relógio no minuto atual: o banco confere a validade dos códigos com a hora real (`now()` em `app.resolve_account_token`).
const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000)
const NEW_PASSWORD = "lanterna violeta café trovão"

/** Token do link "definir senha" de um e-mail capturado. */
function tokenFrom(mail: EmailMessage | undefined): string {
  const match = /\/definir-senha#t=([A-Za-z0-9_-]{43})/.exec(mail?.text ?? "")
  if (match?.[1] === undefined) throw new Error(`e-mail sem link: ${mail?.text}`)
  return match[1]
}

describe("usuários do cliente: convite, definir senha, reenvio e 2FA", () => {
  let h: AuthHarness
  let a: SeededClient
  let b: SeededClient
  let superAdmin: SeededPerson
  let support: SeededPerson
  const mails: EmailMessage[] = []
  let clock = NOW

  const deps = (): UsersDeps => ({
    db: h.t.db,
    authDb: h.t.db,
    now: clock,
    baseURL: BASE_URL,
    sendEmail: async (m) => {
      mails.push(m)
      return { status: "logged" }
    },
  })

  async function ctxOf(slug: string, person: SeededPerson): Promise<TenantContext> {
    const decision = await loadTenantContext(h.t.db, { slug, user: person.user, sessionId: person.sessionId, now: clock })
    if (!decision.ok) throw new Error(`sem acesso: ${decision.reason}`)
    return decision.context
  }

  beforeAll(async () => {
    h = await createAuthHarness({ now: () => clock })
    a = await seedClient(h.t.db, "alfa")
    b = await seedClient(h.t.db, "beta")
    superAdmin = await createPerson(h.t.db, "super", { role: "super_admin", twoFactor: true })
    support = await createPerson(h.t.db, "suporte", { role: "technician", twoFactor: true })
    await h.t.db.insert(s.supportAccessGrant).values({
      organizationId: a.organizationId,
      userId: support.user.id,
      reason: "Chamado",
      ticket: "#1",
      startsAt: new Date(NOW.getTime() - 3_600_000),
      endsAt: new Date(NOW.getTime() + 3_600_000),
    })
  })

  afterAll(async () => {
    await h.t.client.close()
  })

  describe("convite", () => {
    it("conta nova: cria a pessoa sem senha, vínculo + papel + escopo + token numa transação, audita e manda o link", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const result = await inviteMember(deps(), ctx, {
        email: "  Nova.Pessoa@Exemplo.test ",
        name: "Nova Pessoa",
        role: "supervisor",
        scope: "units",
        unitIds: [a.unit1],
      })
      expect(result).toMatchObject({ status: "ok", kind: "set_password", emailSent: true })
      const [person] = await h.t.db.select().from(s.user).where(eq(s.user.email, "nova.pessoa@exemplo.test"))
      expect(person).toMatchObject({ name: "Nova Pessoa", emailVerified: false, role: null })
      expect(await h.t.db.select().from(s.account).where(eq(s.account.userId, person?.id ?? ""))).toEqual([])

      const [access] = await h.t.db
        .select({ role: s.memberAccess.role, scope: s.memberAccess.scope, createdBy: s.memberAccess.createdBy })
        .from(s.memberAccess)
        .innerJoin(s.member, eq(s.member.id, s.memberAccess.memberId))
        .where(eq(s.member.userId, person?.id ?? ""))
      expect(access).toEqual({ role: "supervisor", scope: "units", createdBy: a.admin.user.id })

      const mail = mails.at(-1)
      expect(mail?.to).toBe("nova.pessoa@exemplo.test")
      expect(mail?.subject).toContain("Cliente alfa")
      // Só o hash no banco; o link leva o token no fragmento, no endereço canônico.
      const token = tokenFrom(mail)
      expect(mail?.text).toContain(`${BASE_URL}/definir-senha#t=`)
      const [row] = await h.t.db.select().from(s.accountToken).where(eq(s.accountToken.tokenHash, s.sha256Hex(token)))
      expect(row).toMatchObject({ organizationId: a.organizationId, purpose: "set_password", usedAt: null })
      expect(row?.expiresAt.getTime()).toBe(NOW.getTime() + s.SET_PASSWORD_TOKEN_TTL_MS)

      const [audit] = await h.t.db
        .select()
        .from(s.auditLog)
        .where(and(eq(s.auditLog.action, "user.invite"), eq(s.auditLog.organizationId, a.organizationId)))
      expect(audit).toMatchObject({ actorType: "user", actorId: a.admin.user.id })
      expect(JSON.stringify(audit?.after)).not.toContain(token)
    })

    it("pessoa que já tem senha (de outro cliente) ganha o acesso, sem link, e o e-mail não revela o outro cliente", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const existing = await createUserWithPassword(h)
      const result = await inviteMember(deps(), ctx, { email: existing.email, name: "Ignorado", role: "viewer", scope: "all" })
      expect(result).toMatchObject({ status: "ok", kind: "access_granted" })
      const mail = mails.at(-1)
      expect(mail?.text).not.toContain("definir-senha")
      expect(mail?.text).not.toContain("beta")
    })

    it("a mesma pessoa duas vezes no mesmo cliente: conflito", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const result = await inviteMember(deps(), ctx, { email: a.viewerAll.user.email, name: "Pessoa X", role: "viewer", scope: "all" })
      expect(result).toMatchObject({ status: "error", code: "conflict" })
    })

    it("valida a entrada: admin só com o cliente inteiro, escopo sem lista, e-mail inválido", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const cases = [
        { email: "x@exemplo.test", name: "Pessoa X", role: "client_admin", scope: "units", unitIds: [a.unit1] },
        { email: "x@exemplo.test", name: "Pessoa X", role: "viewer", scope: "units", unitIds: [] },
        { email: "x@exemplo.test", name: "Pessoa X", role: "viewer", scope: "machines" },
        { email: "sem-arroba", name: "Pessoa X", role: "viewer", scope: "all" },
        { email: "x@exemplo.test", name: "Pessoa X", role: "dono", scope: "all" },
        { email: "x@exemplo.test", name: "Pessoa X", role: "viewer", scope: "all", userId: b.admin.user.id },
      ]
      for (const input of cases.slice(0, 5)) {
        expect(await inviteMember(deps(), ctx, input)).toMatchObject({ status: "error", code: "invalid" })
      }
      // `userId` vindo do navegador é ignorado: a pessoa é achada (ou criada) pelo e-mail digitado.
      const ok = await inviteMember(deps(), ctx, cases[5])
      expect(ok).toMatchObject({ status: "ok" })
      const [created] = await h.t.db.select({ id: s.user.id }).from(s.user).where(eq(s.user.email, "x@exemplo.test"))
      expect(created?.id).not.toBe(b.admin.user.id)
    })

    it("NÍVEL 3: unidade ou máquina do cliente B (ou excluída) no escopo de A é recusada, sem gravar nada", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const before = await h.t.db.select({ id: s.member.id }).from(s.member)
      for (const input of [
        { scope: "units", unitIds: [b.unit1] },
        { scope: "units", unitIds: [a.unit1, b.unit2] },
        { scope: "machines", machineIds: [b.m1] },
        { scope: "machines", machineIds: [a.mDeleted] },
      ]) {
        const result = await inviteMember(deps(), ctx, { email: "escopo@exemplo.test", name: "Escopo", role: "operator", ...input })
        expect(result).toMatchObject({ status: "error", code: "invalid" })
      }
      expect(await h.t.db.select({ id: s.member.id }).from(s.member)).toHaveLength(before.length)
    })

    it("quem não gerencia usuários (supervisor, suporte, engenheiro) não convida", async () => {
      for (const person of [a.supervisorUnit1, a.viewerAll]) {
        const ctx = await ctxOf(a.slug, person)
        await expect(inviteMember(deps(), ctx, { email: "z@exemplo.test", name: "Pessoa Z", role: "viewer", scope: "all" })).rejects.toBeInstanceOf(
          AccessDeniedError,
        )
      }
      const supportCtx = await ctxOf(a.slug, support)
      await expect(
        inviteMember(deps(), supportCtx, { email: "z@exemplo.test", name: "Pessoa Z", role: "viewer", scope: "all" }),
      ).rejects.toBeInstanceOf(AccessDeniedError)
    })

    it("pessoa da equipe Engemase não vira membro de cliente", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const result = await inviteMember(deps(), ctx, { email: support.user.email, name: "Pessoa S", role: "viewer", scope: "all" })
      expect(result).toMatchObject({ status: "error", code: "refused" })
    })

    it("super admin convida (primeiro admin do cliente) e aparece como Engemase na auditoria", async () => {
      const ctx = await ctxOf(b.slug, superAdmin)
      const result = await inviteMember(deps(), ctx, { email: "admin2@beta.test", name: "Admin 2", role: "client_admin", scope: "all" })
      expect(result).toMatchObject({ status: "ok", kind: "set_password" })
      const [audit] = await h.t.db
        .select({ actorType: s.auditLog.actorType, actorLabel: s.auditLog.actorLabel })
        .from(s.auditLog)
        .where(and(eq(s.auditLog.action, "user.invite"), eq(s.auditLog.organizationId, b.organizationId)))
      expect(audit?.actorType).toBe("engemase")
      expect(audit?.actorLabel).toContain("Engemase")
    })

    it("respeita limits.users do contrato", async () => {
      const limited = await seedClient(h.t.db, "limitado")
      await h.t.db
        .update(s.clientAccount)
        .set({ limits: { machines: 10, users: 1 } })
        .where(eq(s.clientAccount.organizationId, limited.organizationId))
      const ctx = await ctxOf(limited.slug, limited.admin)
      const result = await inviteMember(deps(), ctx, { email: "mais1@exemplo.test", name: "Mais", role: "viewer", scope: "all" })
      expect(result).toMatchObject({ status: "error", code: "limit" })
    })
  })

  describe("definir senha (token de uso único)", () => {
    async function invite(email: string): Promise<string> {
      const ctx = await ctxOf(a.slug, a.admin)
      const result = await inviteMember(deps(), ctx, { email, name: "Convidado", role: "viewer", scope: "all" })
      expect(result).toMatchObject({ status: "ok", kind: "set_password" })
      return tokenFrom(mails.at(-1))
    }
    const setPassword = (token: string, password = NEW_PASSWORD) =>
      setPasswordWithToken({ db: h.t.db, authDb: h.t.db, auth: h.auth, now: clock, pwned: async () => false }, { token, password })

    it("grava a senha, confirma o e-mail, audita e o login passa a funcionar; o mesmo link não serve de novo", async () => {
      const token = await invite("convidado1@exemplo.test")
      expect(await setPassword(token)).toEqual({ status: "ok", email: "convidado1@exemplo.test" })
      const [person] = await h.t.db.select().from(s.user).where(eq(s.user.email, "convidado1@exemplo.test"))
      expect(person?.emailVerified).toBe(true)
      const signed = await h.auth.api.signInEmail({ body: { email: "convidado1@exemplo.test", password: NEW_PASSWORD }, headers: browserHeaders() })
      expect("user" in signed && signed.user.id).toBe(person?.id)
      expect(await setPassword(token, "outra frase longa qualquer")).toEqual({ status: "invalid_token" })
      const audits = await h.t.db.select().from(s.auditLog).where(eq(s.auditLog.action, "user.password_set"))
      expect(audits.some((r) => r.actorId === person?.id && r.organizationId === a.organizationId)).toBe(true)
    })

    it("senha fraca não gasta o token", async () => {
      const token = await invite("convidado2@exemplo.test")
      expect(await setPassword(token, "curta")).toMatchObject({ status: "password_rejected" })
      expect(await setPassword(token)).toMatchObject({ status: "ok" })
    })

    it("token vencido, inventado, malformado ou substituído pelo reenvio: inválido", async () => {
      const token = await invite("convidado3@exemplo.test")
      clock = new Date(NOW.getTime() + s.SET_PASSWORD_TOKEN_TTL_MS + 1000)
      try {
        // Venceu (o banco confere `expires_at` contra o relógio do banco também: resolve_account_token usa now()).
        await h.t.db.update(s.accountToken).set({ expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 2000) }).where(eq(s.accountToken.tokenHash, s.sha256Hex(token)))
        expect(await setPassword(token)).toEqual({ status: "invalid_token" })
      } finally {
        clock = NOW
      }
      expect(await setPassword(s.newAccountToken().token)).toEqual({ status: "invalid_token" })
      expect(await setPassword("abc")).toEqual({ status: "invalid_token" })

      const first = await invite("convidado4@exemplo.test")
      const [mem] = await h.t.db
        .select({ id: s.member.id })
        .from(s.member)
        .innerJoin(s.user, eq(s.user.id, s.member.userId))
        .where(and(eq(s.user.email, "convidado4@exemplo.test"), eq(s.member.organizationId, a.organizationId)))
      const resent = await resendInvite(deps(), await ctxOf(a.slug, a.admin), mem?.id ?? "")
      expect(resent).toMatchObject({ status: "ok" })
      const second = tokenFrom(mails.at(-1))
      expect(second).not.toBe(first)
      expect(await setPassword(first)).toEqual({ status: "invalid_token" })
      expect(await setPassword(second)).toMatchObject({ status: "ok" })
      // Depois da senha criada, o reenvio é recusado.
      expect(await resendInvite(deps(), await ctxOf(a.slug, a.admin), mem?.id ?? "")).toMatchObject({ code: "has_password" })
    })

    it("dois envios ao mesmo tempo: só um grava", async () => {
      const token = await invite("convidado5@exemplo.test")
      const results = await Promise.all([setPassword(token), setPassword(token, "segunda frase bem comprida")])
      expect(results.filter((r) => r.status === "ok")).toHaveLength(1)
    })

    it("zera o bloqueio por senhas erradas", async () => {
      const token = await invite("convidado6@exemplo.test")
      for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await recordLoginFailure(h.t.db, throttleKey("convidado6@exemplo.test"), new Date())
      expect(await setPassword(token)).toMatchObject({ status: "ok" })
      const rows = await h.t.db.select().from(s.authLoginThrottle).where(eq(s.authLoginThrottle.key, throttleKey("convidado6@exemplo.test")))
      expect(rows).toEqual([])
    })

    it("NÍVEL 3: reenvio com o vínculo de B, pelo admin de A, não acha nada", async () => {
      const [memB] = await h.t.db.select({ id: s.member.id }).from(s.member).where(eq(s.member.userId, b.viewerAll.user.id))
      expect(await resendInvite(deps(), await ctxOf(a.slug, a.admin), memB?.id ?? "")).toMatchObject({ code: "not_found" })
    })
  })

  describe("reiniciar o 2FA de outra pessoa", () => {
    async function memberIdOf(client: SeededClient, person: SeededPerson): Promise<string> {
      const [row] = await h.t.db
        .select({ id: s.member.id })
        .from(s.member)
        .where(and(eq(s.member.userId, person.user.id), eq(s.member.organizationId, client.organizationId)))
      if (row === undefined) throw new Error("sem vínculo")
      return row.id
    }

    async function withTwoFactor(person: SeededPerson): Promise<void> {
      await h.t.db.update(s.user).set({ twoFactorEnabled: true }).where(eq(s.user.id, person.user.id))
      await h.t.db.insert(s.twoFactor).values({ userId: person.user.id, secret: "cifrado", backupCodes: "cifrado" })
    }

    it("admin do cliente reinicia o de um supervisor: segredo, códigos e sessões apagados, auditado e avisado", async () => {
      await withTwoFactor(a.supervisorUnit1)
      const result = await resetMemberTwoFactor(deps(), await ctxOf(a.slug, a.admin), await memberIdOf(a, a.supervisorUnit1))
      expect(result).toMatchObject({ status: "ok" })
      const [person] = await h.t.db.select().from(s.user).where(eq(s.user.id, a.supervisorUnit1.user.id))
      expect(person?.twoFactorEnabled).toBe(false)
      expect(await h.t.db.select().from(s.twoFactor).where(eq(s.twoFactor.userId, a.supervisorUnit1.user.id))).toEqual([])
      expect(await h.t.db.select().from(s.session).where(eq(s.session.userId, a.supervisorUnit1.user.id))).toEqual([])
      const audits = await h.t.db
        .select()
        .from(s.auditLog)
        .where(and(eq(s.auditLog.action, "user.two_factor_reset"), eq(s.auditLog.organizationId, a.organizationId)))
      expect(audits).toHaveLength(1)
      expect(mails.at(-1)?.to).toBe(a.supervisorUnit1.user.email)
    })

    it("admin do cliente NÃO reinicia: outro admin, a si mesmo, pessoa com vínculo em outro cliente", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      await withTwoFactor(a.adminNo2fa)
      expect(await resetMemberTwoFactor(deps(), ctx, await memberIdOf(a, a.adminNo2fa))).toMatchObject({ code: "refused" })
      expect(await resetMemberTwoFactor(deps(), ctx, await memberIdOf(a, a.admin))).toMatchObject({ code: "self" })

      // Consultor nos dois clientes: o reinício valeria em B também.
      const consultant = await createPerson(h.t.db, "consultor", { twoFactor: true })
      for (const client of [a, b]) {
        const [mem] = await h.t.db.insert(s.member).values({ organizationId: client.organizationId, userId: consultant.user.id }).returning()
        await h.t.db.insert(s.memberAccess).values({ organizationId: client.organizationId, memberId: mem?.id ?? "", role: "viewer", scope: "all" })
      }
      const refused = await resetMemberTwoFactor(deps(), ctx, await memberIdOf(a, consultant))
      // Mesma mensagem do "outro admin": não revela que a pessoa tem outro vínculo.
      expect(refused).toMatchObject({ code: "refused", message: expect.stringContaining("suporte Engemase") })
      const [person] = await h.t.db.select().from(s.user).where(eq(s.user.id, consultant.user.id))
      expect(person?.twoFactorEnabled).toBe(true)

      // O super admin pode (D14: ele é o "suporte" que reinicia o de admins e de quem tem vários clientes).
      const bySuper = await resetMemberTwoFactor(deps(), await ctxOf(a.slug, superAdmin), await memberIdOf(a, a.adminNo2fa))
      expect(bySuper).toMatchObject({ status: "ok" })
    })

    it("suporte (com concessão), supervisor e visualizador não reiniciam", async () => {
      await withTwoFactor(a.operatorM3)
      const target = await memberIdOf(a, a.operatorM3)
      expect(await resetMemberTwoFactor(deps(), await ctxOf(a.slug, support), target).catch((e: unknown) => e)).toBeInstanceOf(
        AccessDeniedError,
      )
      for (const person of [a.supervisorUnit1, a.viewerAll]) {
        await expect(resetMemberTwoFactor(deps(), await ctxOf(a.slug, person), target)).rejects.toBeInstanceOf(AccessDeniedError)
      }
    })

    it("NÍVEL 3: admin de A com o vínculo de uma pessoa de B: não encontrado, nada muda em B", async () => {
      await withTwoFactor(b.supervisorUnit1)
      const result = await resetMemberTwoFactor(deps(), await ctxOf(a.slug, a.admin), await memberIdOf(b, b.supervisorUnit1))
      expect(result).toMatchObject({ code: "not_found" })
      const [person] = await h.t.db.select().from(s.user).where(eq(s.user.id, b.supervisorUnit1.user.id))
      expect(person?.twoFactorEnabled).toBe(true)
      expect(await resetMemberTwoFactor(deps(), await ctxOf(a.slug, a.admin), "nao-e-uuid")).toMatchObject({ code: "not_found" })
    })
  })

  describe("limite de tentativas (attempts.ts)", () => {
    it("janela fixa: max passa, a seguinte é recusada até a janela acabar", async () => {
      const key = attemptKey("reset-email", "limite@exemplo.test")
      const limit = { max: 2, windowMs: 60_000 }
      const t0 = new Date("2026-11-24T10:00:00Z")
      expect((await takeAttempt(h.t.db, key, limit, t0)).allowed).toBe(true)
      expect((await takeAttempt(h.t.db, key, limit, t0)).allowed).toBe(true)
      const third = await takeAttempt(h.t.db, key, limit, new Date(t0.getTime() + 1000))
      expect(third).toEqual({ allowed: false, retryAt: new Date(t0.getTime() + 60_000) })
      expect((await takeAttempt(h.t.db, key, limit, new Date(t0.getTime() + 60_000))).allowed).toBe(true)
      // A chave do limite não é a do login (e não guarda o e-mail).
      expect(key).not.toBe(throttleKey("limite@exemplo.test"))
      expect(key).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  it("senha de quem já existe continua valendo depois do convite (nada é sobrescrito)", async () => {
    const existing = await createUserWithPassword(h)
    await inviteMember(deps(), await ctxOf(b.slug, b.admin), { email: existing.email, name: "Pessoa X", role: "viewer", scope: "all" })
    const signed = await h.auth.api.signInEmail({ body: { email: existing.email, password: GOOD_PASSWORD }, headers: browserHeaders() })
    expect("user" in signed).toBe(true)
  })
})
