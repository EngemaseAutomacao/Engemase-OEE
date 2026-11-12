/**
 * Isolamento entre clientes e entre gateways (docs/15, seção 4, item 7.3): o gateway do cliente B,
 * autenticado com o próprio token, tenta ler e gravar dados do cliente A usando ids do A (forjados
 * no corpo). Nada do A muda e nada do A aparece nas respostas do B.
 */
import {
  ErrorResponseSchema,
  type GatewayConfig,
  type SyncRequest,
  SyncResponseSchema,
} from "@engemase/contracts"
import * as s from "@engemase/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { handleConfig, handleSync } from "@/lib/server/gateway/handlers"
import {
  configRequest,
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
  uuidv7,
} from "./support"

const REALISTIC = fixture<SyncRequest>("sync-request.valid.realistic")
const HEALTH_ONLY = fixture<SyncRequest>("sync-request.valid.health-only")

describe("isolamento entre clientes e gateways", () => {
  let t: TestDatabase
  /** Cliente A, gateway 1: ids originais das fixtures. */
  let a1: SeededClient
  /** Cliente A, gateway 2: outras máquinas, mesma organização. */
  let a2: SeededClient
  /** Cliente B: outra organização. */
  let b: SeededClient
  let bRemap: <T>(value: T) => T
  let aCommandId: string
  let aFootprint: Record<string, number>
  let aSnapshot: unknown[]

  async function snapshotOfA(): Promise<unknown[]> {
    return rows(
      t,
      `SELECT 'live' AS k, machine_id::text AS id, state || '|' || at::text AS v FROM machine_live WHERE organization_id = $1
       UNION ALL SELECT 'dev', device_id::text, status || '|' || coalesce(latency_ms, -1) FROM gateway_device_status WHERE organization_id = $1
       UNION ALL SELECT 'cmd', id::text, status || '|' || coalesce(result::text, '') FROM gateway_command WHERE organization_id = $1
       UNION ALL SELECT 'min', machine_id::text || bucket_start::text, total || '|' || reject FROM production_minute WHERE organization_id = $1
       UNION ALL SELECT 'evt', id::text, state || '|' || coalesce(ended_at::text, '') FROM machine_state_event WHERE organization_id = $1
       UNION ALL SELECT 'gw', id::text, coalesce(last_seen_at::text, '') || '|' || coalesce(health::text, '') FROM gateway WHERE organization_id = $1
       ORDER BY 1, 2`,
      [a1.organizationId],
    )
  }

  beforeAll(async () => {
    t = await createTestDatabase()
    a1 = await seedClient(t.db, { slug: "alfa" })
    a2 = await seedClient(t.db, { slug: "alfa", into: a1, config: remapIds(EXAMPLE_CONFIG, new Map()) })
    const map = new Map<string, string>()
    bRemap = (value) => remapIds(value, map)
    b = await seedClient(t.db, { slug: "beta", config: bRemap(EXAMPLE_CONFIG) })

    // A já tem dados e um comando aguardando resultado.
    const res = await handleSync(syncRequest(REALISTIC, { token: a1.token }), deps(t, FIXTURE_NOW))
    expect(res.status).toBe(200)
    const [cmd] = await t.db
      .insert(s.gatewayCommand)
      .values({
        organizationId: a1.organizationId,
        gatewayId: a1.gatewayId,
        type: "tag.read",
        payload: {
          device_id: EXAMPLE_CONFIG.devices[0]!.id,
          address: { area: "holding_register", offset: 1004 },
          type: "uint32",
          word_order: "CDAB",
        },
        status: "sent",
        createdAt: new Date(FIXTURE_NOW.getTime() - 1000),
        expiresAt: new Date(FIXTURE_NOW.getTime() + 600_000),
      })
      .returning({ id: s.gatewayCommand.id })
    aCommandId = cmd!.id
    aFootprint = await dataFootprint(t, a1.organizationId)
    aSnapshot = await snapshotOfA()
  })

  afterAll(async () => {
    await t.client.close()
  })

  async function syncAs(client: SeededClient, body: unknown): Promise<Response> {
    return handleSync(syncRequest(body, { token: client.token }), deps(t, new Date(FIXTURE_NOW.getTime() + 1000)))
  }

  async function expectANotTouched(): Promise<void> {
    expect(await dataFootprint(t, a1.organizationId)).toEqual(aFootprint)
    expect(await snapshotOfA()).toEqual(aSnapshot)
  }

  it("B enviando o lote com as máquinas e tags do A → 400 unknown_reference e nada gravado", async () => {
    const res = await syncAs(b, REALISTIC)
    expect(res.status).toBe(400)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error.code).toBe("unknown_reference")
    const paths = (body.error.issues ?? []).map((i) => i.path.join("."))
    expect(paths).toEqual(expect.arrayContaining(["events.0.machine_id", "events.2.tag_id", "minutes.0.machine_id", "samples.0.tag_id"]))
    expect(paths).toHaveLength(4 + 1 + 6 + 5) // 4 eventos (+1 tag do counter_reset), 6 minutos, 5 amostras
    await expectANotTouched()
    expect(Object.values(await dataFootprint(t, b.organizationId)).every((n) => n === 0)).toBe(true)
  })

  it("um único item forjado no meio de um lote válido do B derruba o lote inteiro (nada parcial)", async () => {
    const batch = bRemap(REALISTIC)
    batch.minutes = [...(batch.minutes ?? [])]
    batch.minutes[2] = { ...batch.minutes[2]!, machine_id: EXAMPLE_CONFIG.machines[0]!.id }
    const res = await syncAs(b, batch)
    expect(res.status).toBe(400)
    expect(ErrorResponseSchema.parse(await res.json()).error.issues?.map((i) => i.path)).toEqual([["minutes", 2, "machine_id"]])
    await expectANotTouched()
    expect(Object.values(await dataFootprint(t, b.organizationId)).every((n) => n === 0)).toBe(true)
  })

  it("live, devices e command_results com ids do A são ignorados (sem erro, sem escrita no A)", async () => {
    const res = await syncAs(b, {
      batch: { sent_at: "2026-11-11T13:02:06.000Z" },
      agent: HEALTH_ONLY.agent,
      live: [{ machine_id: EXAMPLE_CONFIG.machines[0]!.id, at: "2026-11-11T13:02:06.000Z", state: "STOPPED", state_since: "2026-11-11T13:02:06.000Z" }],
      devices: [{ id: EXAMPLE_CONFIG.devices[0]!.id, status: "disconnected", errors_1m: 99 }],
      command_results: [
        { id: aCommandId, type: "tag.read", status: "ok", result: { value: 666, quality: "good", read_ms: 1 } },
      ],
    })
    expect(res.status).toBe(200)
    const body = SyncResponseSchema.parse(await res.json())
    // O comando pendente do A nunca aparece para o B.
    expect(body.commands).toEqual([])
    await expectANotTouched()
    expect(await count(t, "SELECT 1 FROM machine_live WHERE organization_id = $1", [b.organizationId])).toBe(0)
    expect(await count(t, "SELECT 1 FROM gateway_device_status WHERE organization_id = $1", [b.organizationId])).toBe(0)
    // A foto de saúde do próprio B não guarda os dispositivos alheios.
    const [gw] = await rows<{ health: Record<string, unknown> }>(t, "SELECT health FROM gateway WHERE id = $1", [b.gatewayId])
    expect(gw?.health.devices).toBeUndefined()
  })

  it("id de evento do A reaproveitado pelo B não sobrescreve o evento do A", async () => {
    const aEvent = REALISTIC.events![3]!
    const machineOfB = bRemap(EXAMPLE_CONFIG.machines[0]!.id)
    const res = await syncAs(b, {
      batch: { seq_from: 1, seq_to: 1, sent_at: "2026-11-11T13:02:06.000Z" },
      agent: HEALTH_ONLY.agent,
      events: [{ ...aEvent, seq: 1, machine_id: machineOfB, state: "STOPPED", fault_code: undefined }],
    })
    expect(res.status).toBe(200)
    await expectANotTouched()
    const [row] = await rows<{ organization_id: string; state: string }>(
      t,
      "SELECT organization_id, state FROM machine_state_event WHERE id = $1",
      [aEvent.id],
    )
    expect(row).toEqual({ organization_id: a1.organizationId, state: "FAULT" })
  })

  it("outro gateway do MESMO cliente não grava nas máquinas do gateway 1", async () => {
    const res = await syncAs(a2, REALISTIC)
    expect(res.status).toBe(400)
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("unknown_reference")
    await expectANotTouched()
  })

  it("máquina do cliente sem vínculo com o gateway é recusada", async () => {
    const [m] = await t.db
      .insert(s.machine)
      .values({ organizationId: a1.organizationId, unitId: a1.unitId, lineId: a1.lineId, name: "Sem gateway", stateRules: { mode: "signals" } })
      .returning({ id: s.machine.id })
    const res = await syncAs(a1, {
      batch: { seq_from: 90000, seq_to: 90000, sent_at: "2026-11-11T13:02:06.000Z" },
      agent: HEALTH_ONLY.agent,
      minutes: [{ ...REALISTIC.minutes![0]!, seq: 90000, machine_id: m!.id }],
    })
    expect(res.status).toBe(400)
    expect(ErrorResponseSchema.parse(await res.json()).error.issues?.[0]?.path).toEqual(["minutes", 0, "machine_id"])
    expect(await count(t, "SELECT 1 FROM production_minute WHERE machine_id = $1", [m!.id])).toBe(0)
  })

  it("GET /config devolve só a config do próprio gateway", async () => {
    const resB = await handleConfig(configRequest({ token: b.token }), deps(t))
    expect(resB.status).toBe(200)
    const configB = (await resB.json()) as GatewayConfig
    expect(configB.gateway_id).toBe(b.gatewayId)
    expect(JSON.stringify(configB)).not.toContain(EXAMPLE_CONFIG.machines[0]!.id)

    const resA = await handleConfig(configRequest({ token: a1.token }), deps(t))
    expect(((await resA.json()) as GatewayConfig).gateway_id).toBe(a1.gatewayId)
  })

  it("o B só enxerga as próprias linhas: a resposta não traz nada do A", async () => {
    const res = await syncAs(b, bRemap(REALISTIC))
    expect(res.status).toBe(200)
    const text = await res.text()
    for (const id of [a1.gatewayId, aCommandId, ...EXAMPLE_CONFIG.machines.map((m) => m.id)]) expect(text).not.toContain(id)
    await expectANotTouched()
    expect((await dataFootprint(t, b.organizationId)).production_minute).toBe(6)
  })

  it("ids aleatórios (UUIDv7 válidos que não existem) também viram unknown_reference", async () => {
    const res = await syncAs(b, {
      batch: { seq_from: 5, seq_to: 5, sent_at: "2026-11-11T13:02:06.000Z" },
      agent: HEALTH_ONLY.agent,
      samples: [{ seq: 5, tag_id: uuidv7(), at: "2026-11-11T13:02:00Z", v: 1 }],
    })
    expect(res.status).toBe(400)
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("unknown_reference")
  })
})
