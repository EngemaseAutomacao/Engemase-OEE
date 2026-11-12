/**
 * POST /api/gateway/v1/enroll: código de ativação de uso único (hash no banco) → token do gateway.
 * Erros do contrato pelo estado do código (docs/04): desconhecido ou de gateway revogado → 400
 * `activation_code_invalid`; já usado → 410 `activation_code_used`; vencido → 410
 * `activation_code_expired`. O slug do cliente sai sob a RLS de `organization`, e a resposta nunca
 * sai fora do contrato (slug inválido → 500 com tudo desfeito).
 */
import { createHash } from "node:crypto"
import { type EnrollRequest, EnrollResponseSchema, ErrorResponseSchema, SyncResponseSchema } from "@engemase/contracts"
import { ORG_SLUG_PATTERN } from "@engemase/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { EnrollIntegrityError } from "@/lib/server/gateway/enroll"
import { handleEnroll, handleSync } from "@/lib/server/gateway/handlers"
import {
  createTestDatabase,
  deps,
  enrollRequest,
  EXAMPLE_CONFIG,
  fixture,
  manifest,
  randomActivationCode,
  remapIds,
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

  async function enroll(body: unknown, now?: Date): Promise<{ status: number; json: unknown }> {
    const res = await handleEnroll(enrollRequest(body), deps(t, now))
    return { status: res.status, json: await res.json() }
  }

  /** Confere status e código do erro e que a resposta não revela ids do banco (gateway, cliente, código). */
  function expectError(
    result: { status: number; json: unknown },
    status: number,
    code: string,
    hiddenIds: readonly string[] = [],
  ): void {
    expect(result.status, JSON.stringify(result.json)).toBe(status)
    expect(ErrorResponseSchema.parse(result.json).error.code).toBe(code)
    const text = JSON.stringify(result.json)
    for (const id of [acme.organizationId, ...hiddenIds]) expect(text).not.toContain(id)
  }

  async function enrollmentState(gatewayId: string): Promise<{ status: string; token_hash: string | null; used: boolean } | undefined> {
    const [row] = await rows<{ status: string; token_hash: string | null; used: boolean }>(
      t,
      `SELECT g.status, g.token_hash, e.used_at IS NOT NULL AS used
       FROM gateway g JOIN gateway_enrollment e ON e.gateway_id = g.id WHERE g.id = $1`,
      [gatewayId],
    )
    return row
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

  it("código reutilizado: 410 activation_code_used e o token emitido antes continua valendo", async () => {
    const code = randomActivationCode()
    const { gatewayId, enrollmentId } = await seedEnrollment(t.db, acme, { code })
    const first = await enroll({ ...VALID, code })
    expect(first.status).toBe(201)
    const token = EnrollResponseSchema.parse(first.json).token

    expectError(await enroll({ ...VALID, code }), 410, "activation_code_used", [gatewayId, enrollmentId])
    const [gw] = await rows<{ token_hash: string }>(t, "SELECT token_hash FROM gateway WHERE id = $1", [gatewayId])
    expect(gw?.token_hash).toBe(sha256(token))
    const sync = await handleSync(syncRequest(HEALTH_ONLY, { token }), deps(t))
    expect(sync.status).toBe(200)
  })

  it("código vencido: 410 activation_code_expired, gateway continua aguardando ativação", async () => {
    const code = randomActivationCode()
    const now = Date.now()
    const { gatewayId, enrollmentId } = await seedEnrollment(t.db, acme, {
      code,
      createdAt: new Date(now - 48 * 3_600_000),
      expiresAt: new Date(now - 24 * 3_600_000),
    })
    expectError(await enroll({ ...VALID, code }), 410, "activation_code_expired", [gatewayId, enrollmentId])
    expect(await enrollmentState(gatewayId)).toEqual({ status: "pending_enrollment", token_hash: null, used: false })
  })

  it("código que vence entre a busca e a transação (relógio do servidor): 410 expired e nada fica marcado", async () => {
    const code = randomActivationCode()
    const { gatewayId } = await seedEnrollment(t.db, acme, { code, expiresAt: new Date(Date.now() + 3_600_000) })
    // Para o banco o código ainda vale; para o relógio da requisição já venceu.
    expectError(await enroll({ ...VALID, code }, new Date(Date.now() + 2 * 3_600_000)), 410, "activation_code_expired", [gatewayId])
    expect(await enrollmentState(gatewayId)).toEqual({ status: "pending_enrollment", token_hash: null, used: false })
    // O erro desfez a marcação de uso: no relógio certo, o mesmo código ativa.
    expect((await enroll({ ...VALID, code })).status).toBe(201)
  })

  it("código inexistente e código de gateway revogado ou excluído: 400 activation_code_invalid", async () => {
    expectError(await enroll({ ...VALID, code: "ZZZZ-9999" }), 400, "activation_code_invalid")

    const revokedCode = randomActivationCode()
    const revoked = await seedEnrollment(t.db, acme, { code: revokedCode, gatewayStatus: "revoked" })
    expectError(await enroll({ ...VALID, code: revokedCode }), 400, "activation_code_invalid", [revoked.gatewayId, revoked.enrollmentId])

    const deletedCode = randomActivationCode()
    const deleted = await seedEnrollment(t.db, acme, { code: deletedCode })
    await t.client.query("UPDATE gateway SET deleted_at = now() WHERE id = $1", [deleted.gatewayId])
    expectError(await enroll({ ...VALID, code: deletedCode }), 400, "activation_code_invalid", [deleted.gatewayId, deleted.enrollmentId])
    expect(await enrollmentState(deleted.gatewayId)).toEqual({ status: "pending_enrollment", token_hash: null, used: false })
  })

  it("dois /enroll simultâneos com o mesmo código: só um vence, o outro recebe 410 activation_code_used", async () => {
    const code = randomActivationCode()
    await seedEnrollment(t.db, acme, { code })
    const results = await Promise.all([enroll({ ...VALID, code }), enroll({ ...VALID, code })])
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    const loser = results.find((r) => r.status !== 201)
    expectError(loser!, 410, "activation_code_used")
  })

  it("slug do cliente sai sob a RLS de organization (que só mostra o cliente da transação)", async () => {
    const beta = await seedClient(t.db, { slug: "beta", config: remapIds(EXAMPLE_CONFIG, new Map()) })

    // A RLS está de fato ligada e forçada: sem cliente o app_user não vê nenhum; com o beta, só o beta.
    const [rls] = await rows<{ enabled: boolean; forced: boolean }>(
      t,
      "SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'public.organization'::regclass",
    )
    expect(rls).toEqual({ enabled: true, forced: true })
    const visible = await t.client.transaction(async (tx) => {
      await tx.query("SET LOCAL ROLE app_user")
      const none = (await tx.query<{ slug: string }>("SELECT slug FROM organization")).rows
      await tx.query("SELECT app.set_tenant($1)", [beta.organizationId])
      const own = (await tx.query<{ slug: string }>("SELECT slug FROM organization")).rows
      return { none, own }
    })
    expect(visible).toEqual({ none: [], own: [{ slug: "beta" }] })

    const { gatewayId, code } = await seedEnrollment(t.db, beta)
    const res = await enroll({ ...VALID, code })
    expect(res.status, JSON.stringify(res.json)).toBe(201)
    const body = EnrollResponseSchema.parse(res.json)
    expect(body).toMatchObject({ gateway_id: gatewayId, org: "beta" })
  })

  it("slug do cliente fora do contrato (dado que escapou da CHECK): 500, sem gastar o código nem ativar o gateway", async () => {
    // Desde a 0004 o banco recusa esse slug (organization_slug_chk); aqui simulamos um dado anterior a ela.
    await t.client.query("ALTER TABLE organization DROP CONSTRAINT organization_slug_chk")
    const legacy = await seedClient(t.db, { slug: "Acme_Ltda", config: remapIds(EXAMPLE_CONFIG, new Map()) }).finally(() =>
      t.client.query(`ALTER TABLE organization ADD CONSTRAINT organization_slug_chk CHECK (slug ~ '${ORG_SLUG_PATTERN}') NOT VALID`),
    )
    const { gatewayId, enrollmentId, code } = await seedEnrollment(t.db, legacy)

    const logged: unknown[] = []
    const res = await handleEnroll(enrollRequest({ ...VALID, code }), { ...deps(t), logError: (_message, error) => logged.push(error) })
    const json: unknown = await res.json()
    expect(res.status, JSON.stringify(json)).toBe(500)
    expect(ErrorResponseSchema.parse(json).error.code).toBe("internal_error")
    for (const id of [legacy.organizationId, gatewayId, enrollmentId]) expect(JSON.stringify(json)).not.toContain(id)
    // Tudo desfeito: o código continua valendo e o gateway segue aguardando ativação, sem auditoria.
    expect(await enrollmentState(gatewayId)).toEqual({ status: "pending_enrollment", token_hash: null, used: false })
    expect(await rows(t, "SELECT 1 FROM audit_log WHERE entity_id = $1", [gatewayId])).toEqual([])
    expect(logged).toEqual([expect.any(EnrollIntegrityError)])
    expect(String(logged[0])).toContain("Acme_Ltda")
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
