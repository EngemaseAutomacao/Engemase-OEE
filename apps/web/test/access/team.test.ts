/**
 * "Adicionar membro" da equipe Engemase (lib/server/team/add-member.ts) num banco PGlite com as migrações e a
 * RLS: conta com o papel, vínculo na Engemase Lab, link "definir senha" que funciona, primeira atribuição
 * do técnico (que passa a entrar no cliente) e as recusas.
 */
import * as s from "@engemase/db"
import { seedPlatform } from "@engemase/db/seed"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { loadTenantContext } from "@/lib/server/access/load"
import { setPasswordWithToken } from "@/lib/server/auth/set-password"
import type { EmailMessage } from "@/lib/server/email"
import { type AddTeamMemberDeps, addTeamMember, type TeamActor } from "@/lib/server/team/add-member"
import { type AuthHarness, BASE_URL, browserHeaders, createAuthHarness } from "../auth/support"
import { createPerson, type SeededClient, seedClient } from "./support"

const NOW = new Date()
const PASSWORD = "lanterna violeta café trovão"

describe("equipe Engemase: adicionar membro", () => {
  let h: AuthHarness
  let cliente: SeededClient
  let actor: TeamActor
  const mails: EmailMessage[] = []

  const deps = (): AddTeamMemberDeps => ({
    db: h.t.db,
    authDb: h.t.db,
    now: NOW,
    baseURL: BASE_URL,
    sendEmail: async (m) => {
      mails.push(m)
      return { status: "logged" }
    },
  })

  beforeAll(async () => {
    h = await createAuthHarness({ now: () => NOW })
    const seeded = await seedPlatform(h.t.db, { adminEmail: "diretor@engemase.example", adminName: "Diretor Técnico", now: NOW })
    actor = { id: seeded.adminUserId, name: "Diretor Técnico", email: "diretor@engemase.example" }
    cliente = await seedClient(h.t.db, "cliente-equipe")
  })

  afterAll(async () => {
    await h.t.client.close()
  })

  it("técnico com primeira atribuição: conta, vínculo na Lab, link que funciona e acesso ao cliente", async () => {
    const result = await addTeamMember(deps(), actor, {
      name: "Carlos Técnico",
      email: "Carlos.Tecnico@engemase.example",
      role: "technician",
      clientId: cliente.organizationId,
      days: 60,
    })
    if (result.status !== "ok") throw new Error(result.message)
    expect(result).toMatchObject({ existingAccount: false, assignedClient: `Cliente ${cliente.slug}` })
    expect(result.link).toMatch(/\/definir-senha#t=[A-Za-z0-9_-]{43}$/)
    expect(mails.at(-1)?.to).toBe("carlos.tecnico@engemase.example")

    const [person] = await h.t.db.select().from(s.user).where(eq(s.user.id, result.userId))
    expect(person).toMatchObject({ email: "carlos.tecnico@engemase.example", role: "technician", emailVerified: false })

    // Vínculo na Engemase Lab com leitura técnica (engineer), nunca admin.
    const [lab] = await h.t.db.select().from(s.organization).where(eq(s.organization.slug, "engemase-lab"))
    const access = await h.t.db
      .select({ role: s.memberAccess.role })
      .from(s.memberAccess)
      .innerJoin(s.member, eq(s.member.id, s.memberAccess.memberId))
      .where(and(eq(s.member.userId, result.userId), eq(s.member.organizationId, lab!.id)))
    expect(access).toEqual([{ role: "engineer" }])

    // Atribuição no cliente, com auditoria visível a ele.
    const assignments = await h.t.db.select().from(s.platformAssignment).where(eq(s.platformAssignment.userId, result.userId))
    expect(assignments).toHaveLength(1)
    expect(assignments[0]?.organizationId).toBe(cliente.organizationId)
    expect(assignments[0]?.validUntil.getTime()).toBe(NOW.getTime() + 60 * 86_400_000)
    const audits = await h.t.db
      .select({ action: s.auditLog.action })
      .from(s.auditLog)
      .where(and(eq(s.auditLog.organizationId, cliente.organizationId), eq(s.auditLog.action, "platform.assignment_create")))
    expect(audits).toHaveLength(1)

    // O link define a senha e o login funciona.
    const token = result.link!.split("#t=")[1]!
    expect(
      await setPasswordWithToken({ db: h.t.db, authDb: h.t.db, auth: h.auth, now: NOW, pwned: async () => false }, { token, password: PASSWORD }),
    ).toEqual({ status: "ok", email: "carlos.tecnico@engemase.example" })
    const signed = await h.auth.api.signInEmail({ body: { email: "carlos.tecnico@engemase.example", password: PASSWORD }, headers: browserHeaders() })
    expect("user" in signed && signed.user.id).toBe(result.userId)

    // Com a atribuição, o técnico entra no cliente e pode configurar.
    const decision = await loadTenantContext(h.t.db, {
      slug: cliente.slug,
      user: { id: result.userId, name: "Carlos Técnico", email: "carlos.tecnico@engemase.example", role: "technician", banned: false, twoFactorEnabled: true },
      sessionId: "00000000-0000-4000-8000-00000000abcd",
      now: NOW,
    })
    expect(decision.ok && decision.context.permissions.has("config.write")).toBe(true)
  })

  it("super admin: sem atribuição, administra a Lab", async () => {
    const result = await addTeamMember(deps(), actor, { name: "Segunda Diretora", email: "diretora2@engemase.example", role: "super_admin" })
    if (result.status !== "ok") throw new Error(result.message)
    const [person] = await h.t.db.select({ role: s.user.role }).from(s.user).where(eq(s.user.id, result.userId))
    expect(person?.role).toBe("super_admin")
  })

  it("recusas: outro domínio, já da equipe, usuário de cliente, atribuição para super admin, cliente inexistente", async () => {
    expect(await addTeamMember(deps(), actor, { name: "Fulano Externo", email: "fulano@gmail.com", role: "technician" })).toMatchObject({
      status: "error",
      field: "email",
    })
    expect(await addTeamMember(deps(), actor, { name: "Carlos De Novo", email: "carlos.tecnico@engemase.example", role: "technician" })).toMatchObject({
      status: "error",
      message: "Esta pessoa já faz parte da equipe Engemase.",
    })

    // Alguém que já é usuário de um cliente não vira equipe pelo mesmo e-mail.
    const clientUser = await createPerson(h.t.db, "cliente")
    await h.t.db.update(s.user).set({ email: "operador@engemase.example" }).where(eq(s.user.id, clientUser.user.id))
    await h.t.db.insert(s.member).values({ organizationId: cliente.organizationId, userId: clientUser.user.id })
    expect(await addTeamMember(deps(), actor, { name: "Operador Misturado", email: "operador@engemase.example", role: "technician" })).toMatchObject({
      status: "error",
      field: "email",
    })
    const [still] = await h.t.db.select({ role: s.user.role }).from(s.user).where(eq(s.user.id, clientUser.user.id))
    expect(still?.role ?? null).toBeNull()

    expect(
      await addTeamMember(deps(), actor, { name: "Diretor Três", email: "d3@engemase.example", role: "super_admin", clientId: cliente.organizationId }),
    ).toMatchObject({ status: "error", field: "clientId" })
    expect(
      await addTeamMember(deps(), actor, { name: "Técnica Nova", email: "t2@engemase.example", role: "technician", clientId: "00000000-0000-4000-8000-000000000000" }),
    ).toMatchObject({ status: "error", field: "clientId" })
  })
})
