/**
 * Operadores do chão (lib/server/terminal/operators.ts) e o operador escolhido no tablet indo para os
 * apontamentos (floor-actions com contexto de terminal): cadastro só `config.write`, matrícula única na
 * unidade, RLS por cliente, desativado sai da lista e é recusado, operador de outra unidade é recusado, a
 * pessoa logada não "assina" por outro operador.
 */
import * as s from "@engemase/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import { changeProduct, classifyStop, launchReject } from "@/lib/server/production/floor-actions"
import { definirOperadorAtivo, listarOperadores, operadoresDaUnidade, salvarOperador } from "@/lib/server/terminal/operators"
import { criarTerminal, parearAparelho, type TerminalSession, terminalContext } from "@/lib/server/terminal/terminals"
import { type AuthHarness, createAuthHarness } from "../auth/support"
import { createPerson, type SeededClient, type SeededPerson, seedClient } from "./support"

describe("operadores do chão", () => {
  let h: AuthHarness
  let a: SeededClient
  let b: SeededClient
  let superAdmin: SeededPerson
  let eng: TenantContext
  let engB: TenantContext
  let admin: TenantContext
  let tablet: TerminalSession

  async function ctxOf(slug: string, person: SeededPerson): Promise<TenantContext> {
    const d = await loadTenantContext(h.t.db, { slug, user: person.user, sessionId: person.sessionId, now: new Date() })
    if (!d.ok) throw new Error(d.reason)
    return d.context
  }

  async function novo(ctx: TenantContext, input: Record<string, unknown>): Promise<string> {
    const r = await salvarOperador(h.t.db, ctx, input)
    if (!r.ok) throw new Error(r.mensagem)
    return r.dados.id
  }

  beforeAll(async () => {
    h = await createAuthHarness()
    a = await seedClient(h.t.db, "alfa-operadores")
    b = await seedClient(h.t.db, "beta-operadores")
    superAdmin = await createPerson(h.t.db, "super-operadores", { role: "super_admin", twoFactor: true })
    eng = await ctxOf(a.slug, superAdmin)
    engB = await ctxOf(b.slug, superAdmin)
    admin = await ctxOf(a.slug, a.admin)
    const t = await criarTerminal(h.t.db, eng, { name: "Tablet M1", kind: "operator_tablet", unitId: a.unit1, machineIds: [a.m1] })
    if (!t.ok) throw new Error(t.mensagem)
    const p = await parearAparelho(h.t.db, t.dados.code, { ip: "10.2.0.1" })
    const session = await terminalContext(h.t.db, p.ok ? p.token : "")
    if (session === null) throw new Error("terminal sem contexto")
    tablet = session
  }, 60_000)

  afterAll(async () => {
    await h.t.client.close()
  })

  it("cadastra, altera e desativa com auditoria; matrícula repetida na unidade vira mensagem", async () => {
    const id = await novo(eng, { unitId: a.unit1, name: "  Ana Souza ", employeeCode: "1042" })
    expect(await salvarOperador(h.t.db, eng, { unitId: a.unit1, name: "Outra Ana", employeeCode: "1042" })).toEqual({
      ok: false,
      mensagem: 'Já existe um operador com a matrícula "1042" nesta unidade.',
    })
    // Mesma matrícula em outra unidade pode.
    expect((await salvarOperador(h.t.db, eng, { unitId: a.unit2, name: "Ana da unidade 2", employeeCode: "1042" })).ok).toBe(true)
    expect(await salvarOperador(h.t.db, eng, { id, unitId: a.unit1, name: "Ana Paula Souza", employeeCode: "" })).toEqual({ ok: true, dados: { id } })
    const [row] = await h.t.db.select().from(s.unitOperator).where(eq(s.unitOperator.id, id))
    expect(row).toMatchObject({ name: "Ana Paula Souza", employeeCode: null, organizationId: a.organizationId, active: true })

    expect(await definirOperadorAtivo(h.t.db, eng, { id, active: false })).toEqual({ ok: true, dados: { id } })
    expect((await operadoresDaUnidade(h.t.db, tablet.ctx, a.unit1)).map((o) => o.id)).not.toContain(id)
    expect((await listarOperadores(h.t.db, eng)).find((o) => o.id === id)?.active).toBe(false)

    const actions = await h.t.db.select({ action: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.entityId, id))
    expect(actions.map((x) => x.action).sort()).toEqual(["unit_operator.created", "unit_operator.disabled", "unit_operator.updated"])
  })

  it("entrada inválida e permissões: sem nome; admin do cliente não cadastra (D12)", async () => {
    expect(await salvarOperador(h.t.db, eng, { unitId: a.unit1, name: "A" })).toEqual({ ok: false, mensagem: "Informe o nome do operador." })
    expect(await salvarOperador(h.t.db, eng, { unitId: "x", name: "Sem unidade" })).toMatchObject({ ok: false })
    await expect(salvarOperador(h.t.db, admin, { unitId: a.unit1, name: "Do admin" })).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(definirOperadorAtivo(h.t.db, admin, { id: a.unit1, active: false })).rejects.toBeInstanceOf(AccessDeniedError)
  })

  it("nível 3: unidade e operador de outro cliente não existem aqui", async () => {
    expect(await salvarOperador(h.t.db, eng, { unitId: b.unit1, name: "Unidade de outro cliente" })).toEqual({
      ok: false,
      mensagem: "Unidade não encontrada. Atualize a página.",
    })
    const idB = await novo(engB, { unitId: b.unit1, name: "Operador do Beta" })
    expect(await definirOperadorAtivo(h.t.db, eng, { id: idB, active: false })).toMatchObject({ ok: false })
    expect(await salvarOperador(h.t.db, eng, { id: idB, unitId: b.unit1, name: "Invadido" })).toMatchObject({ ok: false })
    expect((await listarOperadores(h.t.db, eng)).map((o) => o.id)).not.toContain(idB)
    expect(await operadoresDaUnidade(h.t.db, tablet.ctx, b.unit1)).toEqual([])
  })

  it("tablet: o operador escolhido vai para refugo, parada e troca de produto", async () => {
    const op = await novo(eng, { unitId: a.unit1, name: "Carlos Lima", employeeCode: "1057" })
    expect((await operadoresDaUnidade(h.t.db, tablet.ctx, a.unit1)).map((o) => o.name)).toContain("Carlos Lima")

    const r = await launchReject(h.t.db, tablet.ctx, { machineId: a.m1, quantity: 2, rejectReasonId: null, productCode: null, operatorId: op })
    expect(r.status).toBe("ok")
    const [q] = await h.t.db.select().from(s.qualityEntry).where(eq(s.qualityEntry.id, r.status === "ok" ? r.data.id : ""))
    expect(q?.operatorId).toBe(op)

    const [reason] = await h.t.db.insert(s.downtimeReason).values({ organizationId: a.organizationId, name: "Ajuste", category: "unplanned" }).returning()
    const [ev] = await h.t.db
      .insert(s.machineStateEvent)
      .values({ organizationId: a.organizationId, machineId: a.m1, state: "STOPPED", startedAt: new Date(Date.now() - 1_800_000) })
      .returning()
    expect((await classifyStop(h.t.db, tablet.ctx, { eventId: ev?.id, reasonId: reason?.id, operatorId: op })).status).toBe("ok")
    const [e] = await h.t.db.select().from(s.machineStateEvent).where(eq(s.machineStateEvent.id, ev?.id ?? ""))
    expect(e?.classifiedOperatorId).toBe(op)

    const [p] = await h.t.db.insert(s.product).values({ organizationId: a.organizationId, code: "OP-1", name: "Frasco" }).returning()
    expect((await changeProduct(h.t.db, tablet.ctx, { machineId: a.m1, productId: p?.id, operatorId: op })).status).toBe("ok")
    const [run] = await h.t.db.select().from(s.productionRun).where(eq(s.productionRun.productId, p?.id ?? ""))
    expect(run?.operatorId).toBe(op)
  })

  it("tablet: operador desativado, de outra unidade ou de outro cliente é recusado", async () => {
    const off = await novo(eng, { unitId: a.unit1, name: "Desligado" })
    await definirOperadorAtivo(h.t.db, eng, { id: off, active: false })
    const outraUnidade = await novo(eng, { unitId: a.unit2, name: "Da unidade 2" })
    const outroCliente = await novo(engB, { unitId: b.unit1, name: "Do Beta" })
    const [p] = await h.t.db.insert(s.product).values({ organizationId: a.organizationId, code: "OP-2", name: "Pote" }).returning()
    for (const operatorId of [off, outraUnidade, outroCliente]) {
      const r = await changeProduct(h.t.db, tablet.ctx, { machineId: a.m1, productId: p?.id, operatorId })
      expect(r).toEqual({ status: "error", message: "Operador não encontrado ou desativado. Escolha de novo quem está operando." })
      const q = await launchReject(h.t.db, tablet.ctx, { machineId: a.m1, quantity: 1, rejectReasonId: null, productCode: null, operatorId })
      expect(q.status).toBe("error")
    }
  })

  it("pessoa logada: o operatorId enviado é ignorado (quem aponta é ela mesma)", async () => {
    const op = await novo(eng, { unitId: a.unit1, name: "Não sou eu" })
    const sup = await ctxOf(a.slug, a.supervisorUnit1)
    const r = await launchReject(h.t.db, sup, { machineId: a.m1, quantity: 1, rejectReasonId: null, productCode: null, operatorId: op })
    expect(r.status).toBe("ok")
    const [q] = await h.t.db.select().from(s.qualityEntry).where(eq(s.qualityEntry.id, r.status === "ok" ? r.data.id : ""))
    expect(q?.operatorId).toBeNull()
  })
})
