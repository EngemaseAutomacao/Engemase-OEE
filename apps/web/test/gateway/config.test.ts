/**
 * GET /api/gateway/v1/config: snapshot da última versão publicada, ETag = versão, If-None-Match → 304.
 * Segue o uso do agente Go (internal/app: guarda a ETag e manda em If-None-Match).
 */
import { ErrorResponseSchema, type GatewayConfig, GatewayConfigSchema, SyncResponseSchema } from "@engemase/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { handleConfig, handleSync } from "@/lib/server/gateway/handlers"
import {
  configRequest,
  createTestDatabase,
  deps,
  EXAMPLE_CONFIG,
  fixture,
  remapIds,
  type SeededClient,
  seedClient,
  syncRequest,
  type TestDatabase,
} from "./support"

describe("GET /config", () => {
  let t: TestDatabase
  let acme: SeededClient
  let seq = 0

  beforeAll(async () => {
    t = await createTestDatabase()
    acme = await seedClient(t.db, { slug: "acme" })
  })

  afterAll(async () => {
    await t.client.close()
  })

  async function get(client: SeededClient, ifNoneMatch?: string): Promise<Response> {
    return handleConfig(configRequest({ token: client.token, ...(ifNoneMatch !== undefined ? { ifNoneMatch } : {}) }), deps(t))
  }

  async function freshClient(): Promise<SeededClient> {
    return seedClient(t.db, { slug: `cfg-${++seq}`, config: remapIds(EXAMPLE_CONFIG, new Map()) })
  }

  async function publish(client: SeededClient, config: GatewayConfig): Promise<void> {
    await t.client.query(
      "INSERT INTO gateway_config_version (organization_id, gateway_id, version, snapshot) VALUES ($1, $2, $3, $4::jsonb)",
      [client.organizationId, client.gatewayId, config.config_version, JSON.stringify(config)],
    )
    await t.client.query("UPDATE gateway SET config_version_latest = $2 WHERE id = $1", [client.gatewayId, config.config_version])
  }

  it("200 com a config publicada (fixture do contrato) e ETag da versão", async () => {
    const res = await get(acme)
    expect(res.status).toBe(200)
    expect(res.headers.get("etag")).toBe('"42"')
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    const body: unknown = await res.json()
    expect(body).toEqual(EXAMPLE_CONFIG)
    expect(GatewayConfigSchema.safeParse(body).success).toBe(true)
  })

  it("If-None-Match igual → 304 sem corpo (também com lista, W/ e *)", async () => {
    for (const header of ['"42"', 'W/"42"', '"41", "42"', "*"]) {
      const res = await get(acme, header)
      expect(res.status, header).toBe(304)
      expect(res.headers.get("etag")).toBe('"42"')
      expect(await res.text()).toBe("")
    }
    expect((await get(acme, '"41"')).status).toBe(200)
  })

  it("versão nova publicada: /sync anuncia, ETag antiga → 200 com a nova, depois 304", async () => {
    const client = await freshClient()
    const first = await get(client)
    const etag = first.headers.get("etag")
    expect(etag).toBe('"42"')

    const v43: GatewayConfig = { ...client.config, config_version: 43, uplink: { ...client.config.uplink, sync_interval_s: 15 } }
    await publish(client, v43)

    const sync = await handleSync(syncRequest(fixture("sync-request.valid.health-only"), { token: client.token }), deps(t))
    expect(SyncResponseSchema.parse(await sync.json()).config.latest_version).toBe(43)

    const changed = await get(client, etag!)
    expect(changed.status).toBe(200)
    expect(changed.headers.get("etag")).toBe('"43"')
    expect(((await changed.json()) as GatewayConfig).config_version).toBe(43)
    expect((await get(client, '"43"')).status).toBe(304)
  })

  it("sem config publicada → 404 not_found", async () => {
    const client = await freshClient()
    await t.client.query("UPDATE gateway SET config_version_latest = 0 WHERE id = $1", [client.gatewayId])
    const res = await get(client)
    expect(res.status).toBe(404)
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("not_found")
  })

  it("snapshot ausente ou fora do contrato → 500 internal_error (nunca serve config quebrada)", async () => {
    const client = await freshClient()
    await t.client.query("UPDATE gateway SET config_version_latest = 99 WHERE id = $1", [client.gatewayId])
    const missing = await get(client)
    expect(missing.status).toBe(500)
    expect(ErrorResponseSchema.parse(await missing.json()).error.code).toBe("internal_error")

    await publish(client, { ...client.config, config_version: 100, uplink: { sync_interval_s: 0, max_batch_items: 1 } })
    expect((await get(client)).status).toBe(500)
  })

  it("sem token ou com token inválido → 401", async () => {
    const res = await handleConfig(configRequest(), deps(t))
    expect(res.status).toBe(401)
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("unauthorized")
    const bad = await handleConfig(configRequest({ token: `gw_live_${"x".repeat(43)}` }), deps(t))
    expect(bad.status).toBe(401)
  })
})
