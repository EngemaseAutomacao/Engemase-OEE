/**
 * Apoio aos testes da API dos gateways: banco PGlite (Postgres 18 em WASM) com as migrações de
 * @engemase/db, como em packages/db/test/helpers.ts, mais um seed de cliente montado a partir da
 * config de exemplo do contrato e montagem de requisições HTTP como as do agente Go (gzip + Bearer).
 *
 * O PGlite conecta como `postgres` (superusuário, ignora a RLS): o seed e as conferências usam essa
 * conexão; a API roda com `withTenant` (`SET LOCAL ROLE app_user` + `app.set_tenant`), sob RLS.
 */
import { randomBytes, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { gzipSync } from "node:zlib"
import { PGlite } from "@electric-sql/pglite"
import { API_ROUTES, type GatewayConfig } from "@engemase/contracts"
import * as s from "@engemase/db"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { hashActivationCode } from "@/lib/server/gateway/enroll"
import { generateGatewayToken, hashGatewayToken } from "@/lib/server/gateway/auth"
import type { GatewayApiDeps } from "@/lib/server/gateway/handlers"
import type { GatewayDb } from "@/lib/server/gateway/types"

const require = createRequire(import.meta.url)

/** Migrações do pacote @engemase/db (ao lado de src/). */
export const MIGRATIONS_FOLDER = join(dirname(require.resolve("@engemase/db")), "..", "migrations")

const FIXTURES_FOLDER = dirname(require.resolve("@engemase/contracts/fixtures/manifest.json"))

/** Lê uma fixture do contrato (`packages/contracts/fixtures/<nome>.json`). */
export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_FOLDER, name.endsWith(".json") ? name : `${name}.json`), "utf8")) as T
}

export interface ManifestEntry {
  readonly file: string
  readonly schema: string
  readonly valid: boolean
  readonly description: string
  readonly expect?: { readonly path?: string; readonly rule?: string }
}

/** Fixtures do manifesto de um schema (ex.: todas as `sync-request` inválidas). */
export function manifest(schema: string, valid: boolean): ManifestEntry[] {
  const { fixtures } = fixture<{ fixtures: ManifestEntry[] }>("manifest")
  return fixtures.filter((f) => f.schema === schema && f.valid === valid)
}

/** Config de exemplo do contrato: 1 CLP TCP + 2 escravos RTU, 3 máquinas, 12 tags, versão 42. */
export const EXAMPLE_CONFIG = fixture<GatewayConfig>("gateway-config.valid.tcp-and-rtu-bus")

/** Instante "do servidor" coerente com os timestamps das fixtures de /sync (2026-11-11 ~13:02 UTC). */
export const FIXTURE_NOW = new Date("2026-11-11T13:02:05.410Z")

export interface TestDatabase {
  readonly client: PGlite
  readonly db: GatewayDb
}

/** Banco vazio em memória com todas as migrações. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite()
  const db = drizzle({ client })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return { client, db }
}

/** Dependências dos handlers para os testes. */
export function deps(t: TestDatabase, now?: Date): GatewayApiDeps {
  return { db: t.db, ...(now !== undefined ? { now: () => now } : {}), logError: () => undefined }
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** UUIDv7 novo (48 bits de tempo + aleatório), como o agente gera. */
export function uuidv7(at: number = Date.now()): string {
  const bytes = randomBytes(16)
  bytes.writeUIntBE(at, 0, 6)
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f)
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f)
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Troca todos os UUIDs de um JSON por UUIDv7 novos, de forma consistente pelo `map` (o mesmo id
 * vira sempre o mesmo id novo). Serve para criar o "cliente B" a partir da config/fixtures do A.
 */
