/**
 * Cadastro dos motivos de parada (lib/server/config/reasons.ts): árvore grupo › motivo, herança de categoria
 * e cor, ocultar/excluir (motivo usado só é ocultado), motivos de sistema protegidos, RLS por cliente
 * (nível 3), `config.write` e auditoria.
 */
import * as s from "@engemase/db"
import { eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import { definirAtivo, definirCor, excluirMotivo, salvarGrupo, salvarMotivo } from "@/lib/server/config/reasons"
import { type AuthHarness, createAuthHarness } from "../auth/support"
import { createPerson, type SeededClient, type SeededPerson, seedClient } from "./support"

const NOW = new Date("2026-11-27T15:00:00Z")

describe("cadastro de motivos de parada", () => {
  let h: AuthHarness
  let a: SeededClient
  let b: SeededClient
  let superAdmin: SeededPerson
  let eng: TenantContext

  async function ctxOf(slug: string, person: SeededPerson): Promise<TenantContext> {
    const decision = await loadTenantContext(h.t.db, { slug, user: person.user, sessionId: person.sessionId, now: NOW })
    if (!decision.ok) throw new Error(`sem acesso: ${decision.reason}`)
    return decision.context
  }

  const idOf = (r: { ok: boolean; dados?: { id: string } } | { ok: false; mensagem: string }): string => ("dados" in r && r.dados ? r.dados.id : "")

  async function rowsOf(ids: string[]) {
    return h.t.db.select().from(s.downtimeReason).where(inArray(s.downtimeReason.id, ids))
  }

  beforeAll(async () => {
    h = await createAuthHarness({ now: () => NOW })
    a = await seedClient(h.t.db, "alfa-motivos")
    b = await seedClient(h.t.db, "beta-motivos")
    superAdmin = await createPerson(h.t.db, "super-motivos", { role: "super_admin", twoFactor: true })
    eng = await ctxOf(a.slug, superAdmin)
  }, 60_000)

  afterAll(async () => {
    await h.t.client.close()
  })

  it("grupo e motivo: o motivo herda categoria e cor; mudar o grupo muda os motivos; nome único entre irmãos", async () => {
    const g = idOf(await salvarGrupo(h.t.db, eng, { name: "Mecânica", category: "unplanned", color: "#EF4444" }))
    const m = idOf(await salvarMotivo(h.t.db, eng, { parentId: g, name: "Quebra de molde" }))
    expect((await rowsOf([m]))[0]).toMatchObject({ parentId: g, category: "unplanned", color: "#EF4444", active: true })

    expect(await salvarMotivo(h.t.db, eng, { parentId: g, name: "quebra de molde" })).toMatchObject({ ok: false })
    expect(await salvarGrupo(h.t.db, eng, { name: "mecânica", category: "setup", color: "#3B82F6" })).toMatchObject({ ok: false })

    expect(await salvarGrupo(h.t.db, eng, { id: g, name: "Setup mecânico", category: "setup", color: "#3B82F6" })).toEqual({ ok: true, dados: { id: g } })
    expect((await rowsOf([m]))[0]).toMatchObject({ category: "setup", color: "#3B82F6" })

    expect(await salvarMotivo(h.t.db, eng, { id: m, parentId: g, name: "Troca de molde" })).toEqual({ ok: true, dados: { id: m } })
    expect(await definirCor(h.t.db, eng, { id: g, color: "#10B981" })).toEqual({ ok: true, dados: { id: g } })
    expect((await rowsOf([g, m])).map((r) => r.color)).toEqual(["#10B981", "#10B981"])

    const audit = await h.t.db.select({ action: s.auditLog.action }).from(s.auditLog).where(inArray(s.auditLog.entityId, [g, m]))
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["downtime_reason.created", "downtime_reason.updated", "downtime_reason.renamed", "downtime_reason.color"]))
  })

  it("ocultar o grupo oculta os motivos; mostrar de novo devolve", async () => {
    const g = idOf(await salvarGrupo(h.t.db, eng, { name: "Elétrica", category: "unplanned", color: "#F59E0B" }))
    const m = idOf(await salvarMotivo(h.t.db, eng, { parentId: g, name: "Queda de energia" }))
    expect(await definirAtivo(h.t.db, eng, { id: g, active: false })).toEqual({ ok: true, dados: { id: g } })
    expect((await rowsOf([g, m])).every((r) => !r.active)).toBe(true)
    await definirAtivo(h.t.db, eng, { id: g, active: true })
    expect((await rowsOf([g, m])).every((r) => r.active)).toBe(true)
  })

  it("excluir: sem uso é exclusão lógica (e sai do mapa de falhas); já usado só oculta", async () => {
    const g = idOf(await salvarGrupo(h.t.db, eng, { name: "Logística", category: "unplanned", color: "#6366F1" }))
    const livre = idOf(await salvarMotivo(h.t.db, eng, { parentId: g, name: "Falta de embalagem" }))
    const usado = idOf(await salvarMotivo(h.t.db, eng, { parentId: g, name: "Falta de material" }))
    await h.t.db.insert(s.faultCodeMap).values({ organizationId: a.organizationId, machineId: a.m1, faultCode: 47, reasonId: livre })
    await h.t.db.insert(s.machineStateEvent).values({ organizationId: a.organizationId, machineId: a.m1, state: "STOPPED", startedAt: new Date(NOW.getTime() - 3_600_000), reasonId: usado })

    expect(await excluirMotivo(h.t.db, eng, livre)).toEqual({ ok: true, dados: { modo: "excluido" } })
    expect((await rowsOf([livre]))[0]?.deletedAt).not.toBeNull()
    expect(await h.t.db.select().from(s.faultCodeMap).where(eq(s.faultCodeMap.reasonId, livre))).toEqual([])

    expect(await excluirMotivo(h.t.db, eng, usado)).toEqual({ ok: true, dados: { modo: "ocultado" } })
    expect((await rowsOf([usado]))[0]).toMatchObject({ active: false, deletedAt: null })
    // O grupo com um motivo usado também só é ocultado.
    expect(await excluirMotivo(h.t.db, eng, g)).toEqual({ ok: true, dados: { modo: "ocultado" } })
    expect((await rowsOf([g]))[0]).toMatchObject({ active: false, deletedAt: null })
  })

  it("motivo de sistema (Sem comunicação) não é ocultado nem excluído, nem pelo grupo", async () => {
    const g = idOf(await salvarGrupo(h.t.db, eng, { name: "Sistema", category: "unplanned", color: "#6B7280" }))
    const [sys] = await h.t.db
      .insert(s.downtimeReason)
      .values({ organizationId: a.organizationId, parentId: g, name: "Sem comunicação", category: "unplanned", systemKey: "no_comm" })
      .returning({ id: s.downtimeReason.id })
    const id = sys?.id ?? ""
    expect(await definirAtivo(h.t.db, eng, { id, active: false })).toMatchObject({ ok: false })
    expect(await excluirMotivo(h.t.db, eng, id)).toMatchObject({ ok: false })
    expect(await definirAtivo(h.t.db, eng, { id: g, active: false })).toMatchObject({ ok: false })
    expect(await excluirMotivo(h.t.db, eng, g)).toMatchObject({ ok: false })
    expect((await rowsOf([id, g])).every((r) => r.active && r.deletedAt === null)).toBe(true)
  })

  it("nível 3: grupo ou motivo de outro cliente não existem aqui", async () => {
    const engB = await ctxOf(b.slug, superAdmin)
    const gB = idOf(await salvarGrupo(h.t.db, engB, { name: "Só do beta", category: "unplanned", color: "#EF4444" }))
    const mB = idOf(await salvarMotivo(h.t.db, engB, { parentId: gB, name: "Motivo do beta" }))
    expect(await salvarMotivo(h.t.db, eng, { parentId: gB, name: "Intruso" })).toMatchObject({ ok: false })
    expect(await salvarGrupo(h.t.db, eng, { id: gB, name: "Tomado", category: "setup", color: "#000000" })).toMatchObject({ ok: false })
    expect(await definirAtivo(h.t.db, eng, { id: mB, active: false })).toMatchObject({ ok: false })
    expect(await definirCor(h.t.db, eng, { id: gB, color: "#000000" })).toMatchObject({ ok: false })
    expect(await excluirMotivo(h.t.db, eng, mB)).toMatchObject({ ok: false })
    expect((await rowsOf([gB, mB])).map((r) => ({ name: r.name, active: r.active, deleted: r.deletedAt !== null }))).toEqual([
      { name: "Só do beta", active: true, deleted: false },
      { name: "Motivo do beta", active: true, deleted: false },
    ])
  })

  it("entrada inválida e sem config.write", async () => {
    expect(await salvarGrupo(h.t.db, eng, { name: "Cor ruim", category: "unplanned", color: "vermelho" })).toMatchObject({ ok: false })
    expect(await salvarGrupo(h.t.db, eng, { name: "Categoria ruim", category: "perda", color: "#EF4444" })).toMatchObject({ ok: false })
    const admin = await ctxOf(a.slug, a.admin)
    await expect(salvarGrupo(h.t.db, admin, { name: "Do admin", category: "unplanned", color: "#EF4444" })).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(excluirMotivo(h.t.db, admin, a.m1)).rejects.toBeInstanceOf(AccessDeniedError)
  })
})
