/**
 * Fila de comandos (lib/server/gateway/commands.ts): a web enfileira, o /sync entrega, o agente
 * responde no /sync seguinte e a web lê o resultado — o caminho que o gateway simulado percorre.
 */
import { type CommandResult, type SyncRequest, type SyncResponse, SyncResponseSchema } from "@engemase/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { GatewayAdminError } from "@/lib/server/gateway/admin-errors"
import {
  cancelGatewayCommand,
  enqueueGatewayCommand,
  getGatewayCommand,
  MAX_OPEN_COMMANDS_PER_GATEWAY,
} from "@/lib/server/gateway/commands"
import { handleSync } from "@/lib/server/gateway/handlers"
import {
  count,
  createTestDatabase,
  deps,
  EXAMPLE_CONFIG,
  fixture,
  remapIds,
  rows,
  type SeededClient,
  seedClient,
  seedEnrollment,
  syncRequest,
  type TestDatabase,
} from "./support"

const HEALTH_ONLY = fixture<SyncRequest>("sync-request.valid.health-only")

async function adminError(promise: Promise<unknown>): Promise<GatewayAdminError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(GatewayAdminError)
  return error as GatewayAdminError
}

describe("fila de comandos", () => {
  let t: TestDatabase
  let seq = 0
  const now = new Date()

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  async function freshClient(): Promise<{ client: SeededClient; remap: <T>(v: T) => T }> {
    const map = new Map<string, string>()
    const remap = <T>(v: T): T => remapIds(v, map)
    return { client: await seedClient(t.db, { slug: `cmd-${++seq}`, config: remap(EXAMPLE_CONFIG) }), remap }
  }

  function tcpDevice(client: SeededClient): string {
    return client.config.devices.find((d) => d.protocol === "modbus-tcp")!.id
  }

  async function sync(client: SeededClient, body: unknown, at: Date = now): Promise<SyncResponse> {
    const res = await handleSync(syncRequest(body, { token: client.token }), deps(t, at))
    const json: unknown = await res.json()
    expect(res.status, JSON.stringify(json)).toBe(200)
    return SyncResponseSchema.parse(json)
  }

  it("enfileirar → /sync entrega (modo interativo) → resultado no /sync seguinte → web lê", async () => {
    const { client, remap } = await freshClient()
    const deviceId = tcpDevice(client)
    const payload = { device_id: deviceId, address: { area: "holding_register", offset: 1004 }, type: "uint32", word_order: "CDAB" }
    const queued = await enqueueGatewayCommand(t.db, {
      organizationId: client.organizationId,
      gatewayId: client.gatewayId,
      type: "tag.read",
      payload,
      actor: { type: "user", id: client.userId },
      now,
    })
    expect(queued.status).toBe("pending")
    expect(queued.expiresAt.getTime() - now.getTime()).toBe(120_000)

    const health = remap(HEALTH_ONLY)
    const first = await sync(client, health)
    expect(first.commands.map((c) => c.id)).toEqual([queued.id])
    expect(first.commands[0]).toMatchObject({ type: "tag.read", payload })
    expect(first.next_sync_s).toBe(1)
    expect((await getGatewayCommand(t.db, client.organizationId, queued.id))?.status).toBe("sent")

    const result: CommandResult = { id: queued.id, type: "tag.read", status: "ok", result: { value: 1048213, quality: "good", read_ms: 21 } }
    const second = await sync(client, { ...health, command_results: [result] }, new Date(now.getTime() + 1000))
    expect(second.commands).toEqual([])
    const done = await getGatewayCommand(t.db, client.organizationId, queued.id)
    expect(done).toMatchObject({ status: "ok", errorCode: null, result: expect.objectContaining({ result: result.result }) })
    expect(done?.completedAt).not.toBeNull()

    // Outro cliente não enxerga o comando.
    const other = await freshClient()
    expect(await getGatewayCommand(t.db, other.client.organizationId, queued.id)).toBeNull()
    expect(
      await count(t, "SELECT 1 FROM audit_log WHERE action = 'gateway.command_created' AND entity_id = $1", [client.gatewayId]),
    ).toBe(1)
  })

  it("resultado de erro do agente (ex.: comando não implementado) fica registrado", async () => {
    const { client, remap } = await freshClient()
    const queued = await enqueueGatewayCommand(t.db, {
      organizationId: client.organizationId,
      gatewayId: client.gatewayId,
      type: "config.reload",
      payload: {},
      now,
    })
    expect(queued.expiresAt.getTime() - now.getTime()).toBe(600_000)
    await sync(client, remap(HEALTH_ONLY))
    const rejected: CommandResult = {
      id: queued.id,
      type: "config.reload",
      status: "rejected",
      error: { code: "unsupported", message: "Comando ainda não implementado nesta versão do agente." },
    }
    await sync(client, { ...remap(HEALTH_ONLY), command_results: [rejected] })
    expect(await getGatewayCommand(t.db, client.organizationId, queued.id)).toMatchObject({ status: "rejected", errorCode: "unsupported" })
  })

  it("payload fora do contrato, tipo desconhecido ou validade acima de 24 h → invalid_command", async () => {
    const { client } = await freshClient()
    const base = { organizationId: client.organizationId, gatewayId: client.gatewayId, now }
    const bad = await adminError(
      enqueueGatewayCommand(t.db, { ...base, type: "tag.read", payload: { device_id: tcpDevice(client), address: { area: "coil", offset: 0 }, type: "uint32" } }),
    )
    expect(bad.code).toBe("invalid_command")
    expect(bad.issues.length).toBeGreaterThan(0)
    expect(
      (await adminError(enqueueGatewayCommand(t.db, { ...base, type: "agent.update" as never, payload: {} }))).code,
    ).toBe("invalid_command")
    expect(
      (await adminError(enqueueGatewayCommand(t.db, { ...base, type: "config.reload", payload: {}, ttlS: 25 * 3600 }))).code,
    ).toBe("invalid_command")
    expect(await count(t, "SELECT 1 FROM gateway_command WHERE gateway_id = $1", [client.gatewayId])).toBe(0)
  })

  it("dispositivo ou barramento de outro gateway → unknown_reference", async () => {
    const a = await freshClient()
    const b = await freshClient()
    const error = await adminError(
      enqueueGatewayCommand(t.db, {
        organizationId: a.client.organizationId,
        gatewayId: a.client.gatewayId,
        type: "tag.read",
        payload: { device_id: tcpDevice(b.client), address: { area: "holding_register", offset: 1 }, type: "uint16" },
        now,
      }),
    )
    expect(error.code).toBe("unknown_reference")
    const scan = await adminError(
      enqueueGatewayCommand(t.db, {
        organizationId: a.client.organizationId,
        gatewayId: a.client.gatewayId,
        type: "modbus.scan",
        payload: { mode: "unit_ids", bus_id: b.client.config.serial_buses[0]!.id, unit_from: 1, unit_to: 10 },
        now,
      }),
    )
    expect(scan.code).toBe("unknown_reference")
    // O barramento do próprio gateway passa.
    const ok = await enqueueGatewayCommand(t.db, {
      organizationId: a.client.organizationId,
      gatewayId: a.client.gatewayId,
      type: "modbus.scan",
      payload: { mode: "unit_ids", bus_id: a.client.config.serial_buses[0]!.id, unit_from: 1, unit_to: 10 },
      now,
    })
    expect(ok.status).toBe("pending")
  })

  it("gateway ainda não ativado, revogado ou de outro cliente não recebe comando", async () => {
    const { client } = await freshClient()
    const pending = await seedEnrollment(t.db, client)
    const enqueue = (gatewayId: string, organizationId = client.organizationId) =>
      enqueueGatewayCommand(t.db, { organizationId, gatewayId, type: "config.reload", payload: {}, now })
    expect((await adminError(enqueue(pending.gatewayId))).code).toBe("gateway_not_active")
    const other = await freshClient()
    expect((await adminError(enqueue(other.client.gatewayId))).code).toBe("gateway_not_found")
    await t.client.query("UPDATE gateway SET status = 'revoked', revoked_at = now() WHERE id = $1", [client.gatewayId])
    expect((await adminError(enqueue(client.gatewayId))).code).toBe("gateway_revoked")
  })

  it("cancelar: comando em aberto vira cancelled e o resultado que chegar depois é ignorado", async () => {
    const { client, remap } = await freshClient()
    const queued = await enqueueGatewayCommand(t.db, {
      organizationId: client.organizationId,
      gatewayId: client.gatewayId,
      type: "agent.restart",
      payload: { reason: "teste" },
      now,
    })
    await sync(client, remap(HEALTH_ONLY)) // entregue (sent)
    const cancelled = await cancelGatewayCommand(t.db, { organizationId: client.organizationId, commandId: queued.id, now })
    expect(cancelled.status).toBe("cancelled")
    const late: CommandResult = { id: queued.id, type: "agent.restart", status: "ok", result: { restart_at: now.toISOString() } }
    const res = await sync(client, { ...remap(HEALTH_ONLY), command_results: [late] })
    expect(res.commands).toEqual([])
    expect((await getGatewayCommand(t.db, client.organizationId, queued.id))?.status).toBe("cancelled")
    expect((await adminError(cancelGatewayCommand(t.db, { organizationId: client.organizationId, commandId: queued.id }))).code).toBe(
      "command_finished",
    )
    const audit = await rows<{ action: string }>(t, "SELECT action FROM audit_log WHERE entity_id = $1 AND action LIKE 'gateway.command_%' ORDER BY at, action", [
      client.gatewayId,
    ])
    expect(audit.map((a) => a.action).sort()).toEqual(["gateway.command_cancelled", "gateway.command_created"])
  })

  it("segredos do payload (vpn.enable: auth_key) não vão para a auditoria", async () => {
    const { client } = await freshClient()
    const sessionId = remapIds("01a1cab3-7cf8-7f23-8fdf-c01d84c79403", new Map())
    await enqueueGatewayCommand(t.db, {
      organizationId: client.organizationId,
      gatewayId: client.gatewayId,
      type: "vpn.status",
      payload: { session_id: sessionId },
      now,
    })
    const vpnEnable = fixture<{ commands: { type: string; payload: Record<string, unknown> }[] }>("sync-response.valid.all-command-types").commands.find(
      (c) => c.type === "vpn.enable",
    )!
    await enqueueGatewayCommand(t.db, {
      organizationId: client.organizationId,
      gatewayId: client.gatewayId,
      type: "vpn.enable",
      payload: vpnEnable.payload,
      now,
    })
    const audit = JSON.stringify(await rows(t, "SELECT after FROM audit_log WHERE entity_id = $1", [client.gatewayId]))
    expect(audit).not.toContain(String(vpnEnable.payload.auth_key))
    expect(audit).toContain("[omitido]")
  })

  it(`no máximo ${MAX_OPEN_COMMANDS_PER_GATEWAY} comandos em aberto por gateway`, async () => {
    const { client } = await freshClient()
    await t.client.query(
      `INSERT INTO gateway_command (organization_id, gateway_id, type, payload, expires_at)
       SELECT $1, $2, 'config.reload', '{}', now() + interval '10 min' FROM generate_series(1, $3::int)`,
      [client.organizationId, client.gatewayId, MAX_OPEN_COMMANDS_PER_GATEWAY],
    )
    const error = await adminError(
      enqueueGatewayCommand(t.db, { organizationId: client.organizationId, gatewayId: client.gatewayId, type: "config.reload", payload: {}, now }),
    )
    expect(error.code).toBe("too_many_open_commands")
  })
})
