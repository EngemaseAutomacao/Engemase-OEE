/**
 * Camada HTTP da API dos gateways: autenticação (401), formato de erro do contrato para payload
 * inválido (todas as fixtures inválidas do /sync), Content-Type/Encoding, limites de tamanho, 503 sem
 * banco (inclusive pelos route.ts do Next.js, sem DATABASE_URL) e 500 com request_id.
 */
import { gzipSync } from "node:zlib"
import { ErrorResponseSchema, MAX_SYNC_BODY_BYTES, type SyncRequest } from "@engemase/contracts"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { hashGatewayToken } from "@/lib/server/gateway/auth"
import { handleConfig, handleEnroll, handleSync } from "@/lib/server/gateway/handlers"
import type { GatewayDb } from "@/lib/server/gateway/types"
import {
  createTestDatabase,
  dataFootprint,
  deps,
  enrollRequest,
  EXAMPLE_CONFIG,
  fixture,
  FIXTURE_NOW,
  manifest,
  remapIds,
  type SeededClient,
  seedClient,
  syncRequest,
  type TestDatabase,
} from "./support"

const HEALTH_ONLY = fixture<SyncRequest>("sync-request.valid.health-only")

async function errorOf(res: Response): Promise<{ status: number; code: string; body: ReturnType<typeof ErrorResponseSchema.parse> }> {
  const body = ErrorResponseSchema.parse(await res.json())
  return { status: res.status, code: body.error.code, body }
}

