/**
 * POST /api/gateway/v1/enroll: código de ativação de uso único (hash no banco) → token do gateway.
 */
import { createHash } from "node:crypto"
import { type EnrollRequest, EnrollResponseSchema, ErrorResponseSchema, SyncResponseSchema } from "@engemase/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { handleEnroll, handleSync } from "@/lib/server/gateway/handlers"
import {
  createTestDatabase,
  deps,
  enrollRequest,
  fixture,
  manifest,
  randomActivationCode,
  rows,
  type SeededClient,
  seedClient,
  seedEnrollment,
  syncRequest,
  type TestDatabase,
} from "./support"

const VALID = fixture<EnrollRequest>("enroll-request.valid")
const HEALTH_ONLY = fixture("sync-request.valid.health-only")

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

describe("POST /enroll", () => {
  let t: TestDatabase
  let acme: SeededClient

  beforeAll(async () => {
    t = await createTestDatabase()
    acme = await seedClient(t.db, { slug: "acme" })
  })

  afterAll(async () => {
    await t.client.close()
  })

  async function enroll(body: unknown): Promise<{ status: number; json: unknown }> {
    const res = await handleEnroll(enrollRequest(body), deps(t))
    return { status: res.status, json: await res.json() }
  }

  function expectError(result: { status: number; json: unknown }, status: number, code: string): void {
    expect(result.status, JSON.stringify(result.json)).toBe(status)
    expect(ErrorResponseSchema.parse(result.json).error.code).toBe(code)
  }

  it("caminho feliz (fixture do contrato): 201, token válido, código usado e gateway ativo", async () => {
    const { gatewayId } = await seedEnrollment(t.db, acme, { code: VALID.code })
    const res = await handleEnroll(enrollRequest(VALID, { headers: { "X-Forwarded-For": "203.0.113.7, 10.0.0.1" } }), deps(t))
    expect(res.status).toBe(201)
    const body = EnrollResponseSchema.parse(await res.json())
    expect(body.gateway_id).toBe(gatewayId)
    expect(body.org).toBe("acme")
    expect(body.token).toMatch(/^gw_live_[A-Za-z0-9_-]{43}$/)

    const [gw] = await rows<{ status: string; token_hash: string; hostname: string; agent_version: string; hw_info: unknown }>(
      t,
      "SELECT status, token_hash, hostname, agent_version, hw_info FROM gateway WHERE id = $1",
      [gatewayId],
    )
    expect(gw).toEqual({
      status: "active",
      token_hash: sha256(body.token),
      hostname: "egw-00042",
      agent_version: "1.0.0",
      hw_info: VALID.hw,
    })
    const [enrollment] = await rows<{ used: boolean }>(t, "SELECT used_at IS NOT NULL AS used FROM gateway_enrollment WHERE gateway_id = $1", [gatewayId])
    expect(enrollment?.used).toBe(true)
    const audit = await rows<{ action: string; ip: string; actor_type: string }>(
      t,
      "SELECT action, host(ip) AS ip, actor_type FROM audit_log WHERE entity_id = $1",
      [gatewayId],
    )
    expect(audit).toEqual([{ action: "gateway.enrolled", ip: "203.0.113.7", actor_type: "gateway" }])

    // O token recebido já autentica o /sync.
    const sync = await handleSync(syncRequest(HEALTH_ONLY, { token: body.token }), deps(t))
    expect(sync.status).toBe(200)
    expect(SyncResponseSchema.parse(await sync.json()).config.latest_version).toBe(0)
  })

  it("aceita o código sem hífen (normalizado como ABCD-1234)", async () => {
    const code = randomActivationCode()
    await seedEnrollment(t.db, acme, { code })
    const res = await enroll({ ...VALID, code: code.replace("-", "") })
    expect(res.status).toBe(201)
  })

  it("código reutilizado: recusado e o token emitido antes continua valendo", async () => {
    const code = randomActivationCode()
    await seedEnrollment(t.db, acme, { code })
    const first = await enroll({ ...VALID, code })
    expect(first.status).toBe(201)
    const token = EnrollResponseSchema.parse(first.json).token

    expectError(await enroll({ ...VALID, code }), 400, "activation_code_invalid")
    const sync = await handleSync(syncRequest(HEALTH_ONLY, { token }), deps(t))
    expect(sync.status).toBe(200)
  })

  it("código vencido: recusado, gateway continua aguardando ativação", async () => {
    const code = randomActivationCode()
    const now = Date.now()
    const { gatewayId } = await seedEnrollment(t.db, acme, {
      code,
      createdAt: new Date(now - 48 * 3_600_000),
      expiresAt: new Date(now - 24 * 3_600_000),
    })
    expectError(await enroll({ ...VALID, code }), 400, "activation_code_invalid")
    const [gw] = await rows<{ status: string; token_hash: string | null }>(t, "SELECT status, token_hash FROM gateway WHERE id = $1", [gatewayId])
    expect(gw).toEqual({ status: "pending_enrollment", token_hash: null })
  })

  it("código inexistente e código de gateway revogado: recusados", async () => {
    expectError(await enroll({ ...VALID, code: "ZZZZ-9999" }), 400, "activation_code_invalid")
    const code = randomActivationCode()
    await seedEnrollment(t.db, acme, { code, gatewayStatus: "revoked" })
    expectError(await enroll({ ...VALID, code }), 400, "activation_code_invalid")
  })

  it("dois /enroll simultâneos com o mesmo código: só um vence", async () => {
    const code = randomActivationCode()
    await seedEnrollment(t.db, acme, { code })
    const results = await Promise.all([enroll({ ...VALID, code }), enroll({ ...VALID, code })])
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    const loser = results.find((r) => r.status !== 201)
    expect(["activation_code_invalid", "activation_code_used"]).toContain(ErrorResponseSchema.parse(loser?.json).error.code)
  })

  it("reativar um gateway ativo (troca de hardware) troca o token: o antigo deixa de valer", async () => {
    const code1 = randomActivationCode()
    const { gatewayId } = await seedEnrollment(t.db, acme, { code: code1 })
    const old = EnrollResponseSchema.parse((await enroll({ ...VALID, code: code1 })).json).token

    const code2 = randomActivationCode()
    await t.client.query(
      "INSERT INTO gateway_enrollment (organization_id, gateway_id, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')",
      [acme.organizationId, gatewayId, sha256(code2)],
    )
    const fresh = EnrollResponseSchema.parse((await enroll({ ...VALID, code: code2 })).json)
    expect(fresh.gateway_id).toBe(gatewayId)
    expect((await handleSync(syncRequest(HEALTH_ONLY, { token: old }), deps(t))).status).toBe(401)
    expect((await handleSync(syncRequest(HEALTH_ONLY, { token: fresh.token }), deps(t))).status).toBe(200)
  })

  it.each(manifest("enroll-request", false).map((f) => [f.file, f] as const))(
    "fixture inválida %s → 400 invalid_payload com issues",
    async (_file, entry) => {
      const res = await enroll(fixture(entry.file))
      expectError(res, 400, "invalid_payload")
      const issues = ErrorResponseSchema.parse(res.json).error.issues ?? []
      expect(issues.length).toBeGreaterThan(0)
      if (entry.expect?.path !== undefined) {
        expect(issues.map((i) => i.path.join("."))).toContain(entry.expect.path)
      }
    },
  )
})
