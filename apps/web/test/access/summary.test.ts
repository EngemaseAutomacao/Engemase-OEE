/**
 * Isolamento de NÍVEL 4 (docs/15 §4 item 7; D11): agregados, exportação (CSV), alertas e auditoria com escopo
 * por cliente, por unidade e por máquina, contra o PGlite com a RLS. Quem vê só a Unidade 1 nunca soma a
 * Unidade 2; quem vê só a máquina m3 vê a linha e a unidade somando só m3; nada do cliente B aparece.
 */
import * as s from "@engemase/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import { listAuditEntries, openAlertCounts, productionCsv, productionTotals, SummaryRangeError } from "@/lib/server/access/summary"
import {
  assignFieldEngineer,
  createPerson,
  createTestDatabase,
  type SeededClient,
  type SeededPerson,
  seedClient,
  type TestDatabase,
} from "./support"

const NOW = new Date("2026-11-24T15:00:00Z")
const FROM = new Date("2026-11-24T00:00:00Z")
const RANGE = { from: FROM, to: NOW }

/** Peças por minuto de cada máquina (valores diferentes para conferir as somas). */
const PIECES = { m1: 1, m2: 10, m3: 100, mDeleted: 1000 } as const
const MINUTES = 3

describe("agregados e auditoria com escopo (nível 4)", () => {
  let t: TestDatabase
  let a: SeededClient
  let b: SeededClient
  let fieldUnit2: SeededPerson

  async function ctxOf(client: SeededClient, person: SeededPerson): Promise<TenantContext> {
    const decision = await loadTenantContext(t.db, { slug: client.slug, user: person.user, sessionId: person.sessionId, now: NOW })
    if (!decision.ok) throw new Error(`sem acesso: ${decision.reason}`)
    return decision.context
  }

  async function produce(client: SeededClient): Promise<void> {
    for (const key of ["m1", "m2", "m3", "mDeleted"] as const) {
      for (let i = 0; i < MINUTES; i++) {
        await t.db.insert(s.productionMinute).values({
          organizationId: client.organizationId,
          machineId: client[key],
          bucketStart: new Date(FROM.getTime() + (60 + i) * 60_000),
          runS: 60,
          stopS: 0,
          faultS: 0,
          noCommS: 0,
          total: PIECES[key],
          reject: 0,
        })
      }
    }
  }

  beforeAll(async () => {
    t = await createTestDatabase()
    a = await seedClient(t.db, "alfa")
    b = await seedClient(t.db, "beta")
    await produce(a)
    await produce(b)

    // Alertas: um por máquina (m1 e m3) e um de gateway (sem máquina) em A; um em B.
    const rule = async (client: SeededClient) => {
      const [r] = await t.db
        .insert(s.alertRule)
        .values({ organizationId: client.organizationId, name: "Teste", type: "gateway_offline", systemKey: "gateway_offline", severity: "critical" })
        .returning()
      return r?.id ?? ""
    }
    const ruleA = await rule(a)
    const ruleB = await rule(b)
    for (const [org, ruleId, machineId, key] of [
      [a.organizationId, ruleA, a.m1, "a-m1"],
      [a.organizationId, ruleA, a.m3, "a-m3"],
      [a.organizationId, ruleA, null, "a-gw"],
      [b.organizationId, ruleB, b.m1, "b-m1"],
    ] as const) {
      await t.db.insert(s.alertEvent).values({ organizationId: org, ruleId, machineId, dedupKey: key, severity: "critical", openedAt: NOW, lastSeenAt: NOW })
    }

    // Auditoria: do cliente todo, da unidade 1, da unidade 2, da máquina m3; e uma de B.
    const audit = (organizationId: string, action: string, extra: Partial<typeof s.auditLog.$inferInsert> = {}) =>
      t.db.insert(s.auditLog).values({ organizationId, actorType: "user", action, at: NOW, ...extra })
    await audit(a.organizationId, "user.invite")
    await audit(a.organizationId, "unit1.change", { unitId: a.unit1 })
    await audit(a.organizationId, "unit2.change", { unitId: a.unit2 })
    await audit(a.organizationId, "m3.change", { entityType: "machine", entityId: a.m3, unitId: a.unit2 })
    await audit(b.organizationId, "b.change", { unitId: b.unit1 })

    fieldUnit2 = await createPerson(t.db, "campo-u2", { role: "field_engineer", twoFactor: true })
    await assignFieldEngineer(t.db, a.organizationId, fieldUnit2, NOW, { unitIds: [a.unit2] })
  })

  afterAll(async () => {
    await t.client.close()
  })

  it("cliente inteiro: soma todas as máquinas de A (inclusive histórico de máquina excluída) e nada de B", async () => {
    const ctx = await ctxOf(a, a.viewerAll)
    const [total] = await productionTotals(t.db, ctx, RANGE, "total")
    expect(total?.total).toBe(MINUTES * (PIECES.m1 + PIECES.m2 + PIECES.m3 + PIECES.mDeleted))
    const machines = await productionTotals(t.db, ctx, RANGE, "machine")
    expect(machines.map((m) => m.id).sort()).toEqual([a.m1, a.m2, a.m3, a.mDeleted].sort())
  })

  it("escopo por unidade: total, linhas e unidades só com a Unidade 1", async () => {
    const ctx = await ctxOf(a, a.supervisorUnit1)
    const [total] = await productionTotals(t.db, ctx, RANGE, "total")
    expect(total?.total).toBe(MINUTES * (PIECES.m1 + PIECES.m2 + PIECES.mDeleted))
    expect((await productionTotals(t.db, ctx, RANGE, "unit")).map((u) => u.id)).toEqual([a.unit1])
    expect((await productionTotals(t.db, ctx, RANGE, "line")).map((l) => l.id)).toEqual([a.line1])
    expect((await productionTotals(t.db, ctx, RANGE, "machine")).map((m) => m.id)).not.toContain(a.m3)
  })

  it("escopo por máquina: a linha e a unidade somam só a máquina permitida", async () => {
    const ctx = await ctxOf(a, a.operatorM3)
    const units = await productionTotals(t.db, ctx, RANGE, "unit")
    expect(units).toEqual([expect.objectContaining({ id: a.unit2, total: MINUTES * PIECES.m3, minutes: MINUTES })])
    const lines = await productionTotals(t.db, ctx, RANGE, "line")
    expect(lines).toEqual([expect.objectContaining({ id: a.line2, total: MINUTES * PIECES.m3 })])
  })

  it("exportação CSV segue o mesmo escopo (sem máquina de outra unidade nem de B)", async () => {
    const csv = await productionCsv(t.db, await ctxOf(a, a.supervisorUnit1), RANGE)
    const rows = csv.split("\r\n")
    expect(rows[0]).toContain("Máquina")
    expect(rows.slice(1).map((r) => r.split(";")[0]).sort()).toEqual(["Injetora 01", "Injetora 02", "Injetora antiga"])
    expect(csv).not.toContain("Sopradora")

    const operatorCsv = await productionCsv(t.db, await ctxOf(a, a.operatorM3), RANGE)
    expect(operatorCsv.split("\r\n").slice(1)).toEqual([`Sopradora 03;${MINUTES};${MINUTES * 60};0;0;0;0;${MINUTES * PIECES.m3};0`])
  })

  it("o cliente B nunca aparece para A (e vice-versa)", async () => {
    const [totalB] = await productionTotals(t.db, await ctxOf(b, b.viewerAll), RANGE, "total")
    expect(totalB?.total).toBe(MINUTES * (PIECES.m1 + PIECES.m2 + PIECES.m3 + PIECES.mDeleted))
    const machinesA = await productionTotals(t.db, await ctxOf(a, a.viewerAll), RANGE, "machine")
    for (const id of [b.m1, b.m2, b.m3]) expect(machinesA.map((m) => m.id)).not.toContain(id)
  })

  it("período inválido é recusado; sem permissão de leitura também", async () => {
    const ctx = await ctxOf(a, a.viewerAll)
    await expect(productionTotals(t.db, ctx, { from: NOW, to: FROM }, "total")).rejects.toBeInstanceOf(SummaryRangeError)
    await expect(
      productionTotals(t.db, ctx, { from: new Date("2024-01-01T00:00:00Z"), to: NOW }, "total"),
    ).rejects.toBeInstanceOf(SummaryRangeError)
    await expect(listAuditEntries(t.db, ctx)).rejects.toBeInstanceOf(AccessDeniedError)
  })

  it("alertas abertos: cliente inteiro vê os 3 de A; escopo por máquina vê só o da máquina dele (sem o de gateway)", async () => {
    expect(await openAlertCounts(t.db, await ctxOf(a, a.viewerAll))).toEqual({ critical: 3, warning: 0, info: 0 })
    expect(await openAlertCounts(t.db, await ctxOf(a, a.operatorM3))).toEqual({ critical: 1, warning: 0, info: 0 })
    expect(await openAlertCounts(t.db, await ctxOf(a, a.supervisorUnit1))).toEqual({ critical: 1, warning: 0, info: 0 })
  })

  it("auditoria: admin vê tudo de A; engenheiro de campo restrito à Unidade 2 vê só os registros dela", async () => {
    const all = await listAuditEntries(t.db, await ctxOf(a, a.admin))
    expect(all.map((e) => e.action)).toEqual(expect.arrayContaining(["user.invite", "unit1.change", "unit2.change", "m3.change"]))
    expect(all.map((e) => e.action)).not.toContain("b.change")
    const scoped = await listAuditEntries(t.db, await ctxOf(a, fieldUnit2))
    expect(scoped.map((e) => e.action).filter((x) => x !== "engemase.access").sort()).toEqual(["m3.change", "unit2.change"])
  })
})
