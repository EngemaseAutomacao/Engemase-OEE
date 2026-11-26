/**
 * W6 na API dos gateways: limites de taxa no Postgres (429 + retry_after_s, L21), `409
 * config_outdated`, histórico de saúde (`gateway_health_sample`) e alerta de minuto reescrito.
 */
import { ErrorResponseSchema, type SyncRequest } from "@engemase/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type GatewayApiDeps, handleConfig, handleEnroll, handleSync } from "@/lib/server/gateway/handlers"
import { publishGatewayConfig } from "@/lib/server/gateway/publish"
import { DEFAULT_RATE_LIMITS } from "@/lib/server/gateway/rate-limit"
import { agentConfigOutdated } from "@/lib/server/gateway/sync"
import {
  configRequest,
  count,
  createTestDatabase,
  dataFootprint,
  deps,
  EXAMPLE_CONFIG,
  enrollRequest,
  fixture,
  FIXTURE_NOW,
  randomActivationCode,
  remapIds,
  rows,
  type SeededClient,
  seedClient,
  syncRequest,
  type TestDatabase,
} from "./support"

const HEALTH_ONLY = fixture<SyncRequest>("sync-request.valid.health-only")
const REALISTIC = fixture<SyncRequest>("sync-request.valid.realistic")
const ENROLL = fixture<Record<string, unknown>>("enroll-request.valid")

async function errorCode(res: Response): Promise<{ code: string; retry: number | undefined; header: string | null }> {
  const body = ErrorResponseSchema.parse(await res.json())
  return { code: body.error.code, retry: body.error.retry_after_s, header: res.headers.get("retry-after") }
}

