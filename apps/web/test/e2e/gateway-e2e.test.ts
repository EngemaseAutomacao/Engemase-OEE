/**
 * Ponta a ponta: tools/plc-sim (CLP Modbus TCP simulado) → agente Go (gateway/, `enroll` + `run`)
 * → API dos gateways (os mesmos handlers dos route.ts, servidos por node:http) → banco (PGlite com
 * as migrações e a RLS de @engemase/db).
 *
 * Fica fora da suíte normal (precisa do Go 1.24 e leva ~1–2 min, porque espera um minuto fechado):
 *
 *   pnpm --filter web test:e2e        # = E2E_GATEWAY=1 vitest run test/e2e
 *
 * Não cobre o roteamento do Next.js nem o driver `pg` (os route.ts só repassam a requisição); para
 * isso, rodar `next start` com DATABASE_URL apontando para um Postgres de verdade.
 */
import { type ChildProcess, execFile, execFileSync, spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Readable } from "node:stream"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { API_ROUTES, type GatewayConfig, GatewayConfigSchema } from "@engemase/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { hashActivationCode } from "@/lib/server/gateway/enroll"
import { type GatewayApiDeps, handleConfig, handleEnroll, handleSync } from "@/lib/server/gateway/handlers"
import { count, createTestDatabase, randomActivationCode, rows, type SeededClient, seedClient, type TestDatabase, uuidv7 } from "../gateway/support"

const RUN = process.env.E2E_GATEWAY === "1"
const REPO = resolve(fileURLToPath(new URL("../../../../", import.meta.url)))
const MACHINES = 2

/** Config com o bloco OEE padrão (HR 1000, 14 registradores) para cada máquina do plc-sim (unit 1..N). */
function simConfig(gatewayId: string, plcPort: number): GatewayConfig {
  const machines: GatewayConfig["machines"] = []
  const devices: GatewayConfig["devices"] = []
  for (let unit = 1; unit <= MACHINES; unit++) {
    const machineId = uuidv7()
    machines.push({
      id: machineId,
      name: `Simulada ${unit}`,
      state_rules: {
        mode: "state_code",
        map: { "0": "STOPPED", "1": "RUNNING", "2": "FAULT", "3": "SETUP", "4": "STOPPED", "5": "FAULT" },
        debounce_s: 0.5,
      },
    })
    const tag = (offset: number, role: GatewayConfig["devices"][number]["tags"][number]["role"], wide = false) => ({
      id: uuidv7(),
      address: { area: "holding_register" as const, offset },
      type: wide ? ("uint32" as const) : ("uint16" as const),
      ...(wide ? { word_order: "CDAB" as const } : {}),
      role,
      machine_id: machineId,
    })
    devices.push({
      id: uuidv7(),
      name: `plc-sim unit ${unit}`,
      protocol: "modbus-tcp",
      params: { host: "127.0.0.1", port: plcPort, unit_id: unit, timeout_ms: 500 },
      blocks: [{ area: "holding_register", start: 1000, count: 14, poll_ms: 500 }],
      tags: [
        tag(1001, "plc.heartbeat"),
        tag(1002, "state.code"),
        tag(1003, "fault.code"),
        tag(1004, "count.total", true),
        tag(1006, "count.reject", true),
        tag(1010, "product.code"),
      ],
    })
  }
  return GatewayConfigSchema.parse({
    config_version: 1,
    gateway_id: gatewayId,
    serial_buses: [],
    devices,
    machines,
    uplink: { sync_interval_s: 1, max_batch_items: 2000 },
  }) as GatewayConfig
}

/** Adaptador node:http → handlers (Fetch API), como o Next.js faz com os route.ts. */
function serve(apiDeps: GatewayApiDeps, log: string[]): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value)
      }
      const withBody = req.method === "POST"
      const request = new Request(url, {
        method: req.method ?? "GET",
        headers,
        ...(withBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" } : {}),
      } as RequestInit)
      let response: Response
      if (req.method === "POST" && url.pathname === API_ROUTES.enroll) response = await handleEnroll(request, apiDeps)
      else if (req.method === "POST" && url.pathname === API_ROUTES.sync) response = await handleSync(request, apiDeps)
      else if (req.method === "GET" && url.pathname === API_ROUTES.config) response = await handleConfig(request, apiDeps)
      else response = new Response("{}", { status: 404 })
      log.push(`${req.method} ${url.pathname} → ${response.status}`)
      res.statusCode = response.status
      response.headers.forEach((value, name) => res.setHeader(name, value))
      res.end(Buffer.from(await response.arrayBuffer()))
    })().catch((error: unknown) => {
      log.push(`erro no adaptador: ${String(error)}`)
      res.statusCode = 500
      res.end()
    })
  })
}

