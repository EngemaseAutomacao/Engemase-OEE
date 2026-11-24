/**
 * PoC de carga da API dos gateways (W3; docs/09 Fase 0, meta da L13 no docs/17): N gateways
 * simulados, cada um com a config de exemplo do contrato (1 CLP TCP + 2 escravos RTU, 3 máquinas),
 * baixam a config e mandam /sync em ciclo com saúde, live, eventos de estado e minutos fechados,
 * montados e validados com os schemas de @engemase/contracts. Mede latência (p50/p95/p99/máx) e erros
 * por rota e, no fim, confere no banco que todo minuto enviado foi gravado.
 *
 * Fica fora da suíte normal (POC_GATEWAYS=1 liga). Roteiro completo: docs/operacao/poc-100-gateways.md.
 *
 *   pnpm --filter web poc:gateways                              # 5 gateways, PGlite, API no processo
 *   POC_N=20 POC_DATABASE_URL=postgres://... pnpm --filter web poc:gateways   # Postgres local, driver pg
 *   POC_N=100 POC_API_URL=https://<preview>.vercel.app POC_DATABASE_URL=<branch Neon, dono> \
 *     POC_INTERVALO_MS=10000 POC_CICLOS=30 pnpm --filter web poc:gateways  # preview na Vercel + Neon
 *
 * Variáveis (todas opcionais; ver apps/web/.env.example):
 *   POC_N               gateways simulados (padrão 5)
 *   POC_CICLOS          /sync por gateway (padrão 5)
 *   POC_INTERVALO_MS    intervalo entre /sync de um gateway (padrão 1000; o agente usa 10000)
 *   POC_API_URL         API de fora (ex.: preview da Vercel). Sem ela, a API roda neste processo
 *   POC_DATABASE_URL    Postgres para o seed e as conferências (dono das tabelas; sem ela, PGlite)
 *   POC_DATABASE_URL_APP  só com a API no processo: conexão que a API usa (membro de app_user);
 *                       padrão: POC_DATABASE_URL
 *   POC_POOL_MAX        conexões do pool da API no processo (padrão 5, como DATABASE_POOL_MAX)
 *   POC_MIGRAR=1        aplica as migrações em POC_DATABASE_URL antes (banco vazio, local ou branch)
 *   POC_META_P99_MS     p99 máximo aceito do /sync (padrão 1000: "99% em menos de 1 s", L13)
 *   POC_MAX_ERROS       erros aceitos no total (padrão 0)
 *   POC_RELATORIO       caminho de um JSON com o resultado (opcional)
 */
import { writeFileSync } from "node:fs"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { gzipSync } from "node:zlib"
import { PGlite } from "@electric-sql/pglite"
import {
  API_ROUTES,
  GatewayConfigSchema,
  type GatewayConfig,
  type MachineState,
  type SyncRequest,
  SyncRequestSchema,
  SyncResponseSchema,
} from "@engemase/contracts"
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres"
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator"
import { drizzle as drizzlePglite } from "drizzle-orm/pglite"
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator"
import { Pool } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { GatewayDb } from "@/lib/server/gateway/types"
import { serveGatewayApi } from "../gateway/servidor"
import { EXAMPLE_CONFIG, MIGRATIONS_FOLDER, remapIds, type SeededClient, seedClient, uuidv7 } from "../gateway/support"

const RUN = process.env.POC_GATEWAYS === "1"

function inteiro(nome: string, padrao: number): number {
  const bruto = process.env[nome]?.trim()
  if (bruto === undefined || bruto === "") return padrao
  const valor = Number(bruto)
  if (!Number.isInteger(valor) || valor < 0) throw new Error(`${nome} deve ser um inteiro >= 0 (veio "${bruto}")`)
  return valor
}

function texto(nome: string): string | undefined {
  const valor = process.env[nome]?.trim()
  return valor === undefined || valor === "" ? undefined : valor
}

const N = inteiro("POC_N", 5)
const CICLOS = inteiro("POC_CICLOS", 5)
const INTERVALO_MS = inteiro("POC_INTERVALO_MS", 1000)
const META_P99_MS = inteiro("POC_META_P99_MS", 1000)
const MAX_ERROS = inteiro("POC_MAX_ERROS", 0)
const POOL_MAX = inteiro("POC_POOL_MAX", 5)
const API_URL = texto("POC_API_URL")?.replace(/\/+$/, "")
const DATABASE_URL = texto("POC_DATABASE_URL")
const DATABASE_URL_APP = texto("POC_DATABASE_URL_APP") ?? DATABASE_URL
const MIGRAR = process.env.POC_MIGRAR === "1"
const RELATORIO = texto("POC_RELATORIO")
/** Gateways semeados em paralelo (o seed faz ~30 INSERTs por gateway). */
const SEED_PARALELO = 5
/** O agente desiste em 30 s (timeout do uplink). */
const TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Medidas
// ---------------------------------------------------------------------------

