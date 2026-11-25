/**
 * Camada de dados das telas de acompanhamento (W9) contra o banco: PGlite com as migrações e o seed
 * sintético, leitura sob RLS com o `TenantContext` de uma pessoa de verdade e o cálculo do oee-core.
 */
import * as s from "@engemase/db"
import { seedId, seedSynthetic } from "@engemase/db/seed"
import { aggregateOee, calculateMachineOee } from "@engemase/oee-core"
import { beforeAll, describe, expect, it } from "vitest"
import { lerClienteDoBanco } from "@/lib/data/cliente/banco"
import { type BrutoCliente, montarClienteDados } from "@/lib/data/cliente/calculo"
import type { TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import { createPerson, createTestDatabase, type TestDatabase } from "../access/support"

// Quarta-feira, 11/11/2026, 10:42 em São Paulo (no meio do Turno 1, 06:00–14:00).
const NOW = Date.parse("2026-11-11T13:42:00.000Z")
const SLUG = "demo-metalurgica"

let t: TestDatabase
let supervisor: TenantContext
let soTorno: TenantContext
let outroCliente: TenantContext

async function contextFor(slug: string, userId: string, name: string): Promise<TenantContext> {
  const decision = await loadTenantContext(t.db, {
    slug,
    user: { id: userId, name, email: `${name}@exemplo.test`, role: null, banned: false, twoFactorEnabled: false },
    sessionId: "sessao-teste",
    now: new Date(NOW),
  })
  if (!decision.ok) throw new Error(`sem acesso: ${decision.reason}`)
  return decision.context
}

beforeAll(async () => {
  t = await createTestDatabase()
  await seedSynthetic(t.db as never, { now: new Date(NOW), days: 10 })
  supervisor = await contextFor(SLUG, seedId(`${SLUG}:user:supervisor`), "Supervisor")
  outroCliente = await contextFor("demo-plasticos", seedId("demo-plasticos:user:supervisor"), "Supervisor B")

  // Operador com escopo só no Torno CNC 01 (D11).
  const orgId = supervisor.organizationId
  const person = await createPerson(t.db, "operador-torno")
  const [mem] = await t.db.insert(s.member).values({ organizationId: orgId, userId: person.user.id }).returning()
  const [access] = await t.db
    .insert(s.memberAccess)
    .values({ organizationId: orgId, memberId: mem!.id, role: "operator", scope: "machines" })
    .returning()
  await t.db.insert(s.memberMachine).values({ organizationId: orgId, memberAccessId: access!.id, machineId: seedId(`${SLUG}:machine:torno-01`) })
  soTorno = await contextFor(SLUG, person.user.id, "operador-torno")
})

describe("lerClienteDoBanco", () => {
  it("lê cadastros, estado ao vivo e OEE do turno corrente do cliente da sessão", async () => {
    const d = await lerClienteDoBanco(t.db, supervisor, {}, NOW)
    expect(d.fonte).toBe("banco")
    expect(d.client.slug).toBe(SLUG)
    expect(d.machines.map((m) => m.name).sort()).toEqual(["Centro de usinagem 01", "Prensa 01", "Prensa 02", "Torno CNC 01"])
    expect(d.viewer.roleLabel).toBe("Supervisor")
    expect(d.access.canConfigure).toBe(false)
    expect(d.access.canSeeTechnical).toBe(false)

    const shift = d.shiftWindow()
    expect(shift.name).toBe("Turno 1")
    expect(shift.emAndamento).toBe(true)
    expect(shift.start).toBe("2026-11-11T09:00:00.000Z")

    const withLive = d.getMachinesWithLive()
    for (const m of withLive) {
      expect(m.live, m.name).toBeDefined()
      expect(m.live!.countShift).toBeGreaterThanOrEqual(0)
      expect(m.live!.shift.oee).toBeGreaterThanOrEqual(0)
      const timeline = d.getTimeline(m.id)
      expect(timeline.length).toBeGreaterThan(0)
      expect(Date.parse(timeline[0]!.start)).toBeGreaterThanOrEqual(Date.parse(shift.start))
      expect(Date.parse(timeline.at(-1)!.end)).toBeLessThanOrEqual(NOW)
      expect(d.getHourlyProduction(m.id)).toHaveLength(8)
    }

    // OEE agregado = soma das bases (docs/07), nunca a média dos OEEs.
    const agg = d.aggregateOee(withLive)
    const expected = aggregateOee(
      withLive.map((m) => {
        const b = m.live!.basis!
        return { plannedS: b.plannedS, runS: b.runS, total: b.total, good: b.good, reject: b.total - b.good, idealTimeS: b.idealS, goodIdealTimeS: b.goodIdealS }
      }),
    )
    expect(agg.oee).toBeCloseTo(expected.indicators.oee ?? 0, 10)
    expect(agg.machinesWithData).toBe(4)
  })

  it("histórico de turnos fechados, OEE diário e paradas só quando a tela pede", async () => {
    const vazio = await lerClienteDoBanco(t.db, supervisor, {}, NOW)
    // Prensa 01 (ciclo de 4 s): o seed gera até 15 peças/min, então a performance fica ≤ 100%.
    const id = vazio.machines.find((m) => m.name === "Prensa 01")!.id
    expect(vazio.getShiftHistory([id], 7)).toEqual([])
    expect(vazio.getStopRecords([id])).toEqual([])

    const d = await lerClienteDoBanco(t.db, supervisor, { diasOee: 7, diasTurnos: 7, paradas: true }, NOW)
    const rows = d.getShiftHistory([id], 7)
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map((r) => r.date)).size).toBeLessThanOrEqual(7)
    for (const r of rows) {
      expect(r.plannedMin).toBeGreaterThan(0)
      expect(r.good).toBe(r.total - r.reject)
    }
    const daily = d.getDailyOee(id, 7)
    expect(daily.length).toBeGreaterThan(0)
    expect(daily.every((x) => x.oee > 0 && x.oee <= 1 && x.performance <= 1)).toBe(true)
    // OEE diário = soma das bases dos turnos do dia (não a média dos turnos).
    const day = daily.at(-1)!
    const ofDay = rows.filter((r) => r.date === day.date)
    expect(ofDay.length).toBeGreaterThan(0)

    const stops = d.getStopRecords([id])
    expect(stops.length).toBeGreaterThan(0)
    expect(stops.every((r) => r.week >= 0 && r.week < 4 && r.minutes > 0)).toBe(true)
    const pareto = d.getPareto([id])
    expect(pareto.map((p) => p.minutes)).toEqual([...pareto.map((p) => p.minutes)].sort((a, b) => b - a))
  })

  it("aplica o escopo da pessoa: operador do torno só vê o torno e a linha dele", async () => {
    const d = await lerClienteDoBanco(t.db, soTorno, { diasTurnos: 3, paradas: true }, NOW)
    expect(d.machines.map((m) => m.name)).toEqual(["Torno CNC 01"])
    expect(d.lines.map((l) => l.name)).toEqual(["Usinagem"])
    const outra = seedId(`${SLUG}:machine:prensa-01`)
    expect(d.getMachine(outra)).toBeUndefined()
    expect(d.getMachineLive(outra)).toBeUndefined()
    expect(d.getShiftHistory([outra], 3)).toEqual([])
    expect(d.getStopRecords([outra])).toEqual([])
  })

  it("isola os clientes: a sessão de outro cliente não enxerga as máquinas deste", async () => {
    const d = await lerClienteDoBanco(t.db, outroCliente, {}, NOW)
    expect(d.client.slug).toBe("demo-plasticos")
    const minhas = new Set((await lerClienteDoBanco(t.db, supervisor, {}, NOW)).machines.map((m) => m.id))
    expect(d.machines.some((m) => minhas.has(m.id))).toBe(false)
  })
})

