/**
 * Isolamento entre clientes e escopo (docs/15, seção 4, item 7; D11, D12, D13, D14, D38): a camada de
 * acesso (`loadTenantContext` + consultas de `lib/server/access/data.ts`) contra o Postgres real
 * (PGlite), com a RLS ligada. Pessoa do cliente A tentando entrar em B, ids de B na URL, escopo por
 * unidade e por máquina, fail-closed, equipe Engemase com e sem concessão, cliente suspenso e 2FA.
 */
import { randomUUID } from "node:crypto"
import { auditLog } from "@engemase/db"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type AccessDecision, type TenantContext } from "@/lib/server/access/context"
import { getMachine, listLines, listMachines, listUnits } from "@/lib/server/access/data"
import { loadTenantContext } from "@/lib/server/access/load"
import {
  assignFieldEngineer,
  createPerson,
  createTestDatabase,
  grantSupport,
  type SeededClient,
  type SeededPerson,
  seedClient,
  type TestDatabase,
} from "./support"

const NOW = new Date("2026-11-24T15:00:00Z")

function ok(decision: AccessDecision): TenantContext {
  if (!decision.ok) throw new Error(`esperava acesso, veio ${decision.reason}`)
  return decision.context
}

describe("isolamento entre clientes e escopo (requireTenant)", () => {
  let t: TestDatabase
  let a: SeededClient
  let b: SeededClient
  let suspended: SeededClient
  let superAdmin: SeededPerson
  let techBoth: SeededPerson
  let grantBoth: string
  let superAdminNo2fa: SeededPerson
  let supportWithGrant: SeededPerson
  let supportExpired: SeededPerson
  let supportFuture: SeededPerson
  let fieldUnit1: SeededPerson
  let fieldAll: SeededPerson
  let fieldRevoked: SeededPerson
  let fieldDeletedUnit: SeededPerson
  let banned: SeededPerson
  let grantA: string

  const load = (slug: string, person: SeededPerson) =>
    loadTenantContext(t.db, { slug, user: person.user, sessionId: person.sessionId, now: NOW })

  beforeAll(async () => {
    t = await createTestDatabase()
    a = await seedClient(t.db, "alfa")
    b = await seedClient(t.db, "beta")
    suspended = await seedClient(t.db, "gama", "suspended")

    superAdmin = await createPerson(t.db, "super", { role: "super_admin", twoFactor: true })
    superAdminNo2fa = await createPerson(t.db, "super-sem-2fa", { role: "super_admin" })
    supportWithGrant = await createPerson(t.db, "suporte", { role: "technician", twoFactor: true })
    grantA = await grantSupport(t.db, a.organizationId, supportWithGrant, NOW, { startH: -1, endH: 2 })
    await grantSupport(t.db, suspended.organizationId, supportWithGrant, NOW, { startH: -1, endH: 2 })
    supportExpired = await createPerson(t.db, "suporte-vencido", { role: "technician", twoFactor: true })
    await grantSupport(t.db, a.organizationId, supportExpired, NOW, { startH: -5, endH: -1 })
    supportFuture = await createPerson(t.db, "suporte-futuro", { role: "technician", twoFactor: true })
    await grantSupport(t.db, a.organizationId, supportFuture, NOW, { startH: 1, endH: 3 })

    fieldUnit1 = await createPerson(t.db, "campo-u1", { role: "technician", twoFactor: true })
    await assignFieldEngineer(t.db, a.organizationId, fieldUnit1, NOW, { unitIds: [a.unit1] })
    fieldAll = await createPerson(t.db, "campo-todo", { role: "technician", twoFactor: true })
    await assignFieldEngineer(t.db, a.organizationId, fieldAll, NOW)
    fieldRevoked = await createPerson(t.db, "campo-revogado", { role: "technician", twoFactor: true })
    await assignFieldEngineer(t.db, a.organizationId, fieldRevoked, NOW, { revoked: true })
    fieldDeletedUnit = await createPerson(t.db, "campo-unidade-excluida", { role: "technician", twoFactor: true })
    // Unidade nova, sem máquinas, depois excluída: a atribuição restrita a ela não pode virar "cliente inteiro".
    const deletedUnitId = randomUUID()
    await t.client.query(
      "INSERT INTO unit (id, organization_id, name, deleted_at) VALUES ($1, $2, 'Planta fechada', now())",
      [deletedUnitId, a.organizationId],
    )
    await assignFieldEngineer(t.db, a.organizationId, fieldDeletedUnit, NOW, { unitIds: [deletedUnitId] })

    // Técnico com atribuição a uma unidade E concessão de suporte ativa no mesmo cliente.
    techBoth = await createPerson(t.db, "tecnico-ambos", { role: "technician", twoFactor: true })
    await assignFieldEngineer(t.db, a.organizationId, techBoth, NOW, { unitIds: [a.unit1] })
    grantBoth = await grantSupport(t.db, a.organizationId, techBoth, NOW, { startH: -1, endH: 1 })

    banned = await createPerson(t.db, "bloqueado", { banned: true })
  })

  afterAll(async () => {
    await t.client.close()
  })

  describe("cliente da URL", () => {
    it("pessoa do cliente A entra em A", async () => {
      const ctx = ok(await load(a.slug, a.admin))
      expect(ctx.organizationId).toBe(a.organizationId)
      expect(ctx.access).toMatchObject({ kind: "member", role: "client_admin" })
      expect(ctx.scope).toEqual({ kind: "all" })
    })

    it("pessoa do cliente A no slug de B → not_found (igual a cliente inexistente)", async () => {
      for (const person of [a.admin, a.supervisorUnit1, a.operatorM3, a.viewerAll]) {
        expect(await load(b.slug, person)).toEqual({ ok: false, reason: "not_found" })
      }
      expect(await load("nao-existe", a.admin)).toEqual({ ok: false, reason: "not_found" })
      // Slug fora do formato não chega ao banco.
      expect(await load("../beta", a.admin)).toEqual({ ok: false, reason: "not_found" })
      expect(await load("BETA", a.admin)).toEqual({ ok: false, reason: "not_found" })
    })

    it("máquina de B pelo id, com o contexto de A → null (RLS)", async () => {
      const ctx = ok(await load(a.slug, a.admin))
      expect(await getMachine(t.db, ctx, b.m1)).toBeNull()
      expect(await getMachine(t.db, ctx, a.m1)).toMatchObject({ id: a.m1 })
      expect(await getMachine(t.db, ctx, "nao-e-uuid")).toBeNull()
    })

    it("contexto forjado com o cliente de B mas montado para A não vaza nada além do próprio cliente", async () => {
      // Um bug que trocasse o organizationId continua preso à RLS do cliente informado — nunca mistura.
      const ctx = ok(await load(a.slug, a.admin))
      const machines = await listMachines(t.db, ctx)
      expect(machines.map((m) => m.id).sort()).toEqual([a.m1, a.m2, a.m3].sort())
      expect(machines.some((m) => [b.m1, b.m2, b.m3].includes(m.id))).toBe(false)
    })
  })

  describe("escopo (D11, fail-closed)", () => {
    it("escopo por unidade: só as máquinas, linhas e unidades da unidade 1", async () => {
      const ctx = ok(await load(a.slug, a.supervisorUnit1))
      expect(ctx.scope).toEqual({ kind: "units", unitIds: [a.unit1] })
      expect((await listMachines(t.db, ctx)).map((m) => m.id).sort()).toEqual([a.m1, a.m2].sort())
      expect((await listUnits(t.db, ctx)).map((u) => u.id)).toEqual([a.unit1])
      expect((await listLines(t.db, ctx)).map((l) => l.id)).toEqual([a.line1])
      expect(await getMachine(t.db, ctx, a.m3)).toBeNull()
    })

    it("escopo por máquina: só a máquina listada (e a unidade/linha dela para navegar)", async () => {
      const ctx = ok(await load(a.slug, a.operatorM3))
      expect(ctx.scope).toEqual({ kind: "machines", machineIds: [a.m3] })
      expect((await listMachines(t.db, ctx)).map((m) => m.id)).toEqual([a.m3])
      expect((await listUnits(t.db, ctx)).map((u) => u.id)).toEqual([a.unit2])
      expect((await listLines(t.db, ctx)).map((l) => l.id)).toEqual([a.line2])
      expect(await getMachine(t.db, ctx, a.m1)).toBeNull()
      expect(await getMachine(t.db, ctx, a.m3)).toMatchObject({ id: a.m3 })
    })

    it("escopo `units` sem nenhuma unidade → sem acesso", async () => {
      expect(await load(a.slug, a.viewerEmptyUnits)).toEqual({ ok: false, reason: "not_found" })
    })

    it("escopo `machines` só com máquina excluída → sem acesso", async () => {
      expect(await load(a.slug, a.operatorDeletedOnly)).toEqual({ ok: false, reason: "not_found" })
    })

    it("vínculo inativo ou sem member_access → sem acesso", async () => {
      expect(await load(a.slug, a.inactiveEngineer)).toEqual({ ok: false, reason: "not_found" })
      expect(await load(a.slug, a.memberWithoutAccess)).toEqual({ ok: false, reason: "not_found" })
    })

    it("cliente inteiro: todas as máquinas não excluídas", async () => {
      const ctx = ok(await load(a.slug, a.viewerAll))
      expect((await listMachines(t.db, ctx)).map((m) => m.id).sort()).toEqual([a.m1, a.m2, a.m3].sort())
    })
  })

  describe("papéis (D12, D13)", () => {
    it("admin do cliente gerencia usuários, não edita configuração", async () => {
      const ctx = ok(await load(a.slug, a.admin))
      expect(ctx.permissions.has("users.manage")).toBe(true)
      expect(ctx.permissions.has("config.read")).toBe(true)
      expect(ctx.permissions.has("config.write")).toBe(false)
    })

    it("visualizador só lê; operador aponta; nenhum dos dois vê a parte técnica", async () => {
      const viewer = ok(await load(a.slug, a.viewerAll))
      expect([...viewer.permissions]).toEqual(["data.read"])
      const operator = ok(await load(a.slug, a.operatorM3))
      expect(operator.permissions.has("floor.act")).toBe(true)
      expect(operator.permissions.has("technical.read")).toBe(false)
    })

    it("consulta exige a permissão (fail-closed)", async () => {
      const ctx = ok(await load(a.slug, a.viewerAll))
      const semLeitura: TenantContext = { ...ctx, permissions: new Set() }
      await expect(listMachines(t.db, semLeitura)).rejects.toBeInstanceOf(AccessDeniedError)
    })
  })

  describe("equipe Engemase (D5)", () => {
    it("super admin entra em qualquer cliente, com registro na auditoria do cliente (uma vez por sessão)", async () => {
      const ctx = ok(await load(b.slug, superAdmin))
      expect(ctx.access).toMatchObject({ kind: "engemase", role: "super_admin" })
      expect(ctx.permissions.has("config.write")).toBe(true)
      ok(await load(b.slug, superAdmin))
      const rows = await t.db
        .select({ id: auditLog.id, organizationId: auditLog.organizationId, actorType: auditLog.actorType })
        .from(auditLog)
        .where(and(eq(auditLog.action, "engemase.access"), eq(auditLog.actorId, superAdmin.user.id)))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ organizationId: b.organizationId, actorType: "engemase" })
    })

    it("técnico por concessão de suporte: só com concessão ativa, só no cliente dela; edita a configuração", async () => {
      const ctx = ok(await load(a.slug, supportWithGrant))
      expect(ctx.access).toMatchObject({ kind: "engemase", role: "technician", supportGrantId: grantA, assignmentId: null })
      expect(ctx.scope).toEqual({ kind: "all" })
      // Decisão de 26/11/2026: suporte e implantação são a mesma equipe; durante a concessão o técnico edita.
      expect(ctx.permissions.has("config.write")).toBe(true)
      expect(ctx.permissions.has("diagnostics.run")).toBe(true)
      expect(ctx.permissions.has("users.manage")).toBe(false)
      expect(await load(b.slug, supportWithGrant)).toEqual({ ok: false, reason: "not_found" })
      expect(await load(a.slug, supportExpired)).toEqual({ ok: false, reason: "not_found" })
      expect(await load(a.slug, supportFuture)).toEqual({ ok: false, reason: "not_found" })
      const [audit] = await t.db
        .select({ accessGrantId: auditLog.accessGrantId })
        .from(auditLog)
        .where(and(eq(auditLog.action, "engemase.access"), eq(auditLog.actorId, supportWithGrant.user.id)))
      expect(audit?.accessGrantId).toBe(grantA)
    })

    it("técnico com atribuição e concessão: vale a concessão (cliente inteiro), as duas no contexto", async () => {
      const ctx = ok(await load(a.slug, techBoth))
      expect(ctx.scope).toEqual({ kind: "all" })
      expect(ctx.access).toMatchObject({ kind: "engemase", role: "technician", supportGrantId: grantBoth })
      expect(ctx.access.kind === "engemase" && ctx.access.assignmentId).toBeTruthy()
      expect(await load(b.slug, techBoth)).toEqual({ ok: false, reason: "not_found" })
    })

    it("técnico por atribuição: só com atribuição válida, no escopo das unidades atribuídas", async () => {
      const u1 = ok(await load(a.slug, fieldUnit1))
      expect(u1.scope).toEqual({ kind: "units", unitIds: [a.unit1] })
      expect((await listMachines(t.db, u1)).map((m) => m.id).sort()).toEqual([a.m1, a.m2].sort())
      expect(ok(await load(a.slug, fieldAll)).scope).toEqual({ kind: "all" })
      expect(await load(b.slug, fieldAll)).toEqual({ ok: false, reason: "not_found" })
      expect(await load(a.slug, fieldRevoked)).toEqual({ ok: false, reason: "not_found" })
      expect(await load(a.slug, fieldDeletedUnit)).toEqual({ ok: false, reason: "not_found" })
    })
  })

  describe("estado do cliente e da pessoa", () => {
    it("cliente suspenso: usuário do cliente fica de fora; a Engemase continua entrando", async () => {
      expect(await load(suspended.slug, suspended.admin)).toEqual({ ok: false, reason: "client_suspended" })
      expect(await load(suspended.slug, suspended.viewerAll)).toEqual({ ok: false, reason: "client_suspended" })
      expect(ok(await load(suspended.slug, supportWithGrant)).clientStatus).toBe("suspended")
    })

    it("2FA obrigatório para admin do cliente e equipe Engemase (D14); opcional para os outros", async () => {
      expect(await load(a.slug, a.adminNo2fa)).toEqual({ ok: false, reason: "two_factor_required" })
      expect(await load(a.slug, superAdminNo2fa)).toEqual({ ok: false, reason: "two_factor_required" })
      expect((await load(a.slug, a.viewerAll)).ok).toBe(true)
    })

    it("pessoa bloqueada (banned) é tratada como sem sessão", async () => {
      expect(await load(a.slug, banned)).toEqual({ ok: false, reason: "unauthenticated" })
    })

    it("papel de plataforma desconhecido não dá poder nenhum", async () => {
      const weird = await createPerson(t.db, "papel-estranho", { role: "admin", twoFactor: true })
      expect(await load(a.slug, weird)).toEqual({ ok: false, reason: "not_found" })
    })
  })
})