describe("W6: limites, config desatualizada, saúde e alertas", () => {
  let t: TestDatabase
  let seq = 0

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  async function freshClient(): Promise<{ client: SeededClient; remap: <T>(v: T) => T }> {
    const map = new Map<string, string>()
    const remap = <T>(v: T): T => remapIds(v, map)
    return { client: await seedClient(t.db, { slug: `w6-${++seq}`, config: remap(EXAMPLE_CONFIG) }), remap }
  }

  function limited(at: Date): GatewayApiDeps {
    return { ...deps(t, at), rateLimits: DEFAULT_RATE_LIMITS }
  }

  describe("429 rate_limited (L21)", () => {
    it("/sync: 10 seguidos passam, o 11º leva 429 com retry_after_s e Retry-After; 1 s depois passa", async () => {
      const { client, remap } = await freshClient()
      const other = await freshClient()
      const body = remap(HEALTH_ONLY)
      const at = new Date("2026-11-24T12:00:00Z")
      for (let i = 0; i < 10; i++) {
        expect((await handleSync(syncRequest(body, { token: client.token }), limited(at))).status, `sync ${i + 1}`).toBe(200)
      }
      const blocked = await handleSync(syncRequest(body, { token: client.token }), limited(at))
      expect(blocked.status).toBe(429)
      expect(await errorCode(blocked)).toEqual({ code: "rate_limited", retry: 1, header: "1" })
      // Outro gateway não é afetado.
      expect((await handleSync(syncRequest(other.remap(HEALTH_ONLY), { token: other.client.token }), limited(at))).status).toBe(200)
      // Um segundo depois, passa uma.
      const later = new Date(at.getTime() + 1000)
      expect((await handleSync(syncRequest(body, { token: client.token }), limited(later))).status).toBe(200)
      expect((await handleSync(syncRequest(body, { token: client.token }), limited(later))).status).toBe(429)
    })

    it("/sync em ritmo de 1 por segundo (60/min) nunca é limitado", async () => {
      const { client, remap } = await freshClient()
      const body = remap(HEALTH_ONLY)
      const t0 = Date.parse("2026-11-24T12:00:00Z")
      for (let i = 0; i < 70; i++) {
        const res = await handleSync(syncRequest(body, { token: client.token }), limited(new Date(t0 + i * 1000)))
        expect(res.status, `sync no segundo ${i}`).toBe(200)
      }
    })

    it("sem autenticar não conta no limite do gateway (401 antes)", async () => {
      const { client, remap } = await freshClient()
      const at = new Date("2026-11-24T12:00:00Z")
      for (let i = 0; i < 15; i++) {
        expect((await handleSync(syncRequest(remap(HEALTH_ONLY), { token: `gw_live_${"x".repeat(43)}` }), limited(at))).status).toBe(401)
      }
      expect((await handleSync(syncRequest(remap(HEALTH_ONLY), { token: client.token }), limited(at))).status).toBe(200)
    })

    it("/config: 5 seguidos, depois 429 com retry de 2 s", async () => {
      const { client } = await freshClient()
      const at = new Date("2026-11-24T12:00:00Z")
      for (let i = 0; i < 5; i++) {
        expect((await handleConfig(configRequest({ token: client.token, ifNoneMatch: '"42"' }), limited(at))).status).toBe(304)
      }
      const blocked = await handleConfig(configRequest({ token: client.token }), limited(at))
      expect(blocked.status).toBe(429)
      expect(await errorCode(blocked)).toEqual({ code: "rate_limited", retry: 2, header: "2" })
    })

    it("/enroll: 10 por hora por IP; 5 tentativas por código (de qualquer IP)", async () => {
      const at = new Date("2026-11-24T12:00:00Z")
      const fromIp = (ip: string, code: string) =>
        handleEnroll(enrollRequest({ ...ENROLL, code }, { headers: { "X-Forwarded-For": ip } }), limited(at))

      for (let i = 0; i < 10; i++) expect((await fromIp("203.0.113.7", randomActivationCode())).status).toBe(400)
      const blocked = await fromIp("203.0.113.7", randomActivationCode())
      expect(blocked.status).toBe(429)
      expect(await errorCode(blocked)).toEqual({ code: "rate_limited", retry: 360, header: "360" })
      // Outro IP continua.
      expect((await fromIp("203.0.113.8", randomActivationCode())).status).toBe(400)

      const code = randomActivationCode()
      for (let i = 0; i < 5; i++) expect((await fromIp(`198.51.100.${i + 1}`, code)).status).toBe(400)
      const sixth = await fromIp("198.51.100.99", code.replace("-", ""))
      expect(sixth.status).toBe(429)
      expect((await errorCode(sixth)).retry).toBe(17_280)
      // O código não vai em claro para a chave do limitador.
      const keys = await rows<{ key: string }>(t, "SELECT key FROM api_rate_limit WHERE key LIKE 'enroll:code:%'")
      expect(keys.some((k) => k.key.includes(code))).toBe(false)
    })
  })

  describe("409 config_outdated", () => {
    it("regra: só com o agente atrás da última versão e sem tê-la recusado", () => {
      const agent = HEALTH_ONLY.agent
      expect(agentConfigOutdated({ ...agent, config_version: 42 }, 43)).toBe(true)
      expect(agentConfigOutdated({ ...agent, config_version: 43 }, 43)).toBe(false)
      expect(agentConfigOutdated({ ...agent, config_version: 42, config_status: { version: 43, state: "applying" } }, 43)).toBe(true)
      expect(agentConfigOutdated({ ...agent, config_version: 42, config_status: { version: 43, state: "rejected" } }, 43)).toBe(false)
      expect(agentConfigOutdated({ ...agent, config_version: 42, config_status: { version: 43, state: "reverted" } }, 43)).toBe(false)
    })

    it("máquina que saiu na config nova, com o agente na anterior → 409 e nada gravado; agente em dia → 400", async () => {
      const { client, remap } = await freshClient()
      const batch = remap(REALISTIC)
      const removed = batch.minutes![0]!.machine_id
      // A máquina sai do gateway (vínculo e tags) e a config 43 é publicada.
      await t.client.query("DELETE FROM tag WHERE machine_id = $1", [removed])
      await t.client.query("UPDATE machine SET active = false WHERE id = $1", [removed])
      await t.client.query("DELETE FROM gateway_machine WHERE machine_id = $1", [removed])
      const published = await publishGatewayConfig(t.db, { organizationId: client.organizationId, gatewayId: client.gatewayId })
      expect(published).toMatchObject({ kind: "published", version: 43 })

      const before = await dataFootprint(t, client.organizationId)
      const res = await handleSync(syncRequest(batch, { token: client.token }), deps(t, FIXTURE_NOW))
      expect(res.status).toBe(409)
      const body = ErrorResponseSchema.parse(await res.json())
      expect(body.error.code).toBe("config_outdated")
      expect(body.error.issues?.some((i) => i.path.join(".") === "minutes.0.machine_id")).toBe(true)
      expect(await dataFootprint(t, client.organizationId)).toEqual(before)

      // Agente já na 43 (ou que recusou a 43): o item é dele mesmo → 400, para isolar.
      for (const agent of [
        { ...batch.agent, config_version: 43 },
        { ...batch.agent, config_version: 42, config_status: { version: 43, state: "rejected" as const } },
      ]) {
        const again = await handleSync(syncRequest({ ...batch, agent }, { token: client.token }), deps(t, FIXTURE_NOW))
        expect(again.status).toBe(400)
        expect(ErrorResponseSchema.parse(await again.json()).error.code).toBe("unknown_reference")
      }
    })
  })

  describe("histórico de saúde do gateway", () => {
    it("uma linha a cada 5 min, com máximos, mínimos e contagem de /sync", async () => {
      const { client, remap } = await freshClient()
      const base = remap(REALISTIC)
      const health = remap(HEALTH_ONLY)
      const t0 = FIXTURE_NOW
      const ok = async (body: SyncRequest, at: Date) => {
        const res = await handleSync(syncRequest(body, { token: client.token }), deps(t, at))
        expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
      }
      await ok(base, t0)
      await ok({ ...health, agent: { ...health.agent, cpu_pct: 55, buffer_pending: 3, clock_offset_ms: -900, disk_free_mb: 100 } }, new Date(t0.getTime() + 10_000))
      await ok(health, new Date(t0.getTime() + 5 * 60_000))

      const samples = await rows<Record<string, unknown>>(
        t,
        `SELECT bucket_start, sync_count, agent_version, config_version, config_state, cpu_pct_max, disk_free_mb_min,
                buffer_pending_max, buffer_oldest_s_max, clock_offset_ms_max_abs, temp_c_max, devices_total, devices_connected_min
         FROM gateway_health_sample WHERE gateway_id = $1 ORDER BY bucket_start`,
        [client.gatewayId],
      )
      expect(samples).toHaveLength(2)
      expect(samples[0]).toMatchObject({
        bucket_start: new Date("2026-11-11T13:00:00Z"),
        sync_count: 2,
        agent_version: "1.2.0",
        config_version: 42,
        config_state: "applied",
        cpu_pct_max: 55,
        disk_free_mb_min: 100,
        buffer_pending_max: 15,
        buffer_oldest_s_max: 113,
        clock_offset_ms_max_abs: 900,
        temp_c_max: 47.5,
      })
      expect(samples[1]).toMatchObject({ bucket_start: new Date("2026-11-11T13:05:00Z"), sync_count: 1 })
    })
  })

  describe("alerta de minuto reescrito", () => {
    it("abre um alerta por máquina (regra do sistema, só Engemase) e soma as reescritas", async () => {
      const { client, remap } = await freshClient()
      const batch = remap(REALISTIC)
      const ok = async (body: SyncRequest) => {
        const res = await handleSync(syncRequest(body, { token: client.token }), deps(t, FIXTURE_NOW))
        expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
      }
      await ok(batch)
      // Nada reescrito ainda: nem regra criada.
      expect(await count(t, "SELECT 1 FROM alert_rule WHERE organization_id = $1", [client.organizationId])).toBe(0)

      const minute = batch.minutes![0]!
      const rewrite = (seqNo: number, total: number): SyncRequest => ({
        batch: { seq_from: seqNo, seq_to: seqNo, sent_at: "2026-11-11T13:02:06.000Z" },
        agent: batch.agent,
        minutes: [{ ...minute, seq: seqNo, total }],
      })
      await ok(rewrite(18300, minute.total + 1))
      await ok(rewrite(18301, minute.total + 2))
      await ok(rewrite(18302, minute.total + 2)) // igual ao gravado: não é reescrita

      const rules = await rows<{ type: string; system_key: string; severity: string; recipients: unknown }>(
        t,
        "SELECT type, system_key, severity, recipients FROM alert_rule WHERE organization_id = $1",
        [client.organizationId],
      )
      expect(rules).toEqual([
        { type: "engemase_ops", system_key: "minute_rewritten", severity: "warning", recipients: { includeEngemaseSupport: true } },
      ])
      const alerts = await rows<{ machine_id: string; gateway_id: string; state: string; dedup_key: string; data: { count: number } }>(
        t,
        "SELECT machine_id, gateway_id, state, dedup_key, data FROM alert_event WHERE organization_id = $1",
        [client.organizationId],
      )
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toMatchObject({ machine_id: minute.machine_id, gateway_id: client.gatewayId, state: "open" })
      expect(alerts[0]?.data).toMatchObject({ kind: "minute_rewritten", count: 2, last_minute: minute.t })

      // Regra desativada pelo cliente: nenhuma ocorrência nova.
      await t.client.query("UPDATE alert_rule SET active = false WHERE organization_id = $1", [client.organizationId])
      await ok(rewrite(18303, minute.total + 3))
      const [after] = await rows<{ data: { count: number } }>(t, "SELECT data FROM alert_event WHERE organization_id = $1", [
        client.organizationId,
      ])
      expect(after?.data.count).toBe(2)
      // A reescrita em si continua gravada e auditada.
      expect(
        await count(t, "SELECT 1 FROM audit_log WHERE organization_id = $1 AND action = 'production_minute.rewritten'", [client.organizationId]),
      ).toBe(3)
    })
  })
})
