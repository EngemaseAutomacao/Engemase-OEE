/**
 * Cadastro de turnos e paradas planejadas (lib/server/config/shifts.ts): tradução dos dias da tela, regras da
 * L2 (sem sobreposição), exclusão lógica, paradas em horário local da unidade (uma linha por máquina), motivo
 * planejado, turnos consolidados marcados para recálculo, RLS por cliente (nível 3) e `config.write`.
 */
import * as s from "@engemase/db"
import { and, eq, isNull } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import { cancelarParada, excluirTurno, salvarParada, salvarTurno } from "@/lib/server/config/shifts"
import { type AuthHarness, createAuthHarness } from "../auth/support"
import { createPerson, type SeededClient, type SeededPerson, seedClient } from "./support"

const NOW = new Date("2026-11-27T15:00:00Z")
const MANHA = { name: "1º turno", start: "06:00", end: "14:00", days: [1, 2, 3, 4, 5, 6], breaks: [{ name: "Refeição", start: "10:00", end: "10:30" }] }

describe("cadastro de turnos e paradas planejadas", () => {
  let h: AuthHarness
  let a: SeededClient
  let b: SeededClient
  let superAdmin: SeededPerson
  let eng: TenantContext
  let planned: string
  let unplanned: string

  async function ctxOf(slug: string, person: SeededPerson): Promise<TenantContext> {
    const decision = await loadTenantContext(h.t.db, { slug, user: person.user, sessionId: person.sessionId, now: NOW })
    if (!decision.ok) throw new Error(`sem acesso: ${decision.reason}`)
    return decision.context
  }

  async function reason(c: SeededClient, category: "planned" | "unplanned"): Promise<string> {
    const [g] = await h.t.db.insert(s.downtimeReason).values({ organizationId: c.organizationId, name: `Grupo ${category}`, category }).returning()
    const [r] = await h.t.db.insert(s.downtimeReason).values({ organizationId: c.organizationId, parentId: g?.id, name: `Motivo ${category}`, category }).returning()
    return r?.id ?? ""
  }

  beforeAll(async () => {
    h = await createAuthHarness({ now: () => NOW })
    a = await seedClient(h.t.db, "alfa-turnos")
    b = await seedClient(h.t.db, "beta-turnos")
    superAdmin = await createPerson(h.t.db, "super-turnos", { role: "super_admin", twoFactor: true })
    eng = await ctxOf(a.slug, superAdmin)
    planned = await reason(a, "planned")
    unplanned = await reason(a, "unplanned")
  }, 60_000)

  afterAll(async () => {
    await h.t.client.close()
  })

  describe("turnos", () => {
    it("grava com os dias em ISO (domingo = 7), recusa sobreposição e exclui de forma lógica", async () => {
      const r = await salvarTurno(h.t.db, eng, { unitId: a.unit1, ...MANHA, days: [0, 1, 2] })
      expect(r.ok).toBe(true)
      const id = r.ok ? r.dados.id : ""
      const [row] = await h.t.db.select().from(s.shift).where(eq(s.shift.id, id))
      expect(row?.daysOfWeek).toEqual([1, 2, 7])
      expect(row?.breaks).toEqual([{ start: "10:00", end: "10:30", name: "Refeição" }])

      const overlap = await salvarTurno(h.t.db, eng, { unitId: a.unit1, ...MANHA, name: "Cópia", days: [1] })
      expect(overlap).toMatchObject({ ok: false })
      expect(overlap.ok ? "" : overlap.mensagem).toContain("1º turno")

      expect(await excluirTurno(h.t.db, eng, id)).toEqual({ ok: true, dados: { id } })
      expect((await h.t.db.select().from(s.shift).where(eq(s.shift.id, id)))[0]?.deletedAt).not.toBeNull()
      // Excluído, não atrapalha um turno novo no mesmo horário.
      expect((await salvarTurno(h.t.db, eng, { unitId: a.unit1, ...MANHA, name: "Novo 1º turno" })).ok).toBe(true)
    })

    it("nível 3: unidade ou turno de outro cliente não existem aqui", async () => {
      expect(await salvarTurno(h.t.db, eng, { unitId: b.unit1, ...MANHA })).toMatchObject({ ok: false })
      const engB = await ctxOf(b.slug, superAdmin)
      const rB = await salvarTurno(h.t.db, engB, { unitId: b.unit1, ...MANHA })
      const idB = rB.ok ? rB.dados.id : ""
      expect(await excluirTurno(h.t.db, eng, idB)).toMatchObject({ ok: false })
      expect((await h.t.db.select().from(s.shift).where(eq(s.shift.id, idB)))[0]?.deletedAt).toBeNull()
    })
  })

  describe("paradas planejadas", () => {
    it("horário local da unidade vira UTC; várias máquinas = uma parada por máquina; da unidade = sem máquina", async () => {
      const r = await salvarParada(h.t.db, eng, {
        unitId: a.unit1,
        title: "Preventiva",
        reasonId: planned,
        scope: [a.m1, a.m2],
        startDate: "2026-12-05",
        startTime: "06:00",
        endDate: "2026-12-05",
        endTime: "12:00",
      })
      expect(r.ok).toBe(true)
      const ids = r.ok ? r.dados.ids : []
      expect(ids).toHaveLength(2)
      const rows = await h.t.db.select().from(s.plannedDowntime).where(and(eq(s.plannedDowntime.unitId, a.unit1), isNull(s.plannedDowntime.deletedAt)))
      expect(rows.map((x) => x.machineId).sort()).toEqual([a.m1, a.m2].sort())
      // São Paulo é UTC−3: 06:00 local = 09:00 UTC.
      expect(rows[0]?.startsAt.toISOString()).toBe("2026-12-05T09:00:00.000Z")
      expect(rows[0]?.endsAt.toISOString()).toBe("2026-12-05T15:00:00.000Z")

      const u = await salvarParada(h.t.db, eng, { unitId: a.unit2, title: "Feriado", reasonId: planned, scope: "unit", startDate: "2026-12-25", startTime: "00:00", endDate: "2026-12-26", endTime: "00:00" })
      const [unitRow] = await h.t.db.select().from(s.plannedDowntime).where(eq(s.plannedDowntime.id, u.ok ? (u.dados.ids[0] ?? "") : ""))
      expect(unitRow).toMatchObject({ machineId: null, unitId: a.unit2, name: "Feriado" })
    })

    it("recusa: fim antes do início, motivo que não é planejado, máquina de outra unidade ou de outro cliente", async () => {
      const base = { unitId: a.unit1, title: "Teste", reasonId: planned, scope: "unit" as const, startDate: "2026-12-10", startTime: "10:00", endDate: "2026-12-10", endTime: "10:00" }
      expect(await salvarParada(h.t.db, eng, base)).toMatchObject({ ok: false, mensagem: "O fim da parada precisa ser depois do início." })
      expect(await salvarParada(h.t.db, eng, { ...base, endTime: "11:00", reasonId: unplanned })).toMatchObject({ ok: false })
      expect(await salvarParada(h.t.db, eng, { ...base, endTime: "11:00", scope: [a.m3] })).toMatchObject({ ok: false })
      expect(await salvarParada(h.t.db, eng, { ...base, endTime: "11:00", scope: [b.m1] })).toMatchObject({ ok: false })
      expect(await salvarParada(h.t.db, eng, { ...base, endTime: "11:00", unitId: b.unit1 })).toMatchObject({ ok: false })
    })

    it("alterar troca a parada; cancelar devolve o tempo planejado e marca o turno fechado para recálculo", async () => {
      // Turno consolidado de 01/12 (14:00–22:00 local) da máquina m1.
      const t = await salvarTurno(h.t.db, eng, { unitId: a.unit1, ...MANHA, name: "Turno recálculo", start: "14:00", end: "22:00", breaks: [{ name: "Refeição", start: "18:00", end: "18:30" }] })
      expect(t.ok).toBe(true)
      const shiftId = t.ok ? t.dados.id : ""
      await h.t.db.insert(s.oeeShift).values({ organizationId: a.organizationId, machineId: a.m1, shiftDate: "2026-12-01", shiftId })
      const dirty = async () => (await h.t.db.select({ dirty: s.oeeShift.dirty }).from(s.oeeShift).where(eq(s.oeeShift.shiftId, shiftId)))[0]?.dirty

      const r = await salvarParada(h.t.db, eng, { unitId: a.unit1, title: "Reunião", reasonId: planned, scope: [a.m1], startDate: "2026-12-01", startTime: "15:00", endDate: "2026-12-01", endTime: "16:00" })
      const id = r.ok ? (r.dados.ids[0] ?? "") : ""
      expect(await dirty()).toBe(true)
      await h.t.db.update(s.oeeShift).set({ dirty: false }).where(eq(s.oeeShift.shiftId, shiftId))

      const edit = await salvarParada(h.t.db, eng, { unitId: a.unit1, id, title: "Reunião longa", reasonId: planned, scope: [a.m1], startDate: "2026-12-01", startTime: "15:00", endDate: "2026-12-01", endTime: "17:00" })
      const newId = edit.ok ? (edit.dados.ids[0] ?? "") : ""
      expect((await h.t.db.select().from(s.plannedDowntime).where(eq(s.plannedDowntime.id, id)))[0]?.deletedAt).not.toBeNull()
      expect(await dirty()).toBe(true)
      await h.t.db.update(s.oeeShift).set({ dirty: false }).where(eq(s.oeeShift.shiftId, shiftId))

      expect(await cancelarParada(h.t.db, eng, newId)).toEqual({ ok: true, dados: { id: newId } })
      expect(await dirty()).toBe(true)
      const actions = await h.t.db.select({ action: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.organizationId, a.organizationId))
      expect(actions.map((x) => x.action)).toEqual(expect.arrayContaining(["planned_downtime.created", "planned_downtime.updated", "planned_downtime.cancelled"]))
    })

    it("sem config.write (admin do cliente): recusado", async () => {
      const admin = await ctxOf(a.slug, a.admin)
      await expect(salvarTurno(h.t.db, admin, { unitId: a.unit1, ...MANHA })).rejects.toBeInstanceOf(AccessDeniedError)
      await expect(salvarParada(h.t.db, admin, {})).rejects.toBeInstanceOf(AccessDeniedError)
      await expect(cancelarParada(h.t.db, admin, a.m1)).rejects.toBeInstanceOf(AccessDeniedError)
      await expect(excluirTurno(h.t.db, admin, a.m1)).rejects.toBeInstanceOf(AccessDeniedError)
    })
  })
})
