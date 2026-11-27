/**
 * Ações do chão no servidor (lib/server/production/floor.ts): classificar parada (L19) e trocar produto
 * (docs/05), com RLS, escopo por máquina, prazo do lançamento atrasado (L3) e auditoria. Também o
 * preenchimento dos minutos sem produto do CLP com o produto apontado (`fillMinuteProducts`).
 */
import * as s from "@engemase/db"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type ProductionActor, ProductionRuleError } from "@/lib/server/production/errors"
import { changeProduct, classifyStop } from "@/lib/server/production/floor"
import { fillMinuteProducts } from "@/lib/server/production/runs"
import { count, createTestDatabase, EXAMPLE_CONFIG, remapIds, type SeededClient, seedClient, type TestDatabase } from "../gateway/support"

const OPERATOR: ProductionActor = { type: "user", id: null, label: "Operador", clientRole: "operator" }
const SUPERVISOR: ProductionActor = { type: "user", id: null, label: "Supervisor", clientRole: "supervisor" }
const ALL = () => true
const NONE = () => false

const NOW = new Date("2026-11-27T15:00:00Z")
const HOUR = 3_600_000

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ProductionRuleError)
  expect((error as ProductionRuleError).code).toBe(code)
}

describe("ações do chão no servidor", () => {
  let t: TestDatabase
  let seq = 0

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  async function freshClient(): Promise<SeededClient> {
    return seedClient(t.db, { slug: `chao-${++seq}`, config: remapIds(EXAMPLE_CONFIG, new Map()) })
  }

  async function reason(c: SeededClient, opts: { active?: boolean } = {}): Promise<string> {
    const [r] = await t.db
      .insert(s.downtimeReason)
      .values({ organizationId: c.organizationId, name: `Motivo ${++seq}`, category: "unplanned", active: opts.active ?? true })
      .returning({ id: s.downtimeReason.id })
    return r?.id ?? ""
  }

  async function stop(c: SeededClient, opts: { state?: "STOPPED" | "FAULT" | "RUNNING"; startedAt?: Date } = {}): Promise<string> {
    const [e] = await t.db
      .insert(s.machineStateEvent)
      .values({
        organizationId: c.organizationId,
        machineId: c.machineIds[0] ?? "",
        state: opts.state ?? "STOPPED",
        startedAt: opts.startedAt ?? new Date(NOW.getTime() - HOUR),
      })
      .returning({ id: s.machineStateEvent.id })
    return e?.id ?? ""
  }

  async function productOf(c: SeededClient, code: string): Promise<string> {
    const [p] = await t.db.insert(s.product).values({ organizationId: c.organizationId, code, name: `Produto ${code}` }).returning({ id: s.product.id })
    return p?.id ?? ""
  }

  describe("classificar parada", () => {
    it("grava o motivo e quem classificou, audita, e o mesmo motivo de novo não duplica nada", async () => {
      const c = await freshClient()
      const r = await reason(c)
      const ev = await stop(c)
      expect(await classifyStop(t.db, { organizationId: c.organizationId, eventId: ev, reasonId: r, actor: OPERATOR, allowMachine: ALL, now: NOW })).toEqual({ late: false })
      const [row] = await t.db.select().from(s.machineStateEvent).where(eq(s.machineStateEvent.id, ev))
      expect(row).toMatchObject({ reasonId: r, classifiedAt: NOW })
      expect(await count(t, "SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'downtime.classified'", [ev])).toBe(1)

      await classifyStop(t.db, { organizationId: c.organizationId, eventId: ev, reasonId: r, actor: OPERATOR, allowMachine: ALL, now: NOW })
      expect(await count(t, "SELECT 1 FROM audit_log WHERE entity_id = $1", [ev])).toBe(1)
    })

    it("vale a última classificação; desfazer tira o motivo; tudo na auditoria (L19)", async () => {
      const c = await freshClient()
      const [r1, r2] = [await reason(c), await reason(c)]
      const ev = await stop(c)
      await classifyStop(t.db, { organizationId: c.organizationId, eventId: ev, reasonId: r1, actor: OPERATOR, allowMachine: ALL, now: NOW })
      await classifyStop(t.db, { organizationId: c.organizationId, eventId: ev, reasonId: r2, actor: SUPERVISOR, allowMachine: ALL, now: NOW })
      expect((await t.db.select().from(s.machineStateEvent).where(eq(s.machineStateEvent.id, ev)))[0]?.reasonId).toBe(r2)
      await classifyStop(t.db, { organizationId: c.organizationId, eventId: ev, reasonId: null, actor: OPERATOR, allowMachine: ALL, now: NOW })
      const [row] = await t.db.select().from(s.machineStateEvent).where(eq(s.machineStateEvent.id, ev))
      expect(row).toMatchObject({ reasonId: null, classifiedAt: null, classifiedBy: null })
      const actions = await t.db.select({ action: s.auditLog.action, before: s.auditLog.before }).from(s.auditLog).where(eq(s.auditLog.entityId, ev))
      expect(actions.map((a) => a.action).sort()).toEqual(["downtime.classified", "downtime.classified", "downtime.unclassified"])
    })

    it("fora do escopo, de outro cliente, motivo de outro cliente ou desativado: não encontrado", async () => {
      const c = await freshClient()
      const other = await freshClient()
      const r = await reason(c)
      const ev = await stop(c)
      await rejects(classifyStop(t.db, { organizationId: c.organizationId, eventId: ev, reasonId: r, actor: OPERATOR, allowMachine: NONE, now: NOW }), "not_found")
      // Evento de outro cliente, visto do cliente c: a RLS esconde.
      const evOther = await stop(other)
      await rejects(classifyStop(t.db, { organizationId: c.organizationId, eventId: evOther, reasonId: r, actor: OPERATOR, allowMachine: ALL, now: NOW }), "not_found")
      await rejects(classifyStop(t.db, { organizationId: c.organizationId, eventId: ev, reasonId: await reason(other), actor: OPERATOR, allowMachine: ALL, now: NOW }), "not_found")
      await rejects(classifyStop(t.db, { organizationId: c.organizationId, eventId: ev, reasonId: await reason(c, { active: false }), actor: OPERATOR, allowMachine: ALL, now: NOW }), "not_found")
      await rejects(classifyStop(t.db, { organizationId: c.organizationId, eventId: "nao-e-uuid", reasonId: r, actor: OPERATOR, allowMachine: ALL, now: NOW }), "not_found")
      expect((await t.db.select().from(s.machineStateEvent).where(eq(s.machineStateEvent.id, ev)))[0]?.reasonId).toBeNull()
    })

    it("só paradas e falhas; prazo do lançamento atrasado vale também aqui", async () => {
      const c = await freshClient()
      const r = await reason(c)
      const running = await stop(c, { state: "RUNNING" })
      await rejects(classifyStop(t.db, { organizationId: c.organizationId, eventId: running, reasonId: r, actor: OPERATOR, allowMachine: ALL, now: NOW }), "invalid_input")
      // Sem turnos cadastrados, o prazo é de 24 h: parada de 3 dias atrás só o supervisor classifica.
      const old = await stop(c, { state: "FAULT", startedAt: new Date(NOW.getTime() - 72 * HOUR) })
      await rejects(classifyStop(t.db, { organizationId: c.organizationId, eventId: old, reasonId: r, actor: OPERATOR, allowMachine: ALL, now: NOW }), "late_entry_deadline")
      expect(await classifyStop(t.db, { organizationId: c.organizationId, eventId: old, reasonId: r, actor: SUPERVISOR, allowMachine: ALL, now: NOW })).toEqual({ late: true })
    })
  })

  describe("trocar produto", () => {
    it("fecha a corrida aberta, abre outra do operador, audita e devolve o produto anterior", async () => {
      const c = await freshClient()
      const machineId = c.machineIds[0] ?? ""
      const [a, b] = [await productOf(c, "A-1"), await productOf(c, "B-2")]
      expect(await changeProduct(t.db, { organizationId: c.organizationId, machineId, productId: a, actor: OPERATOR, allowMachine: ALL, now: NOW })).toEqual({ previousProductId: null })
      const later = new Date(NOW.getTime() + HOUR)
      expect(await changeProduct(t.db, { organizationId: c.organizationId, machineId, productId: b, actor: OPERATOR, allowMachine: ALL, now: later })).toEqual({ previousProductId: a })
      const runs = await t.db.select().from(s.productionRun).where(eq(s.productionRun.machineId, machineId)).orderBy(s.productionRun.startedAt)
      expect(runs.map((r) => ({ code: r.productCode, source: r.source, end: r.endedAt }))).toEqual([
        { code: "A-1", source: "operator", end: later },
        { code: "B-2", source: "operator", end: null },
      ])
      expect(await count(t, "SELECT 1 FROM audit_log WHERE action = 'production_run.operator_change' AND organization_id = $1", [c.organizationId])).toBe(2)
      // Mesmo produto de novo: nada muda.
      await changeProduct(t.db, { organizationId: c.organizationId, machineId, productId: b, actor: OPERATOR, allowMachine: ALL, now: new Date(later.getTime() + HOUR) })
      expect(await count(t, "SELECT 1 FROM production_run WHERE machine_id = $1", [machineId])).toBe(2)
    })

    it("produto ou máquina de outro cliente, ou máquina fora do escopo: não encontrado", async () => {
      const c = await freshClient()
      const other = await freshClient()
      const machineId = c.machineIds[0] ?? ""
      const mine = await productOf(c, "C-3")
      await rejects(changeProduct(t.db, { organizationId: c.organizationId, machineId, productId: await productOf(other, "X-9"), actor: OPERATOR, allowMachine: ALL, now: NOW }), "not_found")
      await rejects(changeProduct(t.db, { organizationId: c.organizationId, machineId: other.machineIds[0] ?? "", productId: mine, actor: OPERATOR, allowMachine: ALL, now: NOW }), "not_found")
      await rejects(changeProduct(t.db, { organizationId: c.organizationId, machineId, productId: mine, actor: OPERATOR, allowMachine: NONE, now: NOW }), "not_found")
      expect(await count(t, "SELECT 1 FROM production_run WHERE organization_id = $1", [c.organizationId])).toBe(0)
      const audit = await t.db.select().from(s.auditLog).where(and(eq(s.auditLog.organizationId, c.organizationId), eq(s.auditLog.action, "production_run.operator_change")))
      expect(audit).toEqual([])
    })
  })

  describe("minutos sem produto do CLP", () => {
    it("recebem o produto da corrida que valia no início do minuto; os do CLP ficam como estão", () => {
      const m = (start: number, productCode: string | null) => ({ start, total: 1, reject: 0, productCode })
      const runs = [
        { start: 100, end: 200, productCode: "A" },
        { start: 200, end: null, productCode: "B" },
      ]
      expect(fillMinuteProducts([m(50, null), m(100, null), m(150, "CLP"), m(199, null), m(200, null), m(900, null)], runs).map((x) => x.productCode)).toEqual([
        null,
        "A",
        "CLP",
        "A",
        "B",
        "B",
      ])
      expect(fillMinuteProducts([m(10, null)], [])).toEqual([m(10, null)])
    })
  })
})
