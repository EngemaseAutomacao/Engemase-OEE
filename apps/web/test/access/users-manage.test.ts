/**
 * Tela "Usuários" do cliente com banco (D11, D12): lista real, troca de papel e escopo, desativar e reativar.
 * Inclui isolamento de NÍVEL 3 (docs/15 §4 item 7): ids de outro cliente não existem aqui.
 */
import * as s from "@engemase/db"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import type { UsersDeps } from "@/lib/server/users/invite"
import { activeClients, landingPath } from "@/lib/server/auth/landing"
import { listClientUsers } from "@/lib/server/users/list"
import { changeMemberAccess, requestMemberPasswordReset, setMemberActive } from "@/lib/server/users/manage"
import { type AuthHarness, BASE_URL, createAuthHarness } from "../auth/support"
import { createPerson, type SeededClient, type SeededPerson, seedClient } from "./support"

const NOW = new Date("2026-11-27T15:00:00Z")

describe("usuários do cliente: lista, alterar acesso, desativar e reativar", () => {
  let h: AuthHarness
  let a: SeededClient
  let b: SeededClient
  let superAdmin: SeededPerson

  const deps = (): UsersDeps => ({ db: h.t.db, authDb: h.t.db, now: NOW, baseURL: BASE_URL, sendEmail: async () => ({ status: "logged" }) })

  async function ctxOf(slug: string, person: SeededPerson): Promise<TenantContext> {
    const decision = await loadTenantContext(h.t.db, { slug, user: person.user, sessionId: person.sessionId, now: NOW })
    if (!decision.ok) throw new Error(`sem acesso: ${decision.reason}`)
    return decision.context
  }

  async function memberIdOf(client: SeededClient, person: SeededPerson): Promise<string> {
    const [row] = await h.t.db
      .select({ id: s.member.id })
      .from(s.member)
      .where(and(eq(s.member.organizationId, client.organizationId), eq(s.member.userId, person.user.id)))
    if (row === undefined) throw new Error("vínculo não encontrado")
    return row.id
  }

  /** Senha criada (conta `credential`): conta como admin que consegue entrar. */
  async function givePassword(person: SeededPerson): Promise<void> {
    await h.t.db.insert(s.account).values({ userId: person.user.id, accountId: person.user.id, providerId: "credential", password: "hash-de-teste" })
  }

  async function accessOf(memberId: string) {
    const [row] = await h.t.db.select().from(s.memberAccess).where(eq(s.memberAccess.memberId, memberId))
    return row
  }

  beforeAll(async () => {
    h = await createAuthHarness({ now: () => NOW })
    a = await seedClient(h.t.db, "alfa-gestao")
    b = await seedClient(h.t.db, "beta-gestao")
    superAdmin = await createPerson(h.t.db, "super-gestao", { role: "super_admin", twoFactor: true })
    for (const p of [a.admin, a.adminNo2fa, a.supervisorUnit1]) await givePassword(p)
  }, 60_000)

  afterAll(async () => {
    await h.t.client.close()
  })

  describe("lista", () => {
    it("só as pessoas deste cliente, com papel, escopo, situação e quem está vendo", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const data = await listClientUsers(h.t.db, h.t.db, ctx)
      const ids = new Set(data.users.map((u) => u.userId))
      expect(ids.has(a.admin.user.id)).toBe(true)
      expect(ids.has(b.admin.user.id)).toBe(false)
      // Vínculo sem papel (fail-closed) não aparece como usuário.
      expect(ids.has(a.memberWithoutAccess.user.id)).toBe(false)

      const me = data.users.find((u) => u.userId === a.admin.user.id)
      expect(me).toMatchObject({ role: "client_admin", scope: { kind: "all" }, isSelf: true, twoFactor: true })
      expect(data.users.find((u) => u.userId === a.inactiveEngineer.user.id)?.status).toBe("disabled")
      expect(data.users.find((u) => u.userId === a.supervisorUnit1.user.id)?.scope).toEqual({ kind: "units", unitIds: [a.unit1] })
      expect(data.users.find((u) => u.userId === a.operatorM3.user.id)?.scope).toEqual({ kind: "machines", machineIds: [a.m3] })
      // Unidades e máquinas oferecidas: só as deste cliente, sem as excluídas.
      expect(data.units.map((u) => u.id).sort()).toEqual([a.unit1, a.unit2].sort())
      expect(data.machines.map((m) => m.id)).not.toContain(a.mDeleted)
    })
  })

  describe("alterar papel e escopo", () => {
    it("troca papel e unidades, substitui o escopo antigo e audita antes e depois", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const memberId = await memberIdOf(a, a.supervisorUnit1)
      const r = await changeMemberAccess(deps(), ctx, { memberId, role: "engineer", scope: "units", unitIds: [a.unit2] })
      expect(r).toEqual({ status: "ok" })
      const access = await accessOf(memberId)
      expect(access).toMatchObject({ role: "engineer", scope: "units" })
      const units = await h.t.db.select({ id: s.memberUnit.unitId }).from(s.memberUnit).where(eq(s.memberUnit.memberAccessId, access?.id ?? ""))
      expect(units.map((u) => u.id)).toEqual([a.unit2])

      const [audit] = await h.t.db
        .select()
        .from(s.auditLog)
        .where(and(eq(s.auditLog.action, "user.access_change"), eq(s.auditLog.entityId, memberId)))
      expect(audit).toMatchObject({ actorId: a.admin.user.id })
      expect(audit?.before).toMatchObject({ role: "supervisor", scope: "units", unit_ids: [a.unit1] })
      expect(audit?.after).toMatchObject({ role: "engineer", scope: "units", unit_ids: [a.unit2] })

      // A pessoa passa a ver só a unidade 2 já na próxima requisição.
      const supervisorCtx = await ctxOf(a.slug, a.supervisorUnit1)
      expect(supervisorCtx.access).toMatchObject({ kind: "member", role: "engineer" })
    })

    it("nível 3: vínculo, unidade ou máquina de outro cliente não existem aqui", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const otherMember = await memberIdOf(b, b.viewerAll)
      expect(await changeMemberAccess(deps(), ctx, { memberId: otherMember, role: "viewer", scope: "all" })).toMatchObject({ code: "not_found" })
      expect((await accessOf(otherMember))?.role).toBe("viewer")

      const mine = await memberIdOf(a, a.viewerAll)
      expect(await changeMemberAccess(deps(), ctx, { memberId: mine, role: "viewer", scope: "units", unitIds: [b.unit1] })).toMatchObject({ code: "invalid" })
      expect(await changeMemberAccess(deps(), ctx, { memberId: mine, role: "viewer", scope: "machines", machineIds: [b.m1] })).toMatchObject({ code: "invalid" })
      expect(await changeMemberAccess(deps(), ctx, { memberId: mine, role: "viewer", scope: "machines", machineIds: [a.mDeleted] })).toMatchObject({ code: "invalid" })
      expect((await accessOf(mine))?.scope).toBe("all")
    })

    it("entrada inválida: admin só com o cliente inteiro, escopo sem unidade, papel desconhecido", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const mine = await memberIdOf(a, a.viewerAll)
      expect(await changeMemberAccess(deps(), ctx, { memberId: mine, role: "client_admin", scope: "units", unitIds: [a.unit1] })).toMatchObject({ code: "invalid" })
      expect(await changeMemberAccess(deps(), ctx, { memberId: mine, role: "viewer", scope: "units", unitIds: [] })).toMatchObject({ code: "invalid" })
      expect(await changeMemberAccess(deps(), ctx, { memberId: mine, role: "dono", scope: "all" })).toMatchObject({ code: "invalid" })
      expect(await changeMemberAccess(deps(), ctx, { memberId: "nao-e-uuid", role: "viewer", scope: "all" })).toMatchObject({ code: "invalid" })
    })

    it("ninguém altera o próprio acesso", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const self = await memberIdOf(a, a.admin)
      expect(await changeMemberAccess(deps(), ctx, { memberId: self, role: "viewer", scope: "all" })).toMatchObject({ code: "self" })
      expect(await setMemberActive(deps(), ctx, { memberId: self, active: false })).toMatchObject({ code: "self" })
      expect((await accessOf(self))?.role).toBe("client_admin")
    })

    it("sem users.manage: recusado antes de ler qualquer coisa", async () => {
      const ctx = await ctxOf(a.slug, a.viewerAll)
      const target = await memberIdOf(a, a.operatorM3)
      await expect(changeMemberAccess(deps(), ctx, { memberId: target, role: "viewer", scope: "all" })).rejects.toBeInstanceOf(AccessDeniedError)
      await expect(setMemberActive(deps(), ctx, { memberId: target, active: false })).rejects.toBeInstanceOf(AccessDeniedError)
    })
  })

  describe("desativar e reativar", () => {
    it("desativar corta o acesso a este cliente na hora; reativar devolve; os dois auditados", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const target = await memberIdOf(a, a.operatorM3)
      expect(await setMemberActive(deps(), ctx, { memberId: target, active: false })).toEqual({ status: "ok" })
      expect((await accessOf(target))?.active).toBe(false)
      const denied = await loadTenantContext(h.t.db, { slug: a.slug, user: a.operatorM3.user, sessionId: a.operatorM3.sessionId, now: NOW })
      expect(denied.ok).toBe(false)

      expect(await setMemberActive(deps(), ctx, { memberId: target, active: true })).toEqual({ status: "ok" })
      expect((await ctxOf(a.slug, a.operatorM3)).access).toMatchObject({ kind: "member", role: "operator" })

      const actions = await h.t.db.select({ action: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.entityId, target))
      expect(actions.map((x) => x.action)).toEqual(expect.arrayContaining(["user.disable", "user.enable"]))
    })

    it("reativar respeita o limite de usuários do contrato", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const target = await memberIdOf(a, a.inactiveEngineer)
      const activeCount = (
        await h.t.db.select().from(s.memberAccess).where(and(eq(s.memberAccess.organizationId, a.organizationId), eq(s.memberAccess.active, true)))
      ).length
      await h.t.db.update(s.clientAccount).set({ limits: { machines: 10, users: activeCount } }).where(eq(s.clientAccount.organizationId, a.organizationId))
      try {
        expect(await setMemberActive(deps(), ctx, { memberId: target, active: true })).toMatchObject({ code: "limit" })
        expect((await accessOf(target))?.active).toBe(false)
      } finally {
        await h.t.db.update(s.clientAccount).set({ limits: { machines: 10 } }).where(eq(s.clientAccount.organizationId, a.organizationId))
      }
    })

    it("o cliente nunca fica sem admin ativo (nem pela Engemase)", async () => {
      const ctx = await ctxOf(a.slug, a.admin)
      const second = await memberIdOf(a, a.adminNo2fa)
      // Com dois admins, um pode sair.
      expect(await setMemberActive(deps(), ctx, { memberId: second, active: false })).toEqual({ status: "ok" })

      // Agora o admin é o único: o super admin não consegue rebaixá-lo nem desativá-lo.
      const engemase = await ctxOf(a.slug, superAdmin)
      const only = await memberIdOf(a, a.admin)
      expect(await changeMemberAccess(deps(), engemase, { memberId: only, role: "viewer", scope: "all" })).toMatchObject({ code: "last_admin" })
      expect(await setMemberActive(deps(), engemase, { memberId: only, active: false })).toMatchObject({ code: "last_admin" })
      expect(await accessOf(only)).toMatchObject({ role: "client_admin", active: true })

      // Trocar o papel mantendo admin (ou só o escopo de outro) continua valendo; reativar o segundo também.
      expect(await setMemberActive(deps(), engemase, { memberId: second, active: true })).toEqual({ status: "ok" })
      expect(await changeMemberAccess(deps(), engemase, { memberId: only, role: "supervisor", scope: "all" })).toEqual({ status: "ok" })
      const [audit] = await h.t.db
        .select({ actorType: s.auditLog.actorType })
        .from(s.auditLog)
        .where(and(eq(s.auditLog.action, "user.access_change"), eq(s.auditLog.entityId, only)))
      expect(audit?.actorType).toBe("engemase")
    })
  })
  describe("achados da revisão de segurança", () => {
    // Cliente próprio: os testes acima mudam papéis do cliente alfa.
    let g: SeededClient
    beforeAll(async () => {
      g = await seedClient(h.t.db, "gama-gestao")
      for (const p of [g.admin, g.adminNo2fa, g.supervisorUnit1]) await givePassword(p)
    })

    it("admin que nunca criou a senha não conta como outro admin", async () => {
      const ctx = await ctxOf(g.slug, g.admin)
      const engemase = await ctxOf(g.slug, superAdmin)
      // Um terceiro admin convidado (sem senha) e o segundo admin desativado.
      const pendente = await createPerson(h.t.db, "admin-sem-senha")
      const [m] = await h.t.db.insert(s.member).values({ organizationId: g.organizationId, userId: pendente.user.id }).returning()
      await h.t.db.insert(s.memberAccess).values({ organizationId: g.organizationId, memberId: m?.id ?? "", role: "client_admin", scope: "all" })
      const second = await memberIdOf(g, g.adminNo2fa)
      expect(await setMemberActive(deps(), ctx, { memberId: second, active: false })).toEqual({ status: "ok" })
      // Só sobra o admin com senha + o convidado: o com senha não pode sair.
      const only = await memberIdOf(g, g.admin)
      expect(await setMemberActive(deps(), engemase, { memberId: only, active: false })).toMatchObject({ code: "last_admin" })
      expect(await setMemberActive(deps(), engemase, { memberId: second, active: true })).toEqual({ status: "ok" })
    })

    it("pessoa da equipe Engemase com vínculo no cliente não é gerida por aqui", async () => {
      const tecnico = await createPerson(h.t.db, "tecnico-vinculo", { role: "technician", twoFactor: true })
      const [m] = await h.t.db.insert(s.member).values({ organizationId: g.organizationId, userId: tecnico.user.id }).returning()
      await h.t.db.insert(s.memberAccess).values({ organizationId: g.organizationId, memberId: m?.id ?? "", role: "engineer", scope: "all" })
      const ctx = await ctxOf(g.slug, g.admin)
      const memberId = m?.id ?? ""
      expect(await changeMemberAccess(deps(), ctx, { memberId, role: "client_admin", scope: "all" })).toMatchObject({ code: "not_found" })
      expect(await setMemberActive(deps(), ctx, { memberId, active: false })).toMatchObject({ code: "not_found" })
      const asked: string[] = []
      const reset = async (email: string) => (asked.push(email), { status: "ok" as const })
      expect(await requestMemberPasswordReset({ ...deps(), reset }, ctx, memberId)).toMatchObject({ code: "not_found" })
      expect(asked).toEqual([])
      expect((await accessOf(memberId))?.role).toBe("engineer")
    })

    it("redefinição pedida pelo admin: só com senha criada e vínculo ativo, auditada (inclusive barrada pelo limite)", async () => {
      const ctx = await ctxOf(g.slug, g.admin)
      const asked: string[] = []
      let answer: "ok" | "throttled" = "ok"
      const reset = async (email: string) => {
        asked.push(email)
        return answer === "ok" ? ({ status: "ok" } as const) : ({ status: "throttled", retryAt: null } as const)
      }
      const supervisor = await memberIdOf(g, g.supervisorUnit1)
      expect(await requestMemberPasswordReset({ ...deps(), reset }, ctx, supervisor)).toEqual({ status: "ok" })
      expect(asked).toEqual([g.supervisorUnit1.user.email])
      answer = "throttled"
      expect(await requestMemberPasswordReset({ ...deps(), reset }, ctx, supervisor)).toMatchObject({ code: "throttled" })
      const audit = await h.t.db
        .select({ after: s.auditLog.after })
        .from(s.auditLog)
        .where(and(eq(s.auditLog.action, "user.password_reset_requested"), eq(s.auditLog.entityId, supervisor)))
      expect(audit.map((x) => x.after)).toEqual([{ result: "ok" }, { result: "throttled" }])

      // Sem senha criada: use o reenvio do convite. De outro cliente: não existe aqui.
      expect(await requestMemberPasswordReset({ ...deps(), reset }, ctx, await memberIdOf(g, g.viewerAll))).toMatchObject({ code: "no_password" })
      expect(await requestMemberPasswordReset({ ...deps(), reset }, ctx, await memberIdOf(b, b.viewerAll))).toMatchObject({ code: "not_found" })
      expect(asked).toHaveLength(2)
    })

    it("vínculo desativado some do login e do /inicio", async () => {
      // Uma pessoa com vínculo em alfa (ativo) e em beta (que será desativado).
      const p = await createPerson(h.t.db, "dois-clientes")
      for (const c of [g, b]) {
        const [m] = await h.t.db.insert(s.member).values({ organizationId: c.organizationId, userId: p.user.id }).returning()
        await h.t.db.insert(s.memberAccess).values({ organizationId: c.organizationId, memberId: m?.id ?? "", role: "viewer", scope: "all" })
      }
      expect((await activeClients(h.t.db, h.t.db, p.user.id)).map((c) => c.slug).sort()).toEqual([g.slug, b.slug].sort())
      expect(await landingPath(h.t.db, { id: p.user.id, role: null }, h.t.db)).toBe("/inicio")

      await givePassword(b.admin)
      const ctxB = await ctxOf(b.slug, b.admin)
      expect(await setMemberActive(deps(), ctxB, { memberId: await memberIdOf(b, p), active: false })).toEqual({ status: "ok" })
      expect((await activeClients(h.t.db, h.t.db, p.user.id)).map((c) => c.slug)).toEqual([g.slug])
      expect(await landingPath(h.t.db, { id: p.user.id, role: null }, h.t.db)).toBe(`/${g.slug}`)
    })
  })
})
