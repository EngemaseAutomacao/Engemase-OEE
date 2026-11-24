/**
 * Publicador de config (lib/server/gateway/publish.ts) e gerador de códigos de ativação
 * (lib/server/gateway/activation.ts): o que a web grava é o que o agente recebe no /config e usa no
 * /enroll.
 */
import {
  EnrollResponseSchema,
  ErrorResponseSchema,
  type GatewayConfig,
  GatewayConfigSchema,
  SyncResponseSchema,
} from "@engemase/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ACTIVATION_CODE_ALPHABET, createActivationCode, generateActivationCode } from "@/lib/server/gateway/activation"
import { GatewayAdminError } from "@/lib/server/gateway/admin-errors"
import { handleConfig, handleEnroll, handleSync } from "@/lib/server/gateway/handlers"
import { configContent, publishGatewayConfig } from "@/lib/server/gateway/publish"
import {
  configRequest,
  count,
  createTestDatabase,
  deps,
  EXAMPLE_CONFIG,
  enrollRequest,
  fixture,
  remapIds,
  rows,
  type SeededClient,
  seedClient,
  seedEnrollment,
  syncRequest,
  type TestDatabase,
} from "./support"

const ENROLL = fixture<Record<string, unknown>>("enroll-request.valid")

async function adminError(promise: Promise<unknown>): Promise<GatewayAdminError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(GatewayAdminError)
  return error as GatewayAdminError
}

describe("publicador de config", () => {
  let t: TestDatabase
  let seq = 0

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  async function freshClient(): Promise<SeededClient> {
    return seedClient(t.db, { slug: `pub-${++seq}`, config: remapIds(EXAMPLE_CONFIG, new Map()) })
  }

  async function getConfig(client: SeededClient): Promise<GatewayConfig> {
    const res = await handleConfig(configRequest({ token: client.token }), deps(t))
    expect(res.status).toBe(200)
    return GatewayConfigSchema.parse(await res.json()) as GatewayConfig
  }

  it("o cadastro semeado a partir da config de exemplo gera a mesma config (nada a publicar)", async () => {
    const client = await freshClient()
    const result = await publishGatewayConfig(t.db, { organizationId: client.organizationId, gatewayId: client.gatewayId })
    expect(result).toEqual({ kind: "unchanged", version: 42 })
  })

  it("cadastro alterado → versão nova, servida pelo /config e anunciada pelo /sync, com auditoria", async () => {
    const client = await freshClient()
    await t.client.query(`UPDATE gateway SET uplink = '{"sync_interval_s": 5, "max_batch_items": 1000}' WHERE id = $1`, [client.gatewayId])
    const machineId = client.machineIds[0]!
    await t.client.query("UPDATE machine SET name = 'Injetora renomeada' WHERE id = $1", [machineId])
    const now = new Date("2026-11-20T10:00:00Z")

    const result = await publishGatewayConfig(t.db, {
      organizationId: client.organizationId,
      gatewayId: client.gatewayId,
      actor: { type: "engemase", id: client.userId, label: "Técnico de testes" },
      now,
    })
    expect(result.kind).toBe("published")
    if (result.kind !== "published") return
    expect(result.version).toBe(43)
    expect(result.config.generated_at).toBe(now.toISOString())
    expect(result.config.uplink).toEqual({ sync_interval_s: 5, max_batch_items: 1000 })

    const served = await getConfig(client)
    expect(served.config_version).toBe(43)
    expect(served.machines.find((m) => m.id === machineId)?.name).toBe("Injetora renomeada")
    // Só o que mudou: o resto é igual à config de exemplo.
    expect(configContent({ ...served, uplink: client.config.uplink, machines: client.config.machines })).toBe(
      configContent(client.config),
    )

    const sync = await handleSync(syncRequest(fixture("sync-request.valid.health-only"), { token: client.token }), deps(t))
    const body = SyncResponseSchema.parse(await sync.json())
    expect(body.config.latest_version).toBe(43)
    expect(body.next_sync_s).toBe(5)

    const audit = await rows<{ actor_type: string; after: { version: number; machines: number } }>(
      t,
      "SELECT actor_type, after FROM audit_log WHERE action = 'gateway.config_published' AND entity_id = $1",
      [client.gatewayId],
    )
    expect(audit).toEqual([{ actor_type: "engemase", after: expect.objectContaining({ version: 43, machines: 3 }) }])

    // Publicar de novo sem mudança: nada; com force: 44.
    expect(await publishGatewayConfig(t.db, { organizationId: client.organizationId, gatewayId: client.gatewayId })).toEqual({
      kind: "unchanged",
      version: 43,
    })
    const forced = await publishGatewayConfig(t.db, { organizationId: client.organizationId, gatewayId: client.gatewayId, force: true })
    expect(forced).toMatchObject({ kind: "published", version: 44 })
  })

  it("máquina desativada ou excluída sai da config junto com as tags dela", async () => {
    const client = await freshClient()
    const machineId = client.machineIds[1]!
    await t.client.query("UPDATE machine SET active = false WHERE id = $1", [machineId])
    const result = await publishGatewayConfig(t.db, { organizationId: client.organizationId, gatewayId: client.gatewayId })
    expect(result.kind).toBe("published")
    const served = await getConfig(client)
    expect(served.machines.map((m) => m.id)).not.toContain(machineId)
    expect(served.devices.flatMap((d) => d.tags).some((tg) => tg.machine_id === machineId)).toBe(false)
  })

  it("cadastro que não forma config válida → invalid_config com os problemas, e nada é gravado", async () => {
    const client = await freshClient()
    // A máquina em modo state_code perde a tag de estado (papel obrigatório).
    await t.client.query("UPDATE tag SET deleted_at = now() WHERE gateway_id = $1 AND role = 'state.code'", [client.gatewayId])
    const before = await count(t, "SELECT 1 FROM gateway_config_version WHERE gateway_id = $1", [client.gatewayId])
    const error = await adminError(publishGatewayConfig(t.db, { organizationId: client.organizationId, gatewayId: client.gatewayId }))
    expect(error.code).toBe("invalid_config")
    expect(error.issues.length).toBeGreaterThan(0)
    expect(error.issues.some((i) => i.rule === "machine.mode_roles")).toBe(true)
    expect(await count(t, "SELECT 1 FROM gateway_config_version WHERE gateway_id = $1", [client.gatewayId])).toBe(before)
    expect((await getConfig(client)).config_version).toBe(42)
  })

  it("gateway de outro cliente não é encontrado; revogado não publica", async () => {
    const a = await freshClient()
    const b = await freshClient()
    expect((await adminError(publishGatewayConfig(t.db, { organizationId: a.organizationId, gatewayId: b.gatewayId }))).code).toBe(
      "gateway_not_found",
    )
    await t.client.query("UPDATE gateway SET status = 'revoked', revoked_at = now() WHERE id = $1", [b.gatewayId])
    expect((await adminError(publishGatewayConfig(t.db, { organizationId: b.organizationId, gatewayId: b.gatewayId }))).code).toBe(
      "gateway_revoked",
    )
  })
})