type Rota = "config" | "sync"

interface Medida {
  readonly rota: Rota
  readonly ms: number
  /** Status HTTP, ou 0 para falha de rede/tempo esgotado. */
  readonly status: number
  readonly erro?: string
}

function percentil(ordenados: readonly number[], p: number): number {
  if (ordenados.length === 0) return 0
  const i = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)
  return ordenados[Math.max(0, i)] ?? 0
}

interface Resumo {
  readonly rota: Rota
  readonly total: number
  readonly erros: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly max: number
  readonly porStatus: Record<string, number>
}

function resumir(medidas: readonly Medida[], rota: Rota): Resumo {
  const daRota = medidas.filter((m) => m.rota === rota)
  const ms = daRota.map((m) => m.ms).sort((a, b) => a - b)
  const porStatus: Record<string, number> = {}
  for (const m of daRota) porStatus[String(m.status)] = (porStatus[String(m.status)] ?? 0) + 1
  const arred = (v: number) => Math.round(v * 10) / 10
  return {
    rota,
    total: daRota.length,
    erros: daRota.filter((m) => m.erro !== undefined).length,
    p50: arred(percentil(ms, 50)),
    p95: arred(percentil(ms, 95)),
    p99: arred(percentil(ms, 99)),
    max: arred(ms.at(-1) ?? 0),
    porStatus,
  }
}

// ---------------------------------------------------------------------------
// Gateway simulado (o que o agente Go manda, no formato do contrato)
// ---------------------------------------------------------------------------

const ESTADOS: readonly MachineState[] = ["RUNNING", "STOPPED", "RUNNING", "FAULT", "RUNNING", "SETUP"]
const MINUTO_MS = 60_000

function cabecalhos(token: string, json: boolean): Record<string, string> {
  return {
    "User-Agent": "oee-gateway/1.2.0 (linux; arm64) poc-carga",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json", "Content-Encoding": "gzip" } : { "Accept-Encoding": "gzip" }),
  }
}

/**
 * Um /sync do ciclo `k`: saúde do agente e dos CLPs, live de cada máquina, um evento de estado por
 * máquina e o minuto fechado de cada máquina. Os minutos são do passado (a API recusa timestamps
 * além de server_time + 2 min) e um por ciclo, então cada gateway grava exatamente
 * `máquinas × CICLOS` minutos — o que a conferência no fim espera.
 */
function montarSync(config: GatewayConfig, k: number, seq: number, primeiroMinuto: number, agora: Date): SyncRequest {
  const machines = config.machines
  const atIso = agora.toISOString()
  const estado = (i: number) => ESTADOS[(k + i) % ESTADOS.length] ?? "RUNNING"
  const anterior = (i: number) => ESTADOS[(k + i + ESTADOS.length - 1) % ESTADOS.length] ?? "RUNNING"
  const t = new Date(primeiroMinuto + k * MINUTO_MS).toISOString().replace(/\.\d{3}Z$/, "Z")
  let s = seq

  const events: NonNullable<SyncRequest["events"]> = machines.map((m, i) => ({
    id: uuidv7(agora.getTime()),
    seq: s++,
    type: "state" as const,
    machine_id: m.id,
    at: new Date(agora.getTime() - 500).toISOString(),
    state: estado(i),
    previous_state: anterior(i),
    ...(estado(i) === "FAULT" ? { fault_code: 47 } : {}),
  }))
  const minutes: NonNullable<SyncRequest["minutes"]> = machines.map((m) => ({
    seq: s++,
    machine_id: m.id,
    t,
    run_s: 45,
    stop_s: 10,
    fault_s: 5,
    setup_s: 0,
    no_comm_s: 0,
    total: 12,
    reject: 1,
    product: "7",
  }))
  const live: NonNullable<SyncRequest["live"]> = machines.map((m, i) => ({
    machine_id: m.id,
    at: atIso,
    state: estado(i),
    state_since: new Date(agora.getTime() - 500).toISOString(),
    counter_total: 100_000 + k * 12,
    product: "7",
    speed: estado(i) === "RUNNING" ? 12 : 0,
    ...(estado(i) === "FAULT" ? { fault_code: 47 } : {}),
  }))

  return SyncRequestSchema.parse({
    batch: { seq_from: seq, seq_to: s - 1, sent_at: atIso },
    agent: {
      version: "1.2.0",
      uptime_s: 3600 + k * 10,
      config_version: config.config_version,
      cpu_pct: 7.5,
      mem_mb: 38,
      disk_free_mb: 21_000,
      buffer_pending: s - seq,
      clock_offset_ms: 5,
      ntp_synced: true,
    },
    devices: config.devices.map((d) => ({ id: d.id, status: "connected", latency_ms: 18, errors_1m: 0, last_ok_at: atIso })),
    buses: config.serial_buses.map((b) => ({ id: b.id, status: "ok", cycle_ms: 380, busy_pct: 40, overruns_1m: 0 })),
    events,
    minutes,
    live,
  }) as SyncRequest
}