describe.skipIf(!RUN)("ponta a ponta: plc-sim → agente Go → API → banco", () => {
  let t: TestDatabase
  let client: SeededClient
  let server: Server
  let dir: string
  let sim: ChildProcess | undefined
  let agent: ChildProcess | undefined
  const httpLog: string[] = []
  const agentLog: string[] = []
  let activationCode: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "oee-e2e-"))
    const env = { ...process.env, GOTOOLCHAIN: "local" }
    execFileSync("go", ["build", "-o", join(dir, "oee-gateway"), "./cmd/oee-gateway"], { cwd: join(REPO, "gateway"), env })
    execFileSync("go", ["build", "-o", join(dir, "plc-sim"), "."], { cwd: join(REPO, "tools", "plc-sim"), env })

    // Porta livre para o simulador: abre e fecha um servidor qualquer.
    const probe = createServer().listen(0, "127.0.0.1")
    await new Promise((r) => probe.once("listening", r))
    const plcPort = (probe.address() as AddressInfo).port
    await new Promise((r) => probe.close(r))
    sim = spawn(join(dir, "plc-sim"), ["--machines", String(MACHINES), "--port", String(plcPort), "--cycle", "2s", "--speed", "5", "--seed", "7", "--status-every", "0"], {
      stdio: "ignore",
    })

    t = await createTestDatabase()
    const gatewayId = uuidv7()
    client = await seedClient(t.db, { slug: "e2e", config: simConfig(gatewayId, plcPort) })
    // O gateway foi semeado ativo; um código novo simula a (re)ativação feita pelo técnico.
    activationCode = randomActivationCode()
    await t.client.query(
      "INSERT INTO gateway_enrollment (organization_id, gateway_id, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')",
      [client.organizationId, client.gatewayId, hashActivationCode(activationCode)],
    )

    server = serve({ db: t.db, logError: (message, error) => httpLog.push(`${message}: ${String(error)}`) }, httpLog)
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const yaml = [
      "schema: 1",
      "cloud:",
      `  url: ${apiUrl}`,
      "  timeout_s: 10",
      "paths:",
      `  state_dir: ${dir}`,
      `  identity: ${join(dir, "hw.json")}`,
      "hardware:",
      "  profile: generic",
      "log:",
      "  level: debug",
    ].join("\n")
    writeFileSync(join(dir, "gateway.yaml"), `${yaml}\n`)

    const bin = join(dir, "oee-gateway")
    const cfg = ["--config", join(dir, "gateway.yaml")]
    // Assíncrono: a API roda neste mesmo processo (execFileSync travaria o event loop).
    await promisify(execFile)(bin, [...cfg, "enroll", "--code", activationCode, "--hostname", "e2e-gw"])
    agent = spawn(bin, [...cfg, "run"], { stdio: ["ignore", "pipe", "pipe"] })
    agent.stdout?.on("data", (d: Buffer) => agentLog.push(d.toString()))
    agent.stderr?.on("data", (d: Buffer) => agentLog.push(d.toString()))
  }, 120_000)

  afterAll(async () => {
    agent?.kill("SIGTERM")
    sim?.kill("SIGTERM")
    await new Promise((r) => server?.close(r))
    await t?.client.close()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  })

  async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await check()) return
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error(
      `tempo esgotado esperando ${what}\n--- HTTP ---\n${httpLog.slice(-30).join("\n")}\n--- agente ---\n${agentLog.join("").slice(-6000)}`,
    )
  }

  it(
    "o agente se registra, baixa a config, lê o simulador e grava estado, live e minutos fechados",
    async () => {
      const org = client.organizationId

      // Registro: token novo (o semeado deixou de valer) e auditoria.
      const [gw] = await rows<{ token_hash: string; hostname: string }>(t, "SELECT token_hash, hostname FROM gateway WHERE id = $1", [
        client.gatewayId,
      ])
      expect(gw?.hostname).toBe("e2e-gw")
      expect(await count(t, "SELECT 1 FROM audit_log WHERE action = 'gateway.enrolled' AND entity_id = $1", [client.gatewayId])).toBe(1)

      await waitFor(
        "config aplicada, live e estado das máquinas",
        async () =>
          (await count(t, "SELECT 1 FROM gateway WHERE id = $1 AND config_version_applied = 1", [client.gatewayId])) === 1 &&
          (await count(t, "SELECT 1 FROM machine_live WHERE organization_id = $1", [org])) === MACHINES &&
          (await count(t, "SELECT DISTINCT machine_id FROM machine_state_event WHERE organization_id = $1", [org])) === MACHINES,
        45_000,
      )
      expect(await count(t, "SELECT 1 FROM gateway_device_status WHERE organization_id = $1 AND status = 'connected'", [org])).toBe(MACHINES)
      expect(await count(t, "SELECT 1 FROM audit_log WHERE organization_id = $1 AND action = 'gateway.config_applied'", [org])).toBe(1)

      await waitFor(
        "um minuto fechado de cada máquina",
        async () => (await count(t, "SELECT DISTINCT machine_id FROM production_minute WHERE organization_id = $1", [org])) === MACHINES,
        100_000,
      )
      const minutes = await rows<{ total: number; seconds: number }>(
        t,
        "SELECT total, run_s + stop_s + fault_s + setup_s + no_comm_s AS seconds FROM production_minute WHERE organization_id = $1",
        [org],
      )
      expect(minutes.every((m) => m.seconds === 60)).toBe(true)
      // Nenhuma requisição do agente foi recusada (304 do /config é sucesso).
      expect(httpLog.filter((l) => !/→ (200|201|304)$/.test(l))).toEqual([])
    },
    180_000,
  )
})
