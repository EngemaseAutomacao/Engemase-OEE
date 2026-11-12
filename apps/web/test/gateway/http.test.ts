/**
 * Camada HTTP da API dos gateways: autenticação (401 `unauthorized` / `token_revoked`, rotação de
 * token, revogação, reativação ou fim da rotação no meio do caminho — com o corpo ainda chegando —
 * e o estado do token recalculado na transação igual ao da busca), formato de erro do contrato para payload
 * inválido (todas as fixtures inválidas do /sync), Content-Type/Encoding, limites de tamanho, 503 sem
 * banco (inclusive pelos route.ts do Next.js, sem DATABASE_URL) e 500 com request_id.
 */
import { randomBytes } from "node:crypto"
import { gzipSync } from "node:zlib"
import {
  API_ROUTES,
  type EnrollRequest,
  EnrollResponseSchema,
  ErrorResponseSchema,
  MAX_SYNC_BODY_BYTES,
  type SyncRequest,
  SyncResponseSchema,
} from "@engemase/contracts"
import { gateway, resolveGatewayTokenState, withTenant } from "@engemase/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { authenticateGateway, hashGatewayToken, tokenStateInTx } from "@/lib/server/gateway/auth"
import { loadGatewayConfig } from "@/lib/server/gateway/config"
import { hashActivationCode } from "@/lib/server/gateway/enroll"
import { handleConfig, handleEnroll, handleSync } from "@/lib/server/gateway/handlers"
import { processSync } from "@/lib/server/gateway/sync"
import { type GatewayDb, rowsExecutor } from "@/lib/server/gateway/types"
import {
  createTestDatabase,
  dataFootprint,
  deps,
  enrollRequest,
  EXAMPLE_CONFIG,
  fixture,
  FIXTURE_NOW,
  manifest,
  randomActivationCode,
  remapIds,
  rows,
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

    const config = (token: string) =>
      handleConfig(new Request("http://x/api/gateway/v1/config", { headers: { Authorization: `Bearer ${token}` } }), deps(t))

    /** Rotação em andamento: token novo já gravado, o anterior vale por mais 10 min (docs/04). */
    async function rotatingClient(
      slug: string,
      ids: Map<string, string> = new Map(),
    ): Promise<{ client: SeededClient; newToken: string }> {
      const client = await seedClient(t.db, { slug, config: remapIds(EXAMPLE_CONFIG, ids) })
      const newToken = `gw_live_${randomBytes(32).toString("base64url")}`
      await t.client.query(
        `UPDATE gateway SET previous_token_hash = token_hash, previous_token_expires_at = now() + interval '10 minutes',
           token_hash = $2 WHERE id = $1`,
        [client.gatewayId, hashGatewayToken(newToken)],
      )
      return { client, newToken }
    }

    it("token anterior vale só durante a rotação; depois → 401 unauthorized", async () => {
      const { client, newToken } = await rotatingClient("rotacao")
      expect((await sync(HEALTH_ONLY, { token: client.token })).status).toBe(200)
      expect((await sync(HEALTH_ONLY, { token: newToken })).status).toBe(200)
      expect((await config(client.token)).status).toBe(200)
      await t.client.query("UPDATE gateway SET previous_token_expires_at = now() - interval '1 second' WHERE id = $1", [client.gatewayId])
      expect(await errorOf(await sync(HEALTH_ONLY, { token: client.token }))).toMatchObject({ status: 401, code: "unauthorized" })
      expect((await sync(HEALTH_ONLY, { token: newToken })).status).toBe(200)
    })

    it("gateway revogado → 401 token_revoked (token atual e anterior, /sync e /config), sem ids na resposta", async () => {
      const { client, newToken } = await rotatingClient("revogado")
      await t.client.query("UPDATE gateway SET status = 'revoked', revoked_at = now() WHERE id = $1", [client.gatewayId])
      for (const token of [newToken, client.token]) {
        const res = await errorOf(await sync({ nada: true }, { token }))
        expect(res).toMatchObject({ status: 401, code: "token_revoked" })
        expect(JSON.stringify(res.body)).not.toContain(client.gatewayId)
        expect(JSON.stringify(res.body)).not.toContain(client.organizationId)
        expect(await errorOf(await config(token))).toMatchObject({ status: 401, code: "token_revoked" })
      }
      // Revogado não deixa rastro de sync: nem last_seen_at, nem saúde.
      expect(await rows(t, "SELECT last_seen_at FROM gateway WHERE id = $1", [client.gatewayId])).toEqual([{ last_seen_at: null }])
    })

    it("gateway excluído → 401 token_revoked", async () => {
      const client = await seedClient(t.db, { slug: "excluido", config: remapIds(EXAMPLE_CONFIG, new Map()) })
      await t.client.query("UPDATE gateway SET deleted_at = now() WHERE id = $1", [client.gatewayId])
      expect(await errorOf(await sync(HEALTH_ONLY, { token: client.token }))).toMatchObject({ status: 401, code: "token_revoked" })
      expect(await errorOf(await config(client.token))).toMatchObject({ status: 401, code: "token_revoked" })
    })

    it("gateway aguardando nova ativação (token antigo ainda gravado) → 401 unauthorized", async () => {
      const client = await seedClient(t.db, { slug: "reativacao", config: remapIds(EXAMPLE_CONFIG, new Map()) })
      await t.client.query("UPDATE gateway SET status = 'pending_enrollment' WHERE id = $1", [client.gatewayId])
      expect(await errorOf(await sync(HEALTH_ONLY, { token: client.token }))).toMatchObject({ status: 401, code: "unauthorized" })
      expect(await errorOf(await config(client.token))).toMatchObject({ status: 401, code: "unauthorized" })
    })

    it("revogado entre a autenticação e a transação: /sync e /config recusam com token_revoked, sem gravar", async () => {
      const client = await seedClient(t.db, { slug: "corrida", config: remapIds(EXAMPLE_CONFIG, new Map()) })
      // O principal já autenticado (como se a revogação chegasse logo depois da busca do token).
      const principal = await authenticateGateway(t.db, `Bearer ${client.token}`)
      await t.client.query("UPDATE gateway SET status = 'revoked', revoked_at = now() WHERE id = $1", [client.gatewayId])
      await expect(processSync(t.db, principal, HEALTH_ONLY, { now: FIXTURE_NOW })).rejects.toMatchObject({ code: "token_revoked" })
      await expect(loadGatewayConfig(t.db, principal, null)).rejects.toMatchObject({ code: "token_revoked" })
      expect(await dataFootprint(t, client.organizationId)).toMatchObject({ gateway_device_status: 0, audit_log: 0 })

      await t.client.query("UPDATE gateway SET status = 'pending_enrollment', revoked_at = NULL WHERE id = $1", [client.gatewayId])
      await expect(processSync(t.db, principal, HEALTH_ONLY, { now: FIXTURE_NOW })).rejects.toMatchObject({ code: "unauthorized" })
      await expect(loadGatewayConfig(t.db, principal, null)).rejects.toMatchObject({ code: "unauthorized" })
    })

    /**
     * /sync com o corpo "preso": a autenticação passa e a leitura do corpo espera `release()`
     * (como um agente — ou alguém com um token roubado — mandando o corpo devagar).
     */
    function heldSync(token: string, body: unknown): { reading: Promise<void>; release: () => void; response: Promise<Response> } {
      let release!: () => void
      let markReading!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const reading = new Promise<void>((resolve) => (markReading = resolve))
      const bytes = new Uint8Array(gzipSync(JSON.stringify(body)))
      // highWaterMark 0: o stream só é puxado quando o handler começa a ler o corpo (depois da autenticação).
      const stream = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            markReading()
            await gate
            controller.enqueue(bytes)
            controller.close()
          },
        },
        { highWaterMark: 0 },
      )
      const request = new Request(`http://localhost${API_ROUTES.sync}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Encoding": "gzip" },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" })
      return { reading, release, response: handleSync(request, deps(t, FIXTURE_NOW)) }
    }

    /** Comando `tag.read` em aberto para o gateway (no prazo, pelo relógio das fixtures). */
    async function pendingCommand(client: SeededClient): Promise<string> {
      const [row] = await rows<{ id: string }>(
        t,
        `INSERT INTO gateway_command (organization_id, gateway_id, type, payload, status, created_at, expires_at)
         VALUES ($1, $2, 'tag.read', $3, 'pending', $4, $5) RETURNING id`,
        [
          client.organizationId,
          client.gatewayId,
          JSON.stringify({
            device_id: client.config.devices[0]!.id,
            address: { area: "holding_register", offset: 1004 },
            type: "uint32",
            word_order: "CDAB",
          }),
          new Date(FIXTURE_NOW.getTime() - 1000),
          new Date(FIXTURE_NOW.getTime() + 600_000),
        ],
      )
      return row!.id
    }

    /** O que um /sync aceito deixaria no banco: saúde do gateway, status de dispositivo e comando entregue. */
    async function syncTrace(client: SeededClient, commandId: string): Promise<unknown> {
      const [gw] = await rows<{ health: unknown; agent_version: string | null }>(
        t,
        "SELECT health, agent_version FROM gateway WHERE id = $1",
        [client.gatewayId],
      )
      const [cmd] = await rows<{ status: string }>(t, "SELECT status FROM gateway_command WHERE id = $1", [commandId])
      const devices = await rows(t, "SELECT 1 FROM gateway_device_status WHERE gateway_id = $1", [client.gatewayId])
      return { health: gw?.health ?? null, agentVersion: gw?.agent_version ?? null, command: cmd?.status, devices: devices.length }
    }

    it("reativação troca o token enquanto o corpo chega: 401 unauthorized, sem gravar e sem levar os comandos", async () => {
      const ids = new Map<string, string>()
      const client = await seedClient(t.db, { slug: "reativado-no-meio", config: remapIds(EXAMPLE_CONFIG, ids) })
      const body = remapIds(HEALTH_ONLY, ids)
      const commandId = await pendingCommand(client)

      const held = heldSync(client.token, body)
      await held.reading // autenticado com o token antigo; o corpo ainda não chegou
      // Troca de hardware (docs/08): código novo para o mesmo gateway ativo → token novo.
      const code = randomActivationCode()
      await t.client.query(
        "INSERT INTO gateway_enrollment (organization_id, gateway_id, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')",
        [client.organizationId, client.gatewayId, hashActivationCode(code)],
      )
      const enrolled = await handleEnroll(enrollRequest({ ...fixture<EnrollRequest>("enroll-request.valid"), code }), deps(t))
      expect(enrolled.status).toBe(201)
      const fresh = EnrollResponseSchema.parse(await enrolled.json())
      held.release()

      expect(await errorOf(await held.response)).toMatchObject({ status: 401, code: "unauthorized" })
      // Nada do /sync recusado: a saúde é a da ativação, o comando continua para o hardware novo.
      expect(await syncTrace(client, commandId)).toEqual({ health: null, agentVersion: "1.0.0", command: "pending", devices: 0 })

      const ok = await sync(body, { token: fresh.token })
      expect(ok.status).toBe(200)
      expect(SyncResponseSchema.parse(await ok.json()).commands.map((c) => c.id)).toEqual([commandId])
    })

    it("janela da rotação acaba enquanto o corpo chega: o token anterior → 401 unauthorized, sem gravar", async () => {
      const ids = new Map<string, string>()
      const { client, newToken } = await rotatingClient("rotacao-no-meio", ids)
      const body = remapIds(HEALTH_ONLY, ids)
      const commandId = await pendingCommand(client)

      const held = heldSync(client.token, body)
      await held.reading // autenticado com o token anterior, ainda dentro da janela
      await t.client.query("UPDATE gateway SET previous_token_expires_at = now() - interval '1 second' WHERE id = $1", [client.gatewayId])
      held.release()

      expect(await errorOf(await held.response)).toMatchObject({ status: 401, code: "unauthorized" })
      expect(await syncTrace(client, commandId)).toEqual({ health: null, agentVersion: null, command: "pending", devices: 0 })
      expect((await sync(body, { token: newToken })).status).toBe(200)
    })

    it("estado do token dentro da transação = app.resolve_gateway_token_state, em cada estado", async () => {
      const { client, newToken } = await rotatingClient("estados-do-token")
      const hashes = {
        atual: hashGatewayToken(newToken),
        anterior: hashGatewayToken(client.token),
        desconhecido: hashGatewayToken(`gw_live_${randomBytes(32).toString("base64url")}`),
      }
      const setups: Record<string, string> = {
        "rotação em andamento": "UPDATE gateway SET previous_token_expires_at = now() + interval '10 minutes' WHERE id = $1",
        "rotação encerrada": "UPDATE gateway SET previous_token_expires_at = now() - interval '1 second' WHERE id = $1",
        "aguardando ativação": "UPDATE gateway SET status = 'pending_enrollment', previous_token_expires_at = now() + interval '10 minutes' WHERE id = $1",
        revogado: "UPDATE gateway SET status = 'revoked', revoked_at = now() WHERE id = $1",
        excluído: "UPDATE gateway SET status = 'active', revoked_at = NULL, deleted_at = now() WHERE id = $1",
      }
      const seen: Record<string, Record<string, unknown>> = {}
      for (const [name, update] of Object.entries(setups)) {
        await t.client.query(update, [client.gatewayId])
        for (const [token, hash] of Object.entries(hashes)) {
          const lookup = (await resolveGatewayTokenState(rowsExecutor(t.db), hash))?.state ?? null
          const [inTx] = await withTenant(t.db, client.organizationId, (tx) =>
            tx.select({ state: tokenStateInTx(hash) }).from(gateway).where(eq(gateway.id, client.gatewayId)),
          )
          expect(inTx?.state ?? null, `${name}, token ${token}`).toBe(lookup)
          seen[name] = { ...seen[name], [token]: lookup }
        }
      }
      // E os estados cobertos são os esperados (o teste não passa "de graça" com tudo nulo).
      expect(seen).toEqual({
        "rotação em andamento": { atual: "active", anterior: "previous", desconhecido: null },
        "rotação encerrada": { atual: "active", anterior: "rotated", desconhecido: null },
        "aguardando ativação": { atual: "pending_enrollment", anterior: "pending_enrollment", desconhecido: null },
        revogado: { atual: "revoked", anterior: "revoked", desconhecido: null },
        excluído: { atual: "revoked", anterior: "revoked", desconhecido: null },
      })
    })

    it("principal de um token que deixou de valer depois da autenticação: /sync e /config → 401 unauthorized", async () => {
      const { client, newToken } = await rotatingClient("principal-velho")
      // Token anterior dentro da janela: autentica e a config sai.
      const previous = await authenticateGateway(t.db, `Bearer ${client.token}`)
      expect((await loadGatewayConfig(t.db, previous, null)).kind).toBe("config")
      await t.client.query("UPDATE gateway SET previous_token_expires_at = now() - interval '1 second' WHERE id = $1", [client.gatewayId])
      await expect(loadGatewayConfig(t.db, previous, null)).rejects.toMatchObject({ code: "unauthorized" })
      await expect(processSync(t.db, previous, HEALTH_ONLY, { now: FIXTURE_NOW })).rejects.toMatchObject({ code: "unauthorized" })

      // Token atual substituído (reativação): o principal antigo não serve mais.
      const current = await authenticateGateway(t.db, `Bearer ${newToken}`)
      await t.client.query(
        "UPDATE gateway SET token_hash = $2, previous_token_hash = NULL, previous_token_expires_at = NULL WHERE id = $1",
        [client.gatewayId, hashGatewayToken(`gw_live_${randomBytes(32).toString("base64url")}`)],
      )
      await expect(loadGatewayConfig(t.db, current, null)).rejects.toMatchObject({ code: "unauthorized" })
      await expect(processSync(t.db, current, HEALTH_ONLY, { now: FIXTURE_NOW })).rejects.toMatchObject({ code: "unauthorized" })
      expect(await dataFootprint(t, client.organizationId)).toMatchObject({ gateway_device_status: 0, audit_log: 0 })
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