async function chamar(rota: Rota, url: string, init: RequestInit, medidas: Medida[]): Promise<Response | undefined> {
  const inicio = performance.now()
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const corpo = await res.arrayBuffer()
    const ms = performance.now() - inicio
    const ok = rota === "config" ? res.status === 200 || res.status === 304 : res.status === 200
    medidas.push({ rota, ms, status: res.status, ...(ok ? {} : { erro: Buffer.from(corpo).toString("utf8").slice(0, 300) }) })
    return new Response(corpo, { status: res.status, headers: res.headers })
  } catch (error) {
    medidas.push({ rota, ms: performance.now() - inicio, status: 0, erro: String(error) })
    return undefined
  }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Um gateway: GET /config, depois CICLOS × POST /sync, com início espalhado no intervalo. */
async function gatewaySimulado(api: string, client: SeededClient, primeiroMinuto: number, medidas: Medida[]): Promise<void> {
  await dormir(Math.random() * INTERVALO_MS)
  const resConfig = await chamar("config", `${api}${API_ROUTES.config}`, { method: "GET", headers: cabecalhos(client.token, false) }, medidas)
  if (resConfig?.status === 200) GatewayConfigSchema.parse(await resConfig.json())

  let seq = 1
  for (let k = 0; k < CICLOS; k++) {
    const inicio = Date.now()
    const body = montarSync(client.config, k, seq, primeiroMinuto, new Date())
    const res = await chamar(
      "sync",
      `${api}${API_ROUTES.sync}`,
      { method: "POST", headers: cabecalhos(client.token, true), body: gzipSync(JSON.stringify(body)) },
      medidas,
    )
    if (res?.status === 200) {
      const resposta = SyncResponseSchema.parse(await res.json())
      if (resposta.ack_seq !== body.batch.seq_to) {
        medidas.push({ rota: "sync", ms: 0, status: 200, erro: `ack_seq ${resposta.ack_seq} ≠ seq_to ${body.batch.seq_to}` })
      }
      seq = (body.batch.seq_to ?? seq) + 1
    }
    // Sem ack, o agente reenvia o mesmo lote; aqui o próximo ciclo segue com um lote novo.
    else seq = (body.batch.seq_to ?? seq) + 1
    const resto = INTERVALO_MS - (Date.now() - inicio)
    if (k < CICLOS - 1 && resto > 0) await dormir(resto)
  }
}

// ---------------------------------------------------------------------------
// Banco e API
// ---------------------------------------------------------------------------

interface Ambiente {
  /** Banco para seed e conferências (dono das tabelas). */
  readonly db: GatewayDb
  readonly contar: (sql: string, params: unknown[]) => Promise<number>
  readonly api: string
  readonly descricao: string
  readonly fechar: () => Promise<void>
}

async function prepararAmbiente(): Promise<Ambiente> {
  const fechar: Array<() => Promise<unknown>> = []
  let db: GatewayDb
  let contar: Ambiente["contar"]
  let apiDb: GatewayDb
  let banco: string

  if (DATABASE_URL !== undefined) {
    const pool = new Pool({ connectionString: DATABASE_URL, max: SEED_PARALELO })
    fechar.push(() => pool.end())
    db = drizzlePg({ client: pool })
    if (MIGRAR) await migratePg(drizzlePg({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER })
    contar = async (sql, params) => Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM (${sql}) AS q`, params)).rows[0]?.n ?? 0)
    const appPool = new Pool({ connectionString: DATABASE_URL_APP, max: POOL_MAX, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 })
    fechar.push(() => appPool.end())
    apiDb = drizzlePg({ client: appPool })
    banco = `Postgres (pg, pool ${POOL_MAX})`
  } else {
    const client = new PGlite()
    fechar.push(() => client.close())
    const pglite = drizzlePglite({ client })
    await migratePglite(pglite, { migrationsFolder: MIGRATIONS_FOLDER })
    db = pglite
    contar = async (sql, params) => (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) AS q`, params)).rows[0]?.n ?? 0
    apiDb = db
    banco = "PGlite (uma conexão: mede a lógica, não o desempenho do banco)"
  }

  let api: string
  let descricao: string
  if (API_URL !== undefined) {
    api = API_URL
    descricao = `API em ${API_URL}; seed em ${banco}`
  } else {
    const server: Server = serveGatewayApi({ db: apiDb, logError: (m, e) => console.error(m, e) })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    fechar.unshift(() => new Promise((r) => server.close(r)))
    api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    descricao = `API neste processo (node:http + handlers dos route.ts) sobre ${banco}`
  }

  return {
    db,
    contar,
    api,
    descricao,
    fechar: async () => {
      for (const f of fechar) await f()
    },
  }
}

