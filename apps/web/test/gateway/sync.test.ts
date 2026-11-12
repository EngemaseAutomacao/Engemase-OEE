/**
 * POST /api/gateway/v1/sync com as fixtures do contrato, num banco PGlite com as migrações e a RLS
 * de @engemase/db: gravação de cada tipo de dado, ack só no fim, idempotência (mesmo lote duas vezes),
 * comandos, modo interativo e turnos consolidados marcados como sujos. Também as colunas que espelham
 * o contrato: `fault_code` uint32 inteiro em `bigint`, `minutes[].good` e `live[].speed`.
 */
import {
  type Command,
  ErrorResponseSchema,
  type SyncRequest,
  type SyncResponse,
  SyncResponseSchema,
} from "@engemase/contracts"
import * as s from "@engemase/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { handleSync } from "@/lib/server/gateway/handlers"
import {
  count,
  createTestDatabase,
  dataFootprint,
  deps,
  EXAMPLE_CONFIG,
  fixture,
  FIXTURE_NOW,
  remapIds,
  rows,
  type SeededClient,
  seedClient,
  syncRequest,
  type TestDatabase,
} from "./support"

const REALISTIC = fixture<SyncRequest>("sync-request.valid.realistic")
const ALL_EVENTS = fixture<SyncRequest>("sync-request.valid.all-event-types")
const SAMPLES_QUEUE = fixture<SyncRequest>("sync-request.valid.samples-queue")
const HEALTH_ONLY = fixture<SyncRequest>("sync-request.valid.health-only")
const ALL_RESULTS = fixture<SyncRequest>("sync-request.valid.all-command-results")
const REMOTE_SESSION_ID = "01a1cab3-7cf8-7f23-8fdf-c01d84c79403"

const [MCH_INJ, MCH_SOP1, MCH_SOP2] = EXAMPLE_CONFIG.machines.map((m) => m.id) as [string, string, string]

