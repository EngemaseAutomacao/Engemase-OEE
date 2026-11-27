/**
 * Gestão da equipe no banco (lib/server/team/manage.ts e read.ts): concessões de suporte, atribuições e
 * ações sobre membros, com as regras de quem pode o quê.
 */
import * as s from "@engemase/db"
import { seedPlatform } from "@engemase/db/seed"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { loadTenantContext } from "@/lib/server/access/load"
import { addTeamMember } from "@/lib/server/team/add-member"
import {
  changeMemberRole,
  createAssignment,
  endSupportGrant,
  openSupportGrant,
  renewAssignment,
  resendTeamInvite,
  revokeAssignment,
  setMemberDisabled,
  type TeamActorWithRole,
  type TeamDeps,
} from "@/lib/server/team/manage"
import { readTeamAccess, teamRows } from "@/lib/server/team/read"
import { type AuthHarness, BASE_URL, createAuthHarness } from "../auth/support"
import { type SeededClient, seedClient } from "./support"

const NOW = new Date()

describe("equipe Engemase: gestão no banco", () => {
  let h: AuthHarness
  let cliente: SeededClient
  let outro: SeededClient
  let superAdmin: TeamActorWithRole
  let tecnico: TeamActorWithRole
  let tecnico2: TeamActorWithRole

  const deps = (): TeamDeps => ({ db: h.t.db, authDb: h.t.db, now: NOW, baseURL: BASE_URL, sendEmail: async () => ({ status: "logged" }) })
  const entra = (person: TeamActorWithRole, slug: string) =>
    loadTenantContext(h.t.db, {
      slug,
      user: { id: person.id, name: person.name, email: person.email, role: person.role, banned: false, twoFactorEnabled: true },
      sessionId: "00000000-0000-4000-8000-00000000abcd",
      now: NOW,
    })

  async function membro(name: string, email: string): Promise<TeamActorWithRole> {
    const r = await addTeamMember({ ...deps() }, superAdmin, { name, email, role: "technician" })
    if (r.status !== "ok") throw new Error(r.message)
    return { id: r.userId, name, email, role: "technician" }
  }

  beforeAll(async () => {
    h = await createAuthHarness({ now: () => NOW })
    const seeded = await seedPlatform(h.t.db, { adminEmail: "diretor@engemase.example", adminName: "Diretor", now: NOW })
    superAdmin = { id: seeded.adminUserId, name: "Diretor", email: "diretor@engemase.example", role: "super_admin" }
    cliente = await seedClient(h.t.db, "gestao-a")
    outro = await seedClient(h.t.db, "gestao-b")
    tecnico = await membro("Técnico Um", "tec1@engemase.example")
    tecnico2 = await membro("Técnico Dois", "tec2@engemase.example")
  })

  afterAll(async () => {
    await h.t.client.close()
  })

  describe("concessão de suporte", () => {
    it("o técnico abre para si (até 4 h), entra no cliente, encerra e perde o acesso", async () => {
      expect((await entra(tecnico, cliente.slug)).ok).toBe(false)
      const r = await openSupportGrant(deps(), tecnico, { clientId: cliente.organizationId, ticket: "1060", reason: "Conferir as tags da injetora 4", minutes: 240 })
      if (r.status !== "ok") throw new Error(r.message)
      const ctx = await entra(tecnico, cliente.slug)
      expect(ctx.ok && ctx.context.permissions.has("config.write")).toBe(true)
      expect((await entra(tecnico, outro.slug)).ok).toBe(false)

      // Outro técnico não encerra a concessão dele; ele mesmo pode.
      expect(await endSupportGrant(deps(), tecnico2, { id: r.data.id, clientId: cliente.organizationId })).toMatchObject({ status: "error" })
      expect(await endSupportGrant(deps(), tecnico, { id: r.data.id, clientId: cliente.organizationId })).toEqual({ status: "ok", data: undefined })
      expect((await entra(tecnico, cliente.slug)).ok).toBe(false)
      const audit = await h.t.db.select({ action: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.organizationId, cliente.organizationId))
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["support.grant_open", "support.grant_end"]))
    })

    it("recusas: técnico abrindo para outro, prazo acima de 4 h, sem chamado, super admin como alvo", async () => {
      const base = { clientId: cliente.organizationId, ticket: "#1061", reason: "Motivo com mais de dez letras", minutes: 60 }
      expect(await openSupportGrant(deps(), tecnico, { ...base, userId: tecnico2.id })).toMatchObject({ status: "error" })
      expect(await openSupportGrant(deps(), tecnico, { ...base, minutes: 300 })).toMatchObject({ status: "error" })
      expect(await openSupportGrant(deps(), tecnico, { ...base, ticket: "" })).toMatchObject({ status: "error" })
      expect(await openSupportGrant(deps(), superAdmin, { ...base, userId: superAdmin.id })).toMatchObject({ status: "error" })
      // O super admin pode abrir para um técnico.
      expect(await openSupportGrant(deps(), superAdmin, { ...base, userId: tecnico2.id })).toMatchObject({ status: "ok" })
    })
  })

  describe("atribuição", () => {
    it("super admin cria (só unidade 1), o técnico entra só nela; renova e revoga", async () => {
      const r = await createAssignment(deps(), superAdmin, { userId: tecnico.id, clientId: cliente.organizationId, unitIds: [cliente.unit1], days: 30, reason: "Implantação da planta 1" })
      if (r.status !== "ok") throw new Error(r.message)
      const ctx = await entra(tecnico, cliente.slug)
      expect(ctx.ok && ctx.context.scope).toEqual({ kind: "units", unitIds: [cliente.unit1] })

      // Aparece na lista real da tela da equipe.
      const rows = teamRows(await readTeamAccess(h.t.db, h.t.db, NOW), NOW)
      expect(rows.assignments.find((a) => a.id === r.data.id)).toMatchObject({ userName: "Técnico Um", unitLabel: "Planta 1", daysLeft: 30 })

      expect(await renewAssignment(deps(), superAdmin, { id: r.data.id, clientId: cliente.organizationId })).toMatchObject({ status: "ok" })
      const [renewed] = await h.t.db.select().from(s.platformAssignment).where(eq(s.platformAssignment.id, r.data.id))
      expect(renewed?.validUntil.getTime()).toBe(NOW.getTime() + 90 * 86_400_000)

      expect(await revokeAssignment(deps(), superAdmin, { id: r.data.id, clientId: cliente.organizationId })).toMatchObject({ status: "ok" })
      expect((await entra(tecnico, cliente.slug)).ok).toBe(false)
    })

    it("recusas: técnico criando, unidade de outro cliente, super admin como alvo", async () => {
      const base = { userId: tecnico.id, clientId: cliente.organizationId, unitIds: null, days: 30, reason: "Implantação" }
      expect(await createAssignment(deps(), tecnico, base)).toMatchObject({ status: "error" })
      expect(await createAssignment(deps(), superAdmin, { ...base, unitIds: [outro.unit1] })).toMatchObject({ status: "error", message: "Alguma unidade não pertence a este cliente." })
      expect(await createAssignment(deps(), superAdmin, { ...base, userId: superAdmin.id })).toMatchObject({ status: "error" })
    })
  })

  describe("membros", () => {
    it("trocar papel, desativar e reativar; nunca em si mesmo nem o último super admin", async () => {
      expect(await changeMemberRole(deps(), superAdmin, { userId: superAdmin.id, role: "technician" })).toMatchObject({ status: "error" })
      expect(await setMemberDisabled(deps(), superAdmin, { userId: superAdmin.id }, true)).toMatchObject({ status: "error" })
      expect(await changeMemberRole(deps(), tecnico, { userId: tecnico2.id, role: "super_admin" })).toMatchObject({ status: "error" })

      expect(await changeMemberRole(deps(), superAdmin, { userId: tecnico2.id, role: "super_admin" })).toMatchObject({ status: "ok" })
      const promovido: TeamActorWithRole = { ...tecnico2, role: "super_admin" }
      // Com dois super admins, um pode rebaixar o outro; o último que sobra, não.
      expect(await changeMemberRole(deps(), promovido, { userId: superAdmin.id, role: "technician" })).toMatchObject({ status: "ok" })
      expect(await changeMemberRole(deps(), superAdmin, { userId: promovido.id, role: "technician" })).toMatchObject({ status: "error" })
      await h.t.db.update(s.user).set({ role: "super_admin" }).where(eq(s.user.id, superAdmin.id))

      expect(await setMemberDisabled(deps(), superAdmin, { userId: tecnico.id }, true)).toMatchObject({ status: "ok" })
      const [off] = await h.t.db.select({ banned: s.user.banned }).from(s.user).where(eq(s.user.id, tecnico.id))
      expect(off?.banned).toBe(true)
      expect(await setMemberDisabled(deps(), superAdmin, { userId: tecnico.id }, false)).toMatchObject({ status: "ok" })
    })

    it("reenviar convite gera um link novo enquanto a pessoa não tem senha", async () => {
      const r = await resendTeamInvite(deps(), superAdmin, { userId: tecnico.id })
      expect(r.status === "ok" && r.data.link).toMatch(/\/definir-senha#t=[A-Za-z0-9_-]{43}$/)
    })
  })
})