describe("códigos de ativação", () => {
  let t: TestDatabase
  let acme: SeededClient

  beforeAll(async () => {
    t = await createTestDatabase()
    acme = await seedClient(t.db, { slug: "acme" })
  })

  afterAll(async () => {
    await t.client.close()
  })

  async function enroll(code: string): Promise<Response> {
    return handleEnroll(enrollRequest({ ...ENROLL, code }), deps(t))
  }

  it("formato ABCD-1234, só com o alfabeto sem caracteres ambíguos", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateActivationCode()
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
      for (const ch of code.replace("-", "")) expect(ACTIVATION_CODE_ALPHABET).toContain(ch)
    }
  })

  it("o código gerado ativa o gateway pelo /enroll; só o hash vai para o banco e nada dele na auditoria", async () => {
    const pending = await seedEnrollment(t.db, acme)
    const now = new Date()
    const created = await createActivationCode(t.db, {
      organizationId: acme.organizationId,
      gatewayId: pending.gatewayId,
      actor: { type: "user", id: acme.userId },
      now,
    })
    expect(created.expiresAt.getTime() - now.getTime()).toBe(24 * 3_600_000)
    const stored = await rows<{ code_hash: string }>(t, "SELECT code_hash FROM gateway_enrollment WHERE id = $1", [created.enrollmentId])
    expect(stored[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/)
    const audit = await rows<{ after: unknown }>(t, "SELECT after FROM audit_log WHERE action = 'gateway.activation_code_created' AND entity_id = $1", [
      pending.gatewayId,
    ])
    expect(audit).toHaveLength(1)
    expect(JSON.stringify(audit)).not.toContain(created.code)
    expect(JSON.stringify(audit)).not.toContain(created.code.replace("-", ""))

    // O código anterior (do seed) deixou de valer: só o último vale.
    const old = await enroll(pending.code)
    expect(old.status).toBe(400)
    expect(ErrorResponseSchema.parse(await old.json()).error.code).toBe("activation_code_invalid")

    // Digitado sem hífen e em minúsculas também vale.
    const res = await enroll(created.code.replace("-", "").toLowerCase().toUpperCase())
    expect(res.status).toBe(201)
    expect(EnrollResponseSchema.parse(await res.json()).gateway_id).toBe(pending.gatewayId)
  })

  it("gateway revogado não recebe código; gateway de outro cliente não é encontrado", async () => {
    const revoked = await seedEnrollment(t.db, acme, { gatewayStatus: "revoked" })
    expect(
      (await adminError(createActivationCode(t.db, { organizationId: acme.organizationId, gatewayId: revoked.gatewayId }))).code,
    ).toBe("gateway_revoked")
    const other = await seedClient(t.db, { slug: "outro", config: remapIds(EXAMPLE_CONFIG, new Map()) })
    expect(
      (await adminError(createActivationCode(t.db, { organizationId: acme.organizationId, gatewayId: other.gatewayId }))).code,
    ).toBe("gateway_not_found")
  })

  it("gateway já ativo (troca de hardware): o código novo reativa com token novo e o antigo para de valer", async () => {
    const client = await seedClient(t.db, { slug: "troca", config: remapIds(EXAMPLE_CONFIG, new Map()) })
    const { code } = await createActivationCode(t.db, { organizationId: client.organizationId, gatewayId: client.gatewayId })
    const res = await enroll(code)
    expect(res.status).toBe(201)
    const oldToken = await handleSync(syncRequest(fixture("sync-request.valid.health-only"), { token: client.token }), deps(t))
    expect(oldToken.status).toBe(401)
  })
})