describe("POST /sync", () => {
  let t: TestDatabase
  let seq = 0

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  /**
   * Cliente independente por teste: a config de exemplo (e as fixtures usadas no teste) com todos os
   * ids trocados de forma consistente, para nenhum teste depender do estado deixado por outro.
   */
  async function freshClient(): Promise<{ client: SeededClient; remap: <T>(value: T) => T; id: (fixtureId: string) => string }> {
    const map = new Map<string, string>()
    const remap = <T>(value: T): T => remapIds(value, map)
    const client = await seedClient(t.db, {
      slug: `cliente-${++seq}`,
      config: remap(EXAMPLE_CONFIG),
      remoteSessionIds: [remap(REMOTE_SESSION_ID)],
    })
    return { client, remap, id: (fixtureId) => remap(fixtureId) }
  }

  async function sync(client: SeededClient, body: unknown, now: Date = FIXTURE_NOW): Promise<Response> {
    return handleSync(syncRequest(body, { token: client.token }), deps(t, now))
  }

  async function syncOk(client: SeededClient, body: unknown, now: Date = FIXTURE_NOW): Promise<SyncResponse> {
    const res = await sync(client, body, now)
    const json: unknown = await res.json()
    expect(res.status, JSON.stringify(json)).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    return SyncResponseSchema.parse(json)
  }

  async function addCommand(
    client: SeededClient,
    values: { id?: string; type: string; payload?: Record<string, unknown>; status?: "pending" | "sent"; createdAt?: Date; ttlMs?: number },
  ): Promise<string> {
    const createdAt = values.createdAt ?? new Date(FIXTURE_NOW.getTime() - 1000)
    const [row] = await t.db
      .insert(s.gatewayCommand)
      .values({
        ...(values.id !== undefined ? { id: values.id } : {}),
        organizationId: client.organizationId,
        gatewayId: client.gatewayId,
        type: values.type,
        payload: values.payload ?? {},
        status: values.status ?? "pending",
        createdAt,
        expiresAt: new Date(createdAt.getTime() + (values.ttlMs ?? 120_000)),
      })
      .returning({ id: s.gatewayCommand.id })
    if (row === undefined) throw new Error("comando não inserido")
    return row.id
  }

  it("lote realista (fixture original): grava eventos, minutos, live, amostras, saúde e resultados", async () => {
    const a = await seedClient(t.db, { slug: "acme", remoteSessionIds: [REMOTE_SESSION_ID] })
    expect(a.gatewayId).toBe(EXAMPLE_CONFIG.gateway_id)
    for (const r of REALISTIC.command_results ?? []) await addCommand(a, { id: r.id, type: r.type, status: "sent" })

    const res = await syncOk(a, REALISTIC)
    expect(res).toEqual({
      ack_seq: 18245,
      server_time: FIXTURE_NOW.toISOString(),
      config: { latest_version: 42 },
      commands: [],
      next_sync_s: 10,
      min_agent_version: "0.1.0",
    })

    const org = a.organizationId
    expect(await dataFootprint(t, org)).toEqual({
      machine_state_event: 2,
      production_minute: 6,
      production_run: 1,
      machine_live: 3,
      tag_sample: 5,
      gateway_device_status: 3,
      audit_log: 1, // counter_reset
      remote_access_event: 0,
    })

    // Estados: os ids da borda viram os ids do banco; o mais recente de cada máquina fica em aberto.
    const states = await rows<{ id: string; machine_id: string; state: string; fault_code: number | null; ended_at: Date | null }>(
      t,
      "SELECT id, machine_id, state, fault_code, ended_at FROM machine_state_event WHERE organization_id = $1 ORDER BY started_at",
      [org],
    )
    expect(states).toEqual([
      { id: "01a1cab1-cc5a-7af4-9800-bf5c8c603e5f", machine_id: MCH_SOP1, state: "RUNNING", fault_code: null, ended_at: null },
      { id: "01a1cab3-2bea-7244-bb03-702b326efb32", machine_id: MCH_INJ, state: "FAULT", fault_code: 47, ended_at: null },
    ])

    // Sem contador de boas no lote: `good` fica nulo (boas = total − refugo).
    const minute = await rows<Record<string, unknown>>(
      t,
      `SELECT run_s, stop_s, fault_s, setup_s, no_comm_s, total, reject, good, product_code FROM production_minute
       WHERE machine_id = $1 AND bucket_start = '2026-11-11T13:01:00Z'`,
      [MCH_INJ],
    )
    expect(minute).toEqual([
      { run_s: 42, stop_s: 0, fault_s: 18, setup_s: 0, no_comm_s: 0, total: 14, reject: 1, good: null, product_code: "7" },
    ])

    const live = await rows<{ state: string; fault_code: number | null; counter_total: number; product_code: string | null; speed: number | null }>(
      t,
      "SELECT state, fault_code, counter_total::int AS counter_total, product_code, speed FROM machine_live WHERE machine_id = $1",
      [MCH_INJ],
    )
    // `speed: 0` (máquina parada em falha) é gravado como 0, não como nulo.
    expect(live).toEqual([{ state: "FAULT", fault_code: 47, counter_total: 1048213, product_code: "7", speed: 0 }])

    const run = await rows<{ id: string; product_code: string; source: string; ended_at: Date | null }>(
      t,
      "SELECT id, product_code, source, ended_at FROM production_run WHERE organization_id = $1",
      [org],
    )
    expect(run).toEqual([{ id: "01a1cab2-06f2-7a82-ad95-74bafabec1c8", product_code: "7", source: "plc", ended_at: null }])

    const audit = await rows<{ id: string; action: string; actor_type: string; entity_id: string }>(
      t,
      "SELECT id, action, actor_type, entity_id FROM audit_log WHERE organization_id = $1",
      [org],
    )
    expect(audit).toEqual([
      { id: "01a1cab2-418a-77af-a200-8aa6ff00d3eb", action: "gateway.counter_reset", actor_type: "gateway", entity_id: MCH_SOP2 },
    ])

    const commands = await rows<{ type: string; status: string; error_code: string | null; has_result: boolean }>(
      t,
      "SELECT type, status, error_code, result IS NOT NULL AS has_result FROM gateway_command WHERE organization_id = $1 ORDER BY type",
      [org],
    )
    expect(commands).toEqual([
      { type: "agent.update", status: "rejected", error_code: "unsupported", has_result: true },
      { type: "device.test", status: "error", error_code: "modbus_exception", has_result: true },
      { type: "tag.read", status: "ok", error_code: null, has_result: true },
    ])

    const [gw] = await rows<{ last_seen_at: Date; agent_version: string; config_version_applied: number; health: Record<string, unknown> }>(
      t,
      "SELECT last_seen_at, agent_version, config_version_applied, health FROM gateway WHERE id = $1",
      [a.gatewayId],
    )
    expect(gw?.last_seen_at.toISOString()).toBe(FIXTURE_NOW.toISOString())
    expect(gw?.agent_version).toBe("1.2.0")
    expect(gw?.config_version_applied).toBe(42)
    expect(gw?.health).toMatchObject({ cpu_pct: 7.5, buffer_pending: 15, buses: REALISTIC.buses })
    expect((gw?.health.devices as unknown[]).length).toBe(3)

    const status = await rows<{ status: string; latency_ms: number; errors_1m: number }>(
      t,
      "SELECT status, latency_ms, errors_1m FROM gateway_device_status WHERE device_id = $1",
      ["01a159a0-5c20-7fb9-ad36-a2297f2a5938"],
    )
    expect(status).toEqual([{ status: "degraded", latency_ms: 41, errors_1m: 2 }])
  })

  it("idempotência: o mesmo lote duas vezes não duplica nada e devolve o mesmo ack", async () => {
    const { client, remap } = await freshClient()
    const batch = remap(REALISTIC)
    for (const r of batch.command_results ?? []) await addCommand(client, { id: r.id, type: r.type, status: "sent" })

    const first = await syncOk(client, batch)
    const footprint = await dataFootprint(t, client.organizationId)
    const minutesBefore = await rows(t, "SELECT * FROM production_minute WHERE organization_id = $1 ORDER BY 2, 3", [
      client.organizationId,
    ])
    const commandsBefore = await rows(t, "SELECT id, status, completed_at FROM gateway_command WHERE organization_id = $1 ORDER BY id", [
      client.organizationId,
    ])

    const second = await syncOk(client, batch)
    expect(second.ack_seq).toBe(first.ack_seq)
    expect(second.ack_seq).toBe(18245)
    expect(await dataFootprint(t, client.organizationId)).toEqual(footprint)
    expect(await rows(t, "SELECT * FROM production_minute WHERE organization_id = $1 ORDER BY 2, 3", [client.organizationId])).toEqual(
      minutesBefore,
    )
    expect(
      await rows(t, "SELECT id, status, completed_at FROM gateway_command WHERE organization_id = $1 ORDER BY id", [client.organizationId]),
    ).toEqual(commandsBefore)
    expect(await count(t, "SELECT 1 FROM audit_log WHERE action = 'production_minute.rewritten' AND organization_id = $1", [client.organizationId])).toBe(0)
  })

  it("todos os tipos de evento: auditoria, acesso remoto, estado e produto (com chegada fora de ordem)", async () => {
    const { client, remap, id } = await freshClient()
    await syncOk(client, remap(REALISTIC))

    const res = await syncOk(client, remap(ALL_EVENTS))
    expect(res.ack_seq).toBe(15)

    const org = client.organizationId
    const actions = await rows<{ action: string }>(
      t,
      "SELECT action FROM audit_log WHERE organization_id = $1 AND actor_type = 'gateway' ORDER BY at, action",
      [org],
    )
    expect(actions.map((r) => r.action)).toEqual([
      "gateway.agent_start",
      "gateway.power_restored",
      "gateway.clock_jump",
      "gateway.config_applied",
      "gateway.counter_reset",
      "gateway.counter_jump",
      "gateway.counter_rebaseline",
      "gateway.data_loss",
      "gateway.buffer_corrupted",
      "gateway.config_rejected",
      "gateway.power_loss",
      "gateway.agent_stop",
      "gateway.counter_reset", // do lote realista (13:00)
    ])
    const remote = await rows<{ type: string; session_id: string; data: unknown }>(
      t,
      "SELECT type, session_id, data FROM remote_access_event WHERE organization_id = $1",
      [org],
    )
    expect(remote).toEqual([{ type: "session_started", session_id: id(REMOTE_SESSION_ID), data: { actor: "suporte-engemase:ana" } }])

    // O estado das 06:00 chegou DEPOIS do das 13:00 da mesma máquina: termina onde o seguinte começa.
    const states = await rows<{ started_at: Date; ended_at: Date | null }>(
      t,
      "SELECT started_at, ended_at FROM machine_state_event WHERE machine_id = $1 ORDER BY started_at",
      [id(MCH_SOP1)],
    )
    expect(states.map((r) => [r.started_at.toISOString(), r.ended_at?.toISOString() ?? null])).toEqual([
      ["2026-11-11T06:00:04.800Z", "2026-11-11T13:00:12.250Z"],
      ["2026-11-11T13:00:12.250Z", null],
    ])
    const runs = await rows<{ started_at: Date; ended_at: Date | null }>(
      t,
      "SELECT started_at, ended_at FROM production_run WHERE machine_id = $1 ORDER BY started_at",
      [id(MCH_INJ)],
    )
    expect(runs.map((r) => [r.started_at.toISOString(), r.ended_at?.toISOString() ?? null])).toEqual([
      ["2026-11-11T06:00:05.000Z", "2026-11-11T13:00:27.250Z"],
      ["2026-11-11T13:00:27.250Z", null],
    ])
  })

  it("novo estado fecha o intervalo aberto da máquina", async () => {
    const { client, id } = await freshClient()
    const machine = id(MCH_INJ)
    const event = (eventId: string, seqNo: number, at: string, state: string) => ({
      batch: { seq_from: seqNo, seq_to: seqNo, sent_at: at },
      agent: HEALTH_ONLY.agent,
      events: [{ id: eventId, seq: seqNo, type: "state", machine_id: machine, at, state }],
    })
    await syncOk(client, event("01a1cab3-0000-7000-8000-000000000001", 1, "2026-11-11T12:00:00.000Z", "RUNNING"))
    await syncOk(client, event("01a1cab3-0000-7000-8000-000000000002", 2, "2026-11-11T12:30:00.000Z", "STOPPED"))
    const states = await rows<{ state: string; ended_at: Date | null }>(
      t,
      "SELECT state, ended_at FROM machine_state_event WHERE machine_id = $1 ORDER BY started_at",
      [machine],
    )
    expect(states.map((r) => [r.state, r.ended_at?.toISOString() ?? null])).toEqual([
      ["RUNNING", "2026-11-11T12:30:00.000Z"],
      ["STOPPED", null],
    ])
  })

  it("minuto reescrito com valor diferente: atualiza e guarda a versão anterior na auditoria", async () => {
    const { client, remap, id } = await freshClient()
    const batch = remap(REALISTIC)
    await syncOk(client, batch)

    const changed: SyncRequest = {
      batch: { seq_from: 18300, seq_to: 18300, sent_at: "2026-11-11T13:02:06.000Z" },
      agent: batch.agent,
      minutes: [{ ...batch.minutes![3]!, seq: 18300, total: 15, reject: 2, good: 13 }],
    }
    const res = await syncOk(client, changed)
    expect(res.ack_seq).toBe(18300)

    const [minute] = await rows<{ total: number; reject: number; good: number | null }>(
      t,
      "SELECT total, reject, good FROM production_minute WHERE machine_id = $1 AND bucket_start = '2026-11-11T13:01:00Z'",
      [id(MCH_INJ)],
    )
    expect(minute).toEqual({ total: 15, reject: 2, good: 13 })
    const audit = await rows<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
      t,
      "SELECT before, after FROM audit_log WHERE organization_id = $1 AND action = 'production_minute.rewritten'",
      [client.organizationId],
    )
    expect(audit).toHaveLength(1)
    expect(audit[0]?.before).toMatchObject({ t: "2026-11-11T13:01:00Z", total: 14, reject: 1, good: null })
    expect(audit[0]?.after).toMatchObject({ t: "2026-11-11T13:01:00Z", total: 15, reject: 2, good: 13 })

    // Só o `good` mudou: também é reescrita (com auditoria); reenviar igual não muda nada.
    const goodOnly: SyncRequest = {
      ...changed,
      batch: { ...changed.batch, seq_from: 18301, seq_to: 18301 },
      minutes: [{ ...changed.minutes![0]!, seq: 18301, good: 12 }],
    }
    await syncOk(client, goodOnly)
    await syncOk(client, goodOnly)
    const [after] = await rows<{ good: number }>(
      t,
      "SELECT good FROM production_minute WHERE machine_id = $1 AND bucket_start = '2026-11-11T13:01:00Z'",
      [id(MCH_INJ)],
    )
    expect(after?.good).toBe(12)
    expect(await count(t, "SELECT 1 FROM audit_log WHERE organization_id = $1 AND action = 'production_minute.rewritten'", [client.organizationId])).toBe(2)
  })

  it("live só é gravado se for mais novo que o atual", async () => {
    const { client, remap, id } = await freshClient()
    const batch = remap(REALISTIC)
    await syncOk(client, batch)

    const older = batch.live![0]!
    await syncOk(client, {
      batch: { sent_at: "2026-11-11T13:02:10.000Z" },
      agent: batch.agent,
      live: [{ ...older, at: "2026-11-11T13:01:00.000Z", state: "RUNNING", state_since: "2026-11-11T13:00:00.000Z", speed: 99 }],
    })
    const [live] = await rows<{ state: string; speed: number | null }>(t, "SELECT state, speed FROM machine_live WHERE machine_id = $1", [id(MCH_INJ)])
    expect(live).toEqual({ state: "FAULT", speed: 0 })

    await syncOk(client, {
      batch: { sent_at: "2026-11-11T13:02:10.000Z" },
      agent: batch.agent,
      live: [{ machine_id: older.machine_id, at: "2026-11-11T13:02:08.000Z", state: "RUNNING", state_since: "2026-11-11T13:02:08.000Z", speed: 37.25 }],
    })
    const [running] = await rows<{ state: string; fault_code: number | null; speed: number | null }>(
      t,
      "SELECT state, fault_code, speed FROM machine_live WHERE machine_id = $1",
      [id(MCH_INJ)],
    )
    expect(running).toEqual({ state: "RUNNING", fault_code: null, speed: 37.25 })

    // Foto mais nova sem velocidade (tag de velocidade sem leitura): a velocidade antiga não fica.
    await syncOk(client, {
      batch: { sent_at: "2026-11-11T13:02:10.000Z" },
      agent: batch.agent,
      live: [{ machine_id: older.machine_id, at: "2026-11-11T13:02:09.000Z", state: "RUNNING", state_since: "2026-11-11T13:02:08.000Z" }],
    })
    const [after] = await rows<{ state: string; fault_code: number | null; speed: number | null }>(
      t,
      "SELECT state, fault_code, speed FROM machine_live WHERE machine_id = $1",
      [id(MCH_INJ)],
    )
    expect(after).toEqual({ state: "RUNNING", fault_code: null, speed: null })
  })

  it("fault_code uint32 inteiro (acima de 2^31−1, até 4294967295) gravado em bigint no evento e no live", async () => {
    const { client, id } = await freshClient()
    const machine = id(MCH_INJ)
    const other = id(MCH_SOP1)
    const at = "2026-11-11T13:00:00.000Z"
    await syncOk(client, {
      batch: { seq_from: 1, seq_to: 2, sent_at: "2026-11-11T13:00:01.000Z" },
      agent: HEALTH_ONLY.agent,
      events: [
        { id: "01a1cab3-0000-7000-8000-0000000000f1", seq: 1, type: "state", machine_id: machine, at, state: "FAULT", fault_code: 4_294_967_295 },
        { id: "01a1cab3-0000-7000-8000-0000000000f2", seq: 2, type: "state", machine_id: other, at, state: "FAULT", fault_code: 2_147_483_648 },
      ],
      live: [
        { machine_id: machine, at: "2026-11-11T13:00:01.000Z", state: "FAULT", state_since: at, fault_code: 4_294_967_295 },
        { machine_id: other, at: "2026-11-11T13:00:01.000Z", state: "FAULT", state_since: at, fault_code: 2_147_483_648 },
      ],
    })
    const codes = await rows<{ machine_id: string; event: string; live: string; type: string }>(
      t,
      `SELECT e.machine_id, e.fault_code::text AS event, l.fault_code::text AS live, pg_typeof(e.fault_code)::text AS type
       FROM machine_state_event e JOIN machine_live l USING (machine_id) WHERE e.organization_id = $1 ORDER BY e.fault_code DESC`,
      [client.organizationId],
    )
    expect(codes).toEqual([
      { machine_id: machine, event: "4294967295", live: "4294967295", type: "bigint" },
      { machine_id: other, event: "2147483648", live: "2147483648", type: "bigint" },
    ])
  })

  it("amostras com fila própria: ack_samples_seq separado do ack_seq", async () => {
    const { client, remap } = await freshClient()
    const res = await syncOk(client, remap(SAMPLES_QUEUE))
    expect(res.ack_seq).toBe(502)
    expect(res.ack_samples_seq).toBe(9003)
    expect(await count(t, "SELECT 1 FROM tag_sample WHERE organization_id = $1", [client.organizationId])).toBe(3)
    // O minuto do lote traz o contador de boas (`good`), gravado na coluna própria.
    expect(await rows(t, "SELECT total, reject, good FROM production_minute WHERE organization_id = $1", [client.organizationId])).toEqual([
      { total: 9, reject: 0, good: 9 },
    ])
  })

  it("sync só de saúde: ack 0 e nada além da foto de saúde", async () => {
    const { client, remap } = await freshClient()
    const res = await syncOk(client, remap(HEALTH_ONLY))
    expect(res.ack_seq).toBe(0)
    expect(res.ack_samples_seq).toBeUndefined()
    const footprint = await dataFootprint(t, client.organizationId)
    expect(footprint.gateway_device_status).toBe(1)
    expect(Object.entries(footprint).filter(([k, n]) => k !== "gateway_device_status" && n > 0)).toEqual([])
  })

  it("todos os tipos de resultado de comando (fixture), por id e tipo", async () => {
    const { client, remap } = await freshClient()
    const batch = remap(ALL_RESULTS)
    for (const r of batch.command_results ?? []) await addCommand(client, { id: r.id, type: r.type, status: "sent" })
    await syncOk(client, batch)
    const statuses = await rows<{ status: string; n: number }>(
      t,
      "SELECT status, count(*)::int AS n FROM gateway_command WHERE organization_id = $1 GROUP BY status ORDER BY status",
      [client.organizationId],
    )
    expect(statuses).toEqual([
      { status: "error", n: 1 },
      { status: "expired", n: 1 },
      { status: "ok", n: 10 },
      { status: "rejected", n: 1 },
    ])
  })

  it("entrega comandos em aberto (modo interativo), marca como enviados e não reexecuta resultado já gravado", async () => {
    const { client, remap, id } = await freshClient()
    const deviceId = id(EXAMPLE_CONFIG.devices[0]!.id)
    const payload = { device_id: deviceId, address: { area: "holding_register", offset: 1004 }, type: "uint32", word_order: "CDAB" }
    const cmdId = await addCommand(client, { type: "tag.read", payload })
    const expiredId = await addCommand(client, { type: "agent.restart", createdAt: new Date(FIXTURE_NOW.getTime() - 3_600_000), ttlMs: 600_000 })
    const invalidId = await addCommand(client, { type: "tag.read", payload: { device_id: deviceId } })
    const futureTypeId = await addCommand(client, { type: "agent.update", payload: { version: "1.3.0" } })

    const res = await syncOk(client, remap(HEALTH_ONLY))
    expect(res.next_sync_s).toBe(1)
    expect(res.commands).toHaveLength(1)
    const command = res.commands[0] as Command
    expect(command).toMatchObject({ id: cmdId, type: "tag.read", payload })
    expect(Date.parse(command.expires_at) - Date.parse(command.issued_at!)).toBe(120_000)

    const status = async (commandId: string) =>
      (await rows<{ status: string; error_code: string | null }>(t, "SELECT status, error_code FROM gateway_command WHERE id = $1", [commandId]))[0]
    expect(await status(cmdId)).toEqual({ status: "sent", error_code: null })
    expect(await status(expiredId)).toEqual({ status: "expired", error_code: null })
    expect(await status(invalidId)).toEqual({ status: "rejected", error_code: "invalid_payload" })
    expect(await status(futureTypeId)).toEqual({ status: "rejected", error_code: "invalid_payload" })

    // Resposta perdida: o comando ainda sem resultado é reentregue (o agente deduplica por id).
    const again = await syncOk(client, remap(HEALTH_ONLY))
    expect(again.commands.map((c) => c.id)).toEqual([cmdId])

    // Chega o resultado: o comando fecha, sai da resposta e o modo interativo acaba.
    const result = { id: cmdId, type: "tag.read", status: "ok", result: { value: 1048213, quality: "good", read_ms: 21 } }
    const done = await syncOk(client, { ...remap(HEALTH_ONLY), command_results: [result] })
    expect(done.commands).toEqual([])
    expect(done.next_sync_s).toBe(10)
    expect(await status(cmdId)).toEqual({ status: "ok", error_code: null })

    // Resultado repetido (o agente reenviou) não muda nada.
    const [before] = await rows(t, "SELECT completed_at, result FROM gateway_command WHERE id = $1", [cmdId])
    await syncOk(client, { ...remap(HEALTH_ONLY), command_results: [{ ...result, result: { ...result.result, value: 0 } }] }, new Date(FIXTURE_NOW.getTime() + 5000))
    expect((await rows(t, "SELECT completed_at, result FROM gateway_command WHERE id = $1", [cmdId]))[0]).toEqual(before)
  })

  it("intervalo normal vem do uplink.sync_interval_s da config publicada", async () => {
    const { client, remap } = await freshClient()
    const snapshot = { ...client.config, uplink: { ...client.config.uplink, sync_interval_s: 30 } }
    await t.client.query("UPDATE gateway_config_version SET snapshot = $2::jsonb WHERE gateway_id = $1", [
      client.gatewayId,
      JSON.stringify(snapshot),
    ])
    const res = await syncOk(client, remap(HEALTH_ONLY))
    expect(res.next_sync_s).toBe(30)
  })

  it("dados novos num turno já consolidado marcam o turno como sujo (fuso da unidade)", async () => {
    const { client, remap, id } = await freshClient()
    await t.client.query("UPDATE unit SET timezone = 'America/Sao_Paulo' WHERE id = $1", [client.unitId])
    const [day, night] = await rows<{ id: string }>(
      t,
      `INSERT INTO shift (organization_id, unit_id, name, start_time, end_time, days_of_week) VALUES
         ($1, $2, 'Dia', '06:00', '14:00', '{1,2,3,4,5,6,7}'), ($1, $2, 'Noite', '22:00', '06:00', '{1,2,3,4,5,6,7}')
       RETURNING id`,
      [client.organizationId, client.unitId],
    )
    // 13:00 UTC = 10:00 em São Paulo: cai no turno "Dia" de 2026-11-11, não no noturno nem em outro dia.
    for (const [shiftId, date] of [
      [day!.id, "2026-11-11"],
      [day!.id, "2026-11-10"],
      [night!.id, "2026-11-10"],
    ] as const) {
      await t.client.query(
        "INSERT INTO oee_shift (organization_id, machine_id, shift_date, shift_id, dirty, calculated_at) VALUES ($1, $2, $3, $4, false, now())",
        [client.organizationId, id(MCH_INJ), date, shiftId],
      )
    }
    await syncOk(client, remap(REALISTIC))
    const dirty = await rows<{ shift_date: string; dirty: boolean }>(
      t,
      "SELECT shift_date::text, dirty FROM oee_shift WHERE machine_id = $1 ORDER BY shift_date, shift_id = $2 DESC",
      [id(MCH_INJ), day!.id],
    )
    expect(dirty).toEqual([
      { shift_date: "2026-11-10", dirty: false },
      { shift_date: "2026-11-10", dirty: false },
      { shift_date: "2026-11-11", dirty: true },
    ])
  })

  it("timestamp além de server_time + 2 min → 400 timestamp_out_of_range, nada gravado", async () => {
    const { client, remap } = await freshClient()
    const batch = remap(REALISTIC)
    const res = await sync(client, batch, new Date("2026-11-11T12:59:00.000Z"))
    expect(res.status).toBe(400)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error.code).toBe("timestamp_out_of_range")
    expect(body.error.issues?.[0]?.path).toEqual(["events", 3, "at"])
    expect(Object.values(await dataFootprint(t, client.organizationId)).every((n) => n === 0)).toBe(true)
  })

  it("gateway sem config publicada anuncia latest_version 0", async () => {
    const { client, remap } = await freshClient()
    await t.client.query("UPDATE gateway SET config_version_latest = 0 WHERE id = $1", [client.gatewayId])
    const res = await syncOk(client, remap(HEALTH_ONLY))
    expect(res.config.latest_version).toBe(0)
    expect(res.next_sync_s).toBe(10)
  })
})
