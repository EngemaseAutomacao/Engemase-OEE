/**
 * Tarefa agendada `turnos` (W7): fechamento de turno com o cálculo do @engemase/oee-core (o caso golden do
 * docs/07 gravado em `oee_shift`), feriado sem turno, idempotência, recálculo do turno sujo (refugo lançado
 * depois) e o limite por execução. PGlite com as migrações e a RLS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { CRON_JOBS } from "@/lib/server/cron/jobs"
import { type CronDeps, runCronJob } from "@/lib/server/cron/runner"
import { closeAndRecomputeShifts } from "@/lib/server/production/oee-shifts"
import { withTenant } from "@engemase/db"
import { count, createTestDatabase, EXAMPLE_CONFIG, remapIds, rows, type SeededClient, seedClient, type TestDatabase } from "../gateway/support"

const SECRET = "segredo-de-teste-com-tamanho-bom"
const job = CRON_JOBS.find((j) => j.name === "turnos")!

/** Segunda-feira 23/11/2026, turno 06:00–14:00 em São Paulo (09:00–17:00 UTC), pausa 10:00–10:30. */
const DAY = "2026-11-23"
const Z = (hhmm: string, date = DAY) => new Date(`${date}T${hhmm}:00Z`)

describe("tarefa agendada: turnos", () => {
  let t: TestDatabase
  let seq = 0

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  async function run(now: Date, extra: Partial<CronDeps> = {}) {
    const res = await runCronJob(new Request("http://localhost/api/cron/turnos", { headers: { Authorization: `Bearer ${SECRET}` } }), job, {
      db: t.db,
      secret: SECRET,
      now: () => now,
      env: {},
      logError: (m, e) => {
        if (process.env.CRON_DEBUG) console.error(m, e)
      },
      ...extra,
    })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  /** Cliente com o turno da manhã (seg–sex), máquinas cadastradas antes do período, ciclo ideal de 6 s. */
  async function clientWithShift(): Promise<{ client: SeededClient; shiftId: string }> {
    const client = await seedClient(t.db, { slug: `turnos-${++seq}`, config: remapIds(EXAMPLE_CONFIG, new Map()) })
    await t.client.query("UPDATE machine SET created_at = $2, ideal_cycle_s = 6 WHERE organization_id = $1", [client.organizationId, Z("00:00", "2026-11-22")])
    const [shift] = await rows<{ id: string }>(
      t,
      `INSERT INTO shift (organization_id, unit_id, name, start_time, end_time, days_of_week, breaks) VALUES
         ($1, $2, 'Manhã', '06:00', '14:00', '{1,2,3,4,5}', '[{"start": "10:00", "end": "10:30", "name": "Refeição"}]') RETURNING id`,
      [client.organizationId, client.unitId],
    )
    return { client, shiftId: shift!.id }
  }

  /**
   * Caso golden do docs/07 na primeira máquina: 450 min planejados (480 − 30 de refeição), 45 min de parada
   * não planejada, 3.600 peças com 72 refugos e ciclo ideal de 6 s → A 90%, P 88,9%, Q 98%, OEE 78,4%.
   */
  async function goldenData(client: SeededClient): Promise<void> {
    const m = client.machineIds[0]
    const events: [string, string, string][] = [
      ["RUNNING", "09:00", "13:00"],
      ["STOPPED", "13:00", "13:30"], // na refeição: fora do planejado
      ["RUNNING", "13:30", "14:00"],
      ["STOPPED", "14:00", "14:45"], // 45 min de parada não planejada
      ["RUNNING", "14:45", "17:00"],
    ]
    for (const [state, from, to] of events) {
      await t.client.query(
        "INSERT INTO machine_state_event (organization_id, machine_id, state, started_at, ended_at) VALUES ($1, $2, $3, $4, $5)",
        [client.organizationId, m, state, Z(from), Z(to)],
      )
    }
    for (const at of ["09:00", "09:01"]) {
      await t.client.query(
        `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject)
         VALUES ($1, $2, $3, 60, 0, 0, 0, 1800, 36)`,
        [client.organizationId, m, Z(at)],
      )
    }
  }

  type Row = { machine_id: string; planned_s: number; run_s: number; total: number; good: number; reject: number; availability: number | null; performance: number | null; quality: number | null; oee: number | null; dirty: boolean }
  const shiftRows = (client: SeededClient) =>
    rows<Row>(
      t,
      `SELECT machine_id, planned_s, run_s, total, good, reject, availability, performance, quality, oee, dirty
       FROM oee_shift WHERE organization_id = $1 ORDER BY shift_date, machine_id`,
      [client.organizationId],
    )

  it("fecha o turno terminado com o cálculo do oee-core (caso golden do docs/07), uma linha por máquina", async () => {
    const { client } = await clientWithShift()
    await goldenData(client)
    // Terça 24/11, 09:10 em São Paulo: o turno de segunda terminou; o de terça está em andamento.
    const result = await run(new Date("2026-11-24T12:10:00Z"))
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ failures: 0, shift_errors: 0, shifts_pending: 0 })
    expect(Number(result.body.shifts_closed)).toBeGreaterThanOrEqual(3)

    const saved = await shiftRows(client)
    expect(saved).toHaveLength(3) // só segunda (máquinas cadastradas no domingo)
    const golden = saved.find((r) => r.machine_id === client.machineIds[0])!
    expect(golden).toMatchObject({ planned_s: 450 * 60, run_s: 405 * 60, total: 3600, good: 3528, reject: 72, dirty: false })
    expect(golden.availability).toBeCloseTo(0.9, 6)
    expect(golden.performance).toBeCloseTo(360 / 405, 6)
    expect(golden.quality).toBeCloseTo(0.98, 6)
    expect(golden.oee).toBeCloseTo(0.784, 6)
    // Máquina sem nenhum dado: tempo planejado inteiro, sem contagem (Q nulo), OEE 0.
    const empty = saved.find((r) => r.machine_id === client.machineIds[1])!
    expect(empty).toMatchObject({ planned_s: 450 * 60, run_s: 0, total: 0, quality: null, oee: 0 })

    // Mesma hora: a janela já rodou. Hora seguinte: nada novo (idempotente).
    expect((await run(new Date("2026-11-24T12:40:00Z"))).body).toMatchObject({ skipped: expect.any(String) })
    await run(new Date("2026-11-24T13:10:00Z"))
    expect(await shiftRows(client)).toHaveLength(3)
  })

  it("não fecha turno antes do fim + 5 min; feriado da unidade não tem turno", async () => {
    const { client } = await clientWithShift()
    await t.client.query("INSERT INTO unit_holiday (organization_id, unit_id, holiday_date, name) VALUES ($1, $2, $3, 'Feriado municipal')", [
      client.organizationId,
      client.unitId,
      "2026-11-24",
    ])
    // Segunda 23/11 terminou às 17:00 UTC; às 17:03 ainda está na folga.
    await withTenant(t.db, client.organizationId, (tx) => closeAndRecomputeShifts(tx, { organizationId: client.organizationId, now: Z("17:03") }))
    expect(await count(t, "SELECT 1 FROM oee_shift WHERE organization_id = $1", [client.organizationId])).toBe(0)
    // Quarta 25/11 à noite: segunda fecha; terça (feriado) não tem turno.
    const stats = await withTenant(t.db, client.organizationId, (tx) =>
      closeAndRecomputeShifts(tx, { organizationId: client.organizationId, now: new Date("2026-11-25T23:00:00Z") }),
    )
    expect(stats).toMatchObject({ errors: 0, pending: 0 })
    expect(
      await rows(t, "SELECT DISTINCT shift_date::text AS d FROM oee_shift WHERE organization_id = $1 ORDER BY 1", [client.organizationId]),
    ).toEqual([{ d: "2026-11-23" }, { d: "2026-11-25" }])
  })

  it("turno sujo (refugo lançado depois) é recalculado e volta a ficar limpo", async () => {
    const { client } = await clientWithShift()
    await goldenData(client)
    const now = new Date("2026-11-24T12:10:00Z")
    await withTenant(t.db, client.organizationId, (tx) => closeAndRecomputeShifts(tx, { organizationId: client.organizationId, now }))

    // Refugo lançado depois (+36 peças) marca o turno como sujo.
    await t.client.query("INSERT INTO quality_entry (organization_id, machine_id, at, quantity) VALUES ($1, $2, $3, 36)", [
      client.organizationId,
      client.machineIds[0],
      Z("10:00"),
    ])
    await t.client.query("UPDATE oee_shift SET dirty = true, dirty_since = $2 WHERE organization_id = $1 AND machine_id = $3", [
      client.organizationId,
      now,
      client.machineIds[0],
    ])
    const stats = await withTenant(t.db, client.organizationId, (tx) =>
      closeAndRecomputeShifts(tx, { organizationId: client.organizationId, now: new Date(now.getTime() + 3_600_000) }),
    )
    expect(stats).toMatchObject({ closed: 0, recomputed: 1, errors: 0 })
    const golden = (await shiftRows(client)).find((r) => r.machine_id === client.machineIds[0])!
    expect(golden).toMatchObject({ reject: 108, good: 3492, dirty: false })
    expect(golden.quality).toBeCloseTo(0.97, 6)
  })

  it("limite por execução: o que sobra fica pendente para a próxima", async () => {
    const { client } = await clientWithShift()
    const now = new Date("2026-11-27T23:00:00Z") // seg a sex fechados: 5 turnos × 3 máquinas
    const first = await withTenant(t.db, client.organizationId, (tx) =>
      closeAndRecomputeShifts(tx, { organizationId: client.organizationId, now, maxCalculations: 4 }),
    )
    expect(first).toMatchObject({ closed: 4, pending: 11 })
    const second = await withTenant(t.db, client.organizationId, (tx) => closeAndRecomputeShifts(tx, { organizationId: client.organizationId, now }))
    expect(second).toMatchObject({ closed: 11, pending: 0 })
  })
})
