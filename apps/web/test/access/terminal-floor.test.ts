/**
 * Ações do chão pelo tablet pareado (lib/server/production/floor-actions.ts com o contexto do terminal):
 * escopo = as máquinas do terminal, ator "terminal" na auditoria, TV só lê.
 */
import * as s from "@engemase/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import { changeProduct, classifyStop, launchReject, undoReject } from "@/lib/server/production/floor-actions"
import { criarTerminal, parearAparelho, type TerminalSession, terminalContext } from "@/lib/server/terminal/terminals"
import { type AuthHarness, createAuthHarness } from "../auth/support"
import { createPerson, type SeededClient, type SeededPerson, seedClient } from "./support"

describe("ações do chão pelo terminal pareado", () => {
  let h: AuthHarness
  let a: SeededClient
  let superAdmin: SeededPerson
  let eng: TenantContext
  let tablet: TerminalSession
  let tv: TerminalSession
  let ip = 0

  async function parear(input: Record<string, unknown>): Promise<TerminalSession> {
    const t = await criarTerminal(h.t.db, eng, input)
    if (!t.ok) throw new Error(t.mensagem)
    const p = await parearAparelho(h.t.db, t.dados.code, { ip: `10.1.0.${++ip}` })
    const session = await terminalContext(h.t.db, p.ok ? p.token : "")
    if (session === null) throw new Error("terminal sem contexto")
    return session
  }

  beforeAll(async () => {
    h = await createAuthHarness()
    a = await seedClient(h.t.db, "alfa-tablet")
    superAdmin = await createPerson(h.t.db, "super-tablet", { role: "super_admin", twoFactor: true })
    const d = await loadTenantContext(h.t.db, { slug: a.slug, user: superAdmin.user, sessionId: superAdmin.sessionId, now: new Date() })
    if (!d.ok) throw new Error(d.reason)
    eng = d.context
    tablet = await parear({ name: "Tablet M1", kind: "operator_tablet", unitId: a.unit1, machineIds: [a.m1] })
    tv = await parear({ name: "TV Linha A", kind: "andon_tv", unitId: a.unit1, lineIds: [a.line1] })
  }, 60_000)

  afterAll(async () => {
    await h.t.client.close()
  })

  it("tablet: refugo, estorno, classificação e troca de produto na máquina dele, com ator terminal", async () => {
    const r = await launchReject(h.t.db, tablet.ctx, { machineId: a.m1, quantity: 3, rejectReasonId: null, productCode: null })
    expect(r.status).toBe("ok")
    const entryId = r.status === "ok" ? r.data.id : ""
    expect((await undoReject(h.t.db, tablet.ctx, entryId)).status).toBe("ok")

    const [reason] = await h.t.db.insert(s.downtimeReason).values({ organizationId: a.organizationId, name: "Falta de material", category: "unplanned" }).returning()
    const [ev] = await h.t.db
      .insert(s.machineStateEvent)
      .values({ organizationId: a.organizationId, machineId: a.m1, state: "STOPPED", startedAt: new Date(Date.now() - 3_600_000) })
      .returning()
    expect(await classifyStop(h.t.db, tablet.ctx, { eventId: ev?.id, reasonId: reason?.id })).toEqual({ status: "ok", data: { late: false } })

    const [p] = await h.t.db.insert(s.product).values({ organizationId: a.organizationId, code: "T-1", name: "Tampa" }).returning()
    expect((await changeProduct(h.t.db, tablet.ctx, { machineId: a.m1, productId: p?.id })).status).toBe("ok")

    const audit = await h.t.db.select({ action: s.auditLog.action, actorType: s.auditLog.actorType, actorId: s.auditLog.actorId }).from(s.auditLog).where(eq(s.auditLog.actorId, tablet.terminal.id))
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["quality_entry.created", "downtime.classified", "production_run.operator_change"]))
    expect(audit.every((x) => x.actorType === "terminal")).toBe(true)
  })

  it("tablet: máquina fora do terminal não existe para ele", async () => {
    const r = await launchReject(h.t.db, tablet.ctx, { machineId: a.m2, quantity: 1, rejectReasonId: null, productCode: null })
    expect(r).toEqual({ status: "error", message: "Máquina não encontrada." })
    const [p] = await h.t.db.insert(s.product).values({ organizationId: a.organizationId, code: "T-2", name: "Pote" }).returning()
    expect((await changeProduct(h.t.db, tablet.ctx, { machineId: a.m2, productId: p?.id })).status).toBe("error")
  })

  it("TV: só consulta, nenhuma ação do chão", async () => {
    const r = await launchReject(h.t.db, tv.ctx, { machineId: a.m1, quantity: 1, rejectReasonId: null, productCode: null })
    expect(r).toEqual({ status: "error", message: "Este acesso não faz apontamentos (só consulta)." })
  })
})