describe("HTTP da API dos gateways", () => {
  let t: TestDatabase
  let acme: SeededClient

  beforeAll(async () => {
    t = await createTestDatabase()
    acme = await seedClient(t.db, { slug: "acme" })
  })

  afterAll(async () => {
    await t.client.close()
  })

  const sync = (body: unknown, options: Parameters<typeof syncRequest>[1] = { token: acme.token }) =>
    handleSync(syncRequest(body, options), deps(t, FIXTURE_NOW))

  describe("401", () => {
    it.each([
      ["sem Authorization", null],
      ["token com formato errado", "abc"],
      ["token bem formado, mas inexistente", `gw_live_${"A".repeat(43)}`],
    ])("%s → unauthorized, sem ler o corpo", async (_name, token) => {
      // Corpo inválido de propósito: a autenticação vem antes da validação.
      const { status, code, body } = await errorOf(await sync({ nada: true }, { token }))
      expect([status, code]).toEqual([401, "unauthorized"])
      expect(body.error.request_id).toMatch(/.+/)
    })

    it("esquema diferente de Bearer → 401", async () => {
      const res = await sync(HEALTH_ONLY, { token: null, headers: { Authorization: `Basic ${acme.token}` } })
      expect(res.status).toBe(401)
    })

    it("gateway revogado → 401; token anterior vale só durante a rotação", async () => {
      const client = await seedClient(t.db, { slug: "rotacao", config: remapIds(EXAMPLE_CONFIG, new Map()) })
      const newToken = `gw_live_${"N".repeat(43)}`
      await t.client.query(
        `UPDATE gateway SET previous_token_hash = token_hash, previous_token_expires_at = now() + interval '10 minutes',
           token_hash = $2 WHERE id = $1`,
        [client.gatewayId, hashGatewayToken(newToken)],
      )
      expect((await sync(HEALTH_ONLY, { token: client.token })).status).toBe(200)
      expect((await sync(HEALTH_ONLY, { token: newToken })).status).toBe(200)
      await t.client.query("UPDATE gateway SET previous_token_expires_at = now() - interval '1 second' WHERE id = $1", [client.gatewayId])
      expect((await sync(HEALTH_ONLY, { token: client.token })).status).toBe(401)

      await t.client.query("UPDATE gateway SET status = 'revoked', revoked_at = now() WHERE id = $1", [client.gatewayId])
      expect(await errorOf(await sync(HEALTH_ONLY, { token: newToken }))).toMatchObject({ status: 401, code: "unauthorized" })
      expect((await handleConfig(new Request("http://x/api/gateway/v1/config", { headers: { Authorization: `Bearer ${newToken}` } }), deps(t))).status).toBe(401)
    })
  })

  describe("400 invalid_payload (formato de erro do contrato)", () => {
    it.each(manifest("sync-request", false).map((f) => [f.file, f] as const))("%s", async (_file, entry) => {
      const before = await dataFootprint(t, acme.organizationId)
      const { status, code, body } = await errorOf(await sync(fixture(entry.file)))
      expect([status, code]).toEqual([400, "invalid_payload"])
      const issues = body.error.issues ?? []
      expect(issues.length).toBeGreaterThan(0)
      if (entry.expect?.path !== undefined) expect(issues.map((i) => i.path.join("."))).toContain(entry.expect.path)
      if (entry.expect?.rule !== undefined) expect(issues.map((i) => i.rule)).toContain(entry.expect.rule)
      expect(await dataFootprint(t, acme.organizationId)).toEqual(before)
    })

    it("JSON malformado e gzip corrompido", async () => {
      expect(await errorOf(await sync("{ nada", { token: acme.token, gzip: false }))).toMatchObject({ status: 400, code: "invalid_payload" })
      const corrupt = gzipSync(JSON.stringify(HEALTH_ONLY)).subarray(0, 30)
      const req = new Request("http://x/api/gateway/v1/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${acme.token}`, "Content-Type": "application/json", "Content-Encoding": "gzip" },
        body: corrupt,
      })
      expect(await errorOf(await handleSync(req, deps(t, FIXTURE_NOW)))).toMatchObject({ status: 400, code: "invalid_payload" })
    })
  })

  describe("formato e tamanho do corpo", () => {
    it("sem gzip também é aceito", async () => {
      expect((await sync(HEALTH_ONLY, { token: acme.token, gzip: false })).status).toBe(200)
    })

    it("Content-Type que não é JSON ou Content-Encoding desconhecido → 415", async () => {
      const textPlain = await sync(HEALTH_ONLY, { token: acme.token, headers: { "Content-Type": "text/plain" } })
      expect(await errorOf(textPlain)).toMatchObject({ status: 415, code: "unsupported_media_type" })
      const brotli = await sync(HEALTH_ONLY, { token: acme.token, gzip: false, headers: { "Content-Encoding": "br" } })
      expect(await errorOf(brotli)).toMatchObject({ status: 415, code: "unsupported_media_type" })
    })

    it("acima de 1 MiB descompactado → 413 (com e sem gzip, inclusive 'bomba' de gzip)", async () => {
      const big = JSON.stringify({ ...HEALTH_ONLY, pad: " ".repeat(MAX_SYNC_BODY_BYTES) })
      expect(await errorOf(await sync(big, { token: acme.token, gzip: false }))).toMatchObject({ status: 413, code: "payload_too_large" })
      const compressed = gzipSync(big)
      expect(compressed.byteLength).toBeLessThan(10_000)
      expect(await errorOf(await sync(big, { token: acme.token }))).toMatchObject({ status: 413, code: "payload_too_large" })
    })

    it("um corpo de exatamente 1 MiB ainda passa do parser (e falha só no schema, se for o caso)", async () => {
      const base = JSON.stringify(HEALTH_ONLY)
      const exact = base.slice(0, -1) + " ".repeat(MAX_SYNC_BODY_BYTES - base.length) + "}"
      expect(Buffer.byteLength(exact)).toBe(MAX_SYNC_BODY_BYTES)
      expect((await sync(exact, { token: acme.token })).status).toBe(200)
    })
  })

  describe("503 e 500", () => {
    it("sem banco configurado → 503 service_unavailable com Retry-After", async () => {
      for (const res of [
        await handleSync(syncRequest(HEALTH_ONLY, { token: acme.token }), { db: null }),
        await handleEnroll(enrollRequest(fixture("enroll-request.valid")), { db: null }),
        await handleConfig(new Request("http://x/api/gateway/v1/config"), { db: null }),
      ]) {
        expect(await errorOf(res)).toMatchObject({ status: 503, code: "service_unavailable" })
        expect(res.headers.get("retry-after")).toBe("30")
      }
    })

    it("route.ts do Next.js sem DATABASE_URL → 503 (nada conecta na importação)", async () => {
      vi.stubEnv("DATABASE_URL", "")
      try {
        const syncRoute = await import("@/app/api/gateway/v1/sync/route")
        const enrollRoute = await import("@/app/api/gateway/v1/enroll/route")
        await import("@/app/api/gateway/v1/config/route")
        expect((await syncRoute.POST(syncRequest(HEALTH_ONLY, { token: acme.token }))).status).toBe(503)
        expect((await enrollRoute.POST(enrollRequest(fixture("enroll-request.valid")))).status).toBe(503)
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it("falha inesperada do banco → 500 internal_error com request_id, logada", async () => {
      const broken = {
        execute: () => Promise.reject(new Error("conexão caiu")),
        transaction: () => Promise.reject(new Error("conexão caiu")),
      } as unknown as GatewayDb
      const logged: unknown[] = []
      const res = await handleSync(
        syncRequest(HEALTH_ONLY, { token: acme.token, headers: { "x-vercel-id": "gru1::abc-123" } }),
        { db: broken, logError: (_message, error) => logged.push(error) },
      )
      const { status, code, body } = await errorOf(res)
      expect([status, code]).toEqual([500, "internal_error"])
      expect(body.error.request_id).toBe("gru1::abc-123")
      expect(res.headers.get("x-request-id")).toBe("gru1::abc-123")
      expect(logged).toHaveLength(1)
    })
  })
})