/** N clientes, cada um com um gateway ativo e a config de exemplo com ids próprios. */
async function semear(db: GatewayDb): Promise<SeededClient[]> {
  const rodada = Date.now().toString(36)
  const clientes: SeededClient[] = new Array(N)
  let proximo = 0
  async function trabalhador(): Promise<void> {
    while (proximo < N) {
      const i = proximo++
      const config = remapIds(EXAMPLE_CONFIG, new Map<string, string>())
      clientes[i] = await seedClient(db, { slug: `poc-${rodada}-${String(i + 1).padStart(3, "0")}`, config })
    }
  }
  await Promise.all(Array.from({ length: Math.min(SEED_PARALELO, N) }, trabalhador))
  return clientes
}

describe.skipIf(!RUN)(`PoC de carga: ${N} gateways simulados × ${CICLOS} /sync`, () => {
  let amb: Ambiente
  let clientes: SeededClient[]

  beforeAll(async () => {
    amb = await prepararAmbiente()
    const inicio = performance.now()
    clientes = await semear(amb.db)
    console.log(`[poc] ${amb.descricao}`)
    console.log(`[poc] seed de ${N} gateways em ${Math.round(performance.now() - inicio)} ms`)
  }, 30 * 60_000)

  afterAll(async () => {
    await amb?.fechar()
  })

  it(
    "todos os /config e /sync respondem sem erro, dentro da meta, e os minutos ficam gravados",
    async () => {
      const medidas: Medida[] = []
      // Minutos fechados bem no passado: nenhum passa de server_time e não colidem entre ciclos.
      const primeiroMinuto = Math.floor(Date.now() / MINUTO_MS) * MINUTO_MS - (CICLOS + 10) * MINUTO_MS
      const inicio = performance.now()
      await Promise.all(clientes.map((c) => gatewaySimulado(amb.api, c, primeiroMinuto, medidas)))
      const duracaoS = (performance.now() - inicio) / 1000

      const resumos = [resumir(medidas, "config"), resumir(medidas, "sync")]
      const erros = medidas.filter((m) => m.erro !== undefined)
      const syncs = resumos[1]?.total ?? 0
      console.log(`[poc] ${N} gateways, ${CICLOS} ciclos a cada ${INTERVALO_MS} ms, ${duracaoS.toFixed(1)} s, ${(syncs / duracaoS).toFixed(1)} /sync por s`)
      console.table(
        resumos.map((r) => ({
          rota: r.rota,
          total: r.total,
          erros: r.erros,
          "p50 ms": r.p50,
          "p95 ms": r.p95,
          "p99 ms": r.p99,
          "máx ms": r.max,
          status: JSON.stringify(r.porStatus),
        })),
      )
      for (const e of erros.slice(0, 10)) console.log(`[poc] erro ${e.rota} ${e.status}: ${e.erro}`)

      // Conferência no banco: cada gateway gravou máquinas × CICLOS minutos (sem perda nem duplicata).
      const orgs = clientes.map((c) => c.organizationId)
      const minutosGravados = await amb.contar("SELECT 1 FROM production_minute WHERE organization_id = ANY($1::uuid[])", [orgs])
      const minutosEsperados = clientes.reduce((soma, c) => soma + c.config.machines.length * CICLOS, 0)
      console.log(`[poc] minutos gravados ${minutosGravados} de ${minutosEsperados}`)

      if (RELATORIO !== undefined) {
        writeFileSync(
          RELATORIO,
          `${JSON.stringify(
            {
              quando: new Date().toISOString(),
              ambiente: amb.descricao,
              gateways: N,
              ciclos: CICLOS,
              intervaloMs: INTERVALO_MS,
              duracaoS: Math.round(duracaoS * 10) / 10,
              resumos,
              minutos: { gravados: minutosGravados, esperados: minutosEsperados },
              erros: erros.slice(0, 50),
            },
            null,
            2,
          )}\n`,
        )
      }

      expect(erros.length, `erros: ${erros.slice(0, 3).map((e) => `${e.rota} ${e.status} ${e.erro ?? ""}`).join(" | ")}`).toBeLessThanOrEqual(MAX_ERROS)
      expect(resumos[1]?.total).toBe(N * CICLOS)
      expect(resumos[1]?.p99 ?? 0, `p99 do /sync acima da meta de ${META_P99_MS} ms`).toBeLessThanOrEqual(META_P99_MS)
      if (MAX_ERROS === 0) expect(minutosGravados).toBe(minutosEsperados)
    },
    // Tempo do teste: ciclos × intervalo, mais folga para a latência.
    CICLOS * INTERVALO_MS + 10 * 60_000,
  )
})