export function remapIds<T>(value: T, map: Map<string, string>): T {
  return JSON.parse(
    JSON.stringify(value).replace(UUID_RE, (id) => {
      const k = id.toLowerCase()
      let mapped = map.get(k)
      if (mapped === undefined) {
        mapped = uuidv7()
        map.set(k, mapped)
      }
      return mapped
    }),
  ) as T
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export interface SeededClient {
  readonly organizationId: string
  readonly slug: string
  readonly userId: string
  readonly unitId: string
  readonly lineId: string
  readonly gatewayId: string
  /** Token em claro (o banco guarda só o hash). */
  readonly token: string
  readonly config: GatewayConfig
  readonly machineIds: readonly string[]
}

function first<T>(rows: readonly T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error("insert sem retorno")
  return row
}

export interface SeedOptions {
  readonly slug: string
  /** Config publicada (os ids viram as linhas do banco). Padrão: a config de exemplo do contrato. */
  readonly config?: GatewayConfig
  /** Sessões de acesso remoto a criar com estes ids. */
  readonly remoteSessionIds?: readonly string[]
  /** Cria o gateway (e suas máquinas) dentro do cliente, unidade e linha de outro seed. */
  readonly into?: SeededClient
}

/**
 * Cliente completo para a API: organização, unidade, linha, máquinas, gateway ATIVO com token,
 * barramentos, dispositivos, vínculos gateway ↔ máquina, tags e a config publicada (snapshot).
 * Gravado como dono do banco, como faria um seed.
 */
export async function seedClient(db: GatewayDb, options: SeedOptions): Promise<SeededClient> {
  const config = options.config ?? EXAMPLE_CONFIG
  const { into } = options
  const organizationId =
    into?.organizationId ??
    first(await db.insert(s.organization).values({ name: `Cliente ${options.slug}`, slug: options.slug }).returning()).id
  const person =
    into !== undefined
      ? { id: into.userId }
      : first(
          await db
            .insert(s.user)
            .values({ name: `Técnico ${options.slug}`, email: `tecnico-${options.slug}-${randomUUID()}@example.com` })
            .returning(),
        )
  const unitRow = into !== undefined ? { id: into.unitId } : first(await db.insert(s.unit).values({ organizationId, name: "Planta 1" }).returning())
  const lineRow =
    into !== undefined
      ? { id: into.lineId }
      : first(await db.insert(s.line).values({ organizationId, unitId: unitRow.id, name: "Linha A" }).returning())

  for (const m of config.machines) {
    await db.insert(s.machine).values({
      id: m.id,
      organizationId,
      unitId: unitRow.id,
      lineId: lineRow.id,
      name: m.name ?? "Máquina",
      stateRules: m.state_rules,
      ...(m.max_rate_per_s !== undefined ? { maxRatePerS: m.max_rate_per_s } : {}),
    })
  }

  const token = generateGatewayToken()
  const gw = first(
    await db
      .insert(s.gateway)
      .values({
        ...(config.gateway_id !== undefined ? { id: config.gateway_id } : {}),
        organizationId,
        unitId: unitRow.id,
        name: `Gateway ${options.slug}`,
        status: "active",
        tokenHash: hashGatewayToken(token),
        configVersionLatest: config.config_version,
      })
      .returning(),
  )

  for (const bus of config.serial_buses) {
    await db.insert(s.serialBus).values({
      id: bus.id,
      organizationId,
      gatewayId: gw.id,
      name: bus.name ?? null,
      port: bus.port,
      baud: bus.baud,
      parity: bus.parity,
      dataBits: bus.data_bits,
      stopBits: bus.stop_bits,
    })
  }
  for (const m of config.machines) {
    await db.insert(s.gatewayMachine).values({ organizationId, gatewayId: gw.id, machineId: m.id, unitId: unitRow.id })
  }
  for (const d of config.devices) {
    await db.insert(s.device).values({
      id: d.id,
      organizationId,
      gatewayId: gw.id,
      serialBusId: d.protocol === "modbus-rtu" ? d.params.bus : null,
      name: d.name ?? "CLP",
      protocol: d.protocol,
      params: d.params,
      blocks: d.blocks ?? [],
      enabled: d.enabled ?? true,
    })
    for (const tg of d.tags) {
      await db.insert(s.tag).values({
        id: tg.id,
        organizationId,
        gatewayId: gw.id,
        deviceId: d.id,
        machineId: tg.machine_id ?? null,
        name: tg.name ?? null,
        address: tg.address,
        dataType: tg.type,
        wordOrder: tg.word_order ?? null,
        scale: tg.scale ?? null,
        pollMs: tg.poll_ms ?? null,
        role: tg.role,
        sampling: tg.sampling ?? null,
      })
    }
  }
  await db.insert(s.gatewayConfigVersion).values({
    organizationId,
    gatewayId: gw.id,
    version: config.config_version,
    snapshot: config,
  })
  for (const id of options.remoteSessionIds ?? []) {
    await db.insert(s.remoteAccessSession).values({
      id,
      organizationId,
      gatewayId: gw.id,
      requestedBy: person.id,
      reason: "Diagnóstico",
      requestedDurationMin: 60,
      status: "active",
    })
  }

  return {
    organizationId,
    slug: into?.slug ?? options.slug,
    userId: person.id,
    unitId: unitRow.id,
    lineId: lineRow.id,
    gatewayId: gw.id,
    token,
    config,
    machineIds: config.machines.map((m) => m.id),
  }
}

/** Gateway novo (aguardando ativação) com um código de ativação; devolve o código em claro. */
export async function seedEnrollment(
  db: GatewayDb,
  client: SeededClient,
  options: { code?: string; expiresAt?: Date; createdAt?: Date; gatewayStatus?: "pending_enrollment" | "revoked" } = {},
): Promise<{ gatewayId: string; code: string; enrollmentId: string }> {
  const status = options.gatewayStatus ?? "pending_enrollment"
  const gw = first(
    await db
      .insert(s.gateway)
      .values({
        organizationId: client.organizationId,
        unitId: client.unitId,
        name: "Gateway novo",
        status,
        ...(status === "revoked" ? { revokedAt: new Date() } : {}),
      })
      .returning(),
  )
  const code = options.code ?? randomActivationCode()
  const enrollment = first(
    await db
      .insert(s.gatewayEnrollment)
      .values({
        organizationId: client.organizationId,
        gatewayId: gw.id,
        codeHash: hashActivationCode(code),
        expiresAt: options.expiresAt ?? new Date(Date.now() + 24 * 3_600_000),
        ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
      })
      .returning(),
  )
  return { gatewayId: gw.id, code, enrollmentId: enrollment.id }
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/** Código de ativação aleatório no formato da web (ABCD-1234). */
export function randomActivationCode(): string {
  const chars = [...randomBytes(8)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`
}

// ---------------------------------------------------------------------------
// Requisições como as do agente Go (internal/uplink/client.go)
// ---------------------------------------------------------------------------

export interface RequestOptions {
  /** Token Bearer (`null` = sem cabeçalho Authorization). */
  readonly token?: string | null
  /** Compacta com gzip (padrão: sim, como o agente). */
  readonly gzip?: boolean
  readonly headers?: Readonly<Record<string, string>>
}

function agentHeaders(options: RequestOptions, json: boolean): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": "oee-gateway/1.2.0 (linux; arm64)", Accept: "application/json" }
  if (json) headers["Content-Type"] = "application/json"
  if (json && options.gzip !== false) headers["Content-Encoding"] = "gzip"
  if (options.token !== undefined && options.token !== null) headers.Authorization = `Bearer ${options.token}`
  return { ...headers, ...options.headers }
}

function postJson(path: string, body: unknown, options: RequestOptions): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body)
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: agentHeaders(options, true),
    body: options.gzip === false ? raw : gzipSync(raw),
  })
}

export function syncRequest(body: unknown, options: RequestOptions = {}): Request {
  return postJson(API_ROUTES.sync, body, options)
}

export function enrollRequest(body: unknown, options: RequestOptions = {}): Request {
  return postJson(API_ROUTES.enroll, body, options)
}

export function configRequest(options: RequestOptions & { ifNoneMatch?: string } = {}): Request {
  const headers = agentHeaders(options, false)
  headers["Accept-Encoding"] = "gzip"
  if (options.ifNoneMatch !== undefined) headers["If-None-Match"] = options.ifNoneMatch
  return new Request(`http://localhost${API_ROUTES.config}`, { method: "GET", headers })
}

// ---------------------------------------------------------------------------
// Conferências no banco (como dono, sem RLS)
// ---------------------------------------------------------------------------

/** `SELECT count(*)` numa consulta qualquer. */
export async function count(t: TestDatabase, query: string, params: unknown[] = []): Promise<number> {
  const result = await t.client.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${query}) AS q`, params)
  return result.rows[0]?.n ?? 0
}

/** Linhas de uma consulta qualquer. */
export async function rows<T>(t: TestDatabase, query: string, params: unknown[] = []): Promise<T[]> {
  return (await t.client.query<T>(query, params)).rows
}

/** Contagem de linhas de dados de produção de um cliente (para provar que nada mudou). */
export async function dataFootprint(t: TestDatabase, organizationId: string): Promise<Record<string, number>> {
  const tables = [
    "machine_state_event",
    "production_minute",
    "production_run",
    "machine_live",
    "tag_sample",
    "gateway_device_status",
    "audit_log",
    "remote_access_event",
  ]
  const out: Record<string, number> = {}
  for (const table of tables) {
    out[table] = await count(t, `SELECT 1 FROM ${table} WHERE organization_id = $1`, [organizationId])
  }
  return out
}
