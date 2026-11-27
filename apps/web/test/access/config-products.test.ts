/**
 * Cadastro de produtos e ciclos ideais (lib/server/config/products.ts): só `config.write` (equipe Engemase,
 * D12), RLS por cliente (nível 3: ids de outro cliente não existem aqui), código único, exclusão lógica e
 * auditoria.
 */
import * as s from "@engemase/db"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import { excluirProduto, salvarMatrizCiclos, salvarProduto } from "@/lib/server/config/products"
import { type AuthHarness, createAuthHarness } from "../auth/support"
import { createPerson, type SeededClient, type SeededPerson, seedClient } from "./support"

const NOW = new Date("2026-11-27T15:00:00Z")

describe("cadastro de produtos e ciclos ideais", () => {
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

  async function cyclesOf(productId: string): Promise<Record<string, number>> {
    const rows = await h.t.db.select().from(s.productMachine).where(eq(s.productMachine.productId, productId))
    return Object.fromEntries(rows.map((r) => [r.machineId, Number(r.idealCycleS)]))
  }

  beforeAll(async () => {
    h = await createAuthHarness({ now: () => NOW })
    a = await seedClient(h.t.db, "alfa-produtos")
    b = await seedClient(h.t.db, "beta-produtos")
    superAdmin = await createPerson(h.t.db, "super-produtos", { role: "super_admin", twoFactor: true })
    eng = await ctxOf(a.slug, superAdmin)
  }, 60_000)

  afterAll(async () => {
    await h.t.client.close()
  })

  it("cadastra e altera com ciclos por máquina, auditado; código repetido vira mensagem", async () => {
    const r = await salvarProduto(h.t.db, eng, { code: " TP-38 ", name: "Tampa 38 mm", cycles: { [a.m1]: 22, [a.m2]: 18.5 } })
    expect(r.ok).toBe(true)
    const id = r.ok ? r.dados.id : ""
    expect(await cyclesOf(id)).toEqual({ [a.m1]: 22, [a.m2]: 18.5 })
    const [p] = await h.t.db.select().from(s.product).where(eq(s.product.id, id))
    expect(p).toMatchObject({ code: "TP-38", name: "Tampa 38 mm", organizationId: a.organizationId })

    expect(await salvarProduto(h.t.db, eng, { id, code: "TP-38", name: "Tampa 38 mm azul", cycles: { [a.m3]: 30 } })).toEqual({ ok: true, dados: { id } })
    expect(await cyclesOf(id)).toEqual({ [a.m3]: 30 })

    const dup = await salvarProduto(h.t.db, eng, { code: "TP-38", name: "Outro", cycles: {} })
    expect(dup).toEqual({ ok: false, mensagem: 'Já existe um produto com o código "TP-38".' })

    const actions = await h.t.db.select({ action: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.entityId, id))
    expect(actions.map((x) => x.action).sort()).toEqual(["product.created", "product.updated"])
  })

  it("entrada inválida: sem código, ciclo zero ou negativo, máquina que não é uuid", async () => {
    expect(await salvarProduto(h.t.db, eng, { code: "", name: "Sem código", cycles: {} })).toMatchObject({ ok: false })
    expect(await salvarProduto(h.t.db, eng, { code: "X", name: "Ciclo zero", cycles: { [a.m1]: 0 } })).toMatchObject({ ok: false })
    expect(await salvarProduto(h.t.db, eng, { code: "X", name: "Ciclo negativo", cycles: { [a.m1]: -3 } })).toMatchObject({ ok: false })
    expect(await salvarProduto(h.t.db, eng, { code: "X", name: "Máquina estranha", cycles: { "m1": 10 } })).toMatchObject({ ok: false })
    expect(await h.t.db.select().from(s.product).where(and(eq(s.product.organizationId, a.organizationId), eq(s.product.code, "X")))).toEqual([])
  })

  it("nível 3: máquina ou produto de outro cliente não existem aqui", async () => {
    expect(await salvarProduto(h.t.db, eng, { code: "B-1", name: "Máquina de outro cliente", cycles: { [b.m1]: 10 } })).toMatchObject({
      ok: false,
      mensagem: "Máquina não encontrada. Atualize a página.",
    })
    expect(await salvarProduto(h.t.db, eng, { code: "DEL", name: "Máquina excluída", cycles: { [a.mDeleted]: 10 } })).toMatchObject({ ok: false })

    const engB = await ctxOf(b.slug, superAdmin)
    const doB = await salvarProduto(h.t.db, engB, { code: "SO-B", name: "Só do beta", cycles: {} })
    const idB = doB.ok ? doB.dados.id : ""
    expect(await salvarProduto(h.t.db, eng, { id: idB, code: "SO-B", name: "Tentativa", cycles: {} })).toMatchObject({ ok: false })
    expect(await salvarMatrizCiclos(h.t.db, eng, { products: { [idB]: { [a.m1]: 5 } } })).toMatchObject({ ok: false })
    expect(await excluirProduto(h.t.db, eng, idB)).toMatchObject({ ok: false })
    const [still] = await h.t.db.select().from(s.product).where(eq(s.product.id, idB))
    expect(still).toMatchObject({ name: "Só do beta", deletedAt: null })
  })

  it("matriz de ciclos troca os ciclos dos produtos listados", async () => {
    const r1 = await salvarProduto(h.t.db, eng, { code: "MZ-1", name: "Matriz 1", cycles: { [a.m1]: 10 } })
    const r2 = await salvarProduto(h.t.db, eng, { code: "MZ-2", name: "Matriz 2", cycles: {} })
    const [p1, p2] = [r1.ok ? r1.dados.id : "", r2.ok ? r2.dados.id : ""]
    expect(await salvarMatrizCiclos(h.t.db, eng, { products: { [p1]: { [a.m2]: 12 }, [p2]: { [a.m1]: 9, [a.m3]: 40 } } })).toEqual({ ok: true, dados: { produtos: 2 } })
    expect(await cyclesOf(p1)).toEqual({ [a.m2]: 12 })
    expect(await cyclesOf(p2)).toEqual({ [a.m1]: 9, [a.m3]: 40 })
  })

  it("excluir é lógico, libera o código e é auditado", async () => {
    const r = await salvarProduto(h.t.db, eng, { code: "EX-1", name: "Para excluir", cycles: { [a.m1]: 10 } })
    const id = r.ok ? r.dados.id : ""
    expect(await excluirProduto(h.t.db, eng, id)).toEqual({ ok: true, dados: { id } })
    const [p] = await h.t.db.select().from(s.product).where(eq(s.product.id, id))
    expect(p?.deletedAt).not.toBeNull()
    expect(await excluirProduto(h.t.db, eng, id)).toMatchObject({ ok: false })
    expect((await salvarProduto(h.t.db, eng, { code: "EX-1", name: "Reaproveita o código", cycles: {} })).ok).toBe(true)
    expect(await h.t.db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, id), eq(s.auditLog.action, "product.deleted")))).toHaveLength(1)
  })

  it("sem config.write (admin do cliente): recusado antes de ler qualquer coisa", async () => {
    const admin = await ctxOf(a.slug, a.admin)
    await expect(salvarProduto(h.t.db, admin, { code: "ADM", name: "Do admin", cycles: {} })).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(salvarMatrizCiclos(h.t.db, admin, { products: {} })).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(excluirProduto(h.t.db, admin, a.m1)).rejects.toBeInstanceOf(AccessDeniedError)
  })
})