describe("montarClienteDados (puro)", () => {
  const unitId = "00000000-0000-4000-8000-000000000001"
  const machineId = "00000000-0000-4000-8000-000000000002"
  const shiftStart = Date.parse("2026-11-11T09:00:00.000Z") // 06:00 em São Paulo
  const base: BrutoCliente = {
    organization: { id: "org", slug: "cli", name: "Cliente", status: "active", plan: "pro", limits: { machines: 5 }, createdAt: "2026-01-01T00:00:00.000Z" },
    units: [{ id: unitId, name: "Planta", timezone: "America/Sao_Paulo" }],
    areas: [],
    lines: [{ id: "lin", unitId, areaId: null, name: "Injeção A", sortOrder: 0, oeeTarget: 0.8 }],
    machines: [{ id: machineId, unitId, lineId: "lin", name: "Injetora 01", code: "INJ-01", idealCycleS: 6, microStopThresholdS: 60, stateMode: "signals", active: true }],
    products: [],
    productMachines: [],
    shifts: [
      { id: "t1", unitId, name: "1º turno", startTime: "06:00:00", endTime: "14:00:00", daysOfWeek: [1, 2, 3, 4, 5], breaks: [{ start: "10:00", end: "10:30", name: "Refeição" }], validFrom: null, validTo: null },
    ],
    holidays: [],
    plannedDowntimes: [],
    reasons: [],
    faultMap: [],
    live: [{ machineId, state: "RUNNING", stateSince: shiftStart, faultCode: null, productCode: null, at: NOW - 5_000 }],
    events: [
      { machineId, state: "RUNNING", start: shiftStart, end: shiftStart + 60 * 60_000, reasonId: null, faultCode: null },
      { machineId, state: "FAULT", start: shiftStart + 60 * 60_000, end: shiftStart + 90 * 60_000, reasonId: null, faultCode: 58 },
      { machineId, state: "RUNNING", start: shiftStart + 90 * 60_000, end: null, reasonId: null, faultCode: null },
    ],
    minutes: Array.from({ length: (NOW - shiftStart) / 60_000 }, (_, i) => ({ machineId, start: shiftStart + i * 60_000, total: 9, reject: i % 10 === 0 ? 1 : 0, productCode: null })),
    quarterMinutes: [],
    quality: [],
    closedShifts: [],
    gateways: [],
    gatewayMachines: [],
    devices: [],
    tags: [],
    alerts: [],
  }

  it("o OEE do turno é o do oee-core na janela [início do turno, agora)", () => {
    const d = montarClienteDados(base, {
      now: NOW,
      rawSince: shiftStart,
      needs: {},
      viewer: { name: "Ana", email: "ana@x", roleLabel: "Supervisor", isPlatform: false },
      access: { isEngemase: false, canConfigure: false, canManageUsers: false, canSeeTechnical: false },
    })
    const live = d.getMachineLive(machineId)!
    const expected = calculateMachineOee({
      window: { start: shiftStart, end: NOW },
      schedule: [{ start: shiftStart, end: shiftStart + 8 * 3_600_000, breaks: [{ start: shiftStart + 4 * 3_600_000, end: shiftStart + 4.5 * 3_600_000 }] }],
      stateEvents: base.events.map((e) => ({ start: e.start, end: e.end, state: e.state as "RUNNING" })),
      minutes: base.minutes,
      idealCycles: { byProduct: {}, defaultS: 6 },
      options: { microStopThresholdS: 60 },
    })
    expect(live.shift.oee).toBeCloseTo(expected.indicators.oee!, 10)
    expect(live.shift.availability).toBeCloseTo(expected.indicators.availability!, 10)
    expect(live.countShift).toBe(expected.totals.total)
    // Meta do turno: 7h30 programadas ÷ 6 s.
    expect(live.targetShift).toBe(4500)
    expect(live.stale).toBe(false)
    expect(d.getTimeline(machineId).map((e) => e.state)).toEqual(["RUNNING", "FAULT", "RUNNING"])
    expect(d.getTimeline(machineId).at(-1)!.end).toBe(new Date(NOW).toISOString())
    // Hora das 10:00 (13:00Z) tem a refeição: meta de 30 min.
    const h10 = d.getHourlyProduction(machineId).find((h) => h.hour === "2026-11-11T13:00:00.000Z")!
    expect(h10.target).toBe(300)
  })

  it("live velho vira 'dados atrasados' e sem turno cadastrado o OEE fica sem tempo planejado", () => {
    const d = montarClienteDados(
      { ...base, shifts: [], live: [{ ...base.live[0]!, at: NOW - 10 * 60_000 }] },
      {
        now: NOW,
        rawSince: shiftStart,
        needs: {},
        viewer: { name: "Ana", email: "", roleLabel: "", isPlatform: false },
        access: { isEngemase: false, canConfigure: false, canManageUsers: false, canSeeTechnical: false },
      },
    )
    expect(d.shiftWindow().name).toBe("Hoje")
    const live = d.getMachineLive(machineId)!
    expect(live.stale).toBe(true)
    expect(live.targetShift).toBe(0)
  })
})
