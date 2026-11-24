/**
 * Limites de taxa da API dos gateways (L21 do docs/17), guardados no Postgres para valer entre as
 * instâncias serverless da Vercel (memória do processo não serve: cada instância contaria sozinha).
 *
 * Algoritmo GCRA (`app.rate_limit_take`, migração 0011 de @engemase/db): uma requisição a cada
 * `intervalMs`, com até `burst` seguidas. Acima disso: 429 `rate_limited` com `retry_after_s` (e o
 * cabeçalho `Retry-After`), que o agente respeita.
 *
 * | Rota      | Chave                 | Limite                                         |
 * |-----------|-----------------------|------------------------------------------------|
 * | /sync     | gateway               | 60 por minuto, rajada de 10                    |
 * | /config   | gateway               | 30 por minuto, rajada de 5                     |
 * | /enroll   | IP de origem          | 10 por hora (rajada de 10)                     |
 * | /enroll   | código (hash)         | 5 tentativas (uma nova a cada 4,8 h: o código vale 24 h) |
 *
 * O /sync e o /config contam depois da autenticação (o limite é do gateway autenticado; quem não
 * autentica recebe 401 sem tocar no limitador). O /enroll conta o IP antes de ler o corpo e o código
 * depois de validá-lo.
 */
import { sha256Hex } from "@engemase/db"
import { sql } from "drizzle-orm"
import { GatewayApiError } from "./errors"
import { type GatewayDb, queryRows } from "./types"

export interface RateLimit {
  /** Intervalo médio entre requisições (ms). */
  readonly intervalMs: number
  /** Quantas podem vir seguidas (rajada). */
  readonly burst: number
}

export interface RateLimits {
  readonly sync: RateLimit
  readonly config: RateLimit
  readonly enrollIp: RateLimit
  readonly enrollCode: RateLimit
}

/** Limites da L21 (docs/17). */
export const DEFAULT_RATE_LIMITS: RateLimits = {
  sync: { intervalMs: 1_000, burst: 10 },
  config: { intervalMs: 2_000, burst: 5 },
  enrollIp: { intervalMs: 360_000, burst: 10 },
  enrollCode: { intervalMs: 17_280_000, burst: 5 },
}

/** Chaves do limitador (até 200 caracteres; o código de ativação entra só como hash). */
export const rateLimitKey = {
  sync: (gatewayId: string) => `sync:gw:${gatewayId.toLowerCase()}`,
  config: (gatewayId: string) => `config:gw:${gatewayId.toLowerCase()}`,
  enrollIp: (ip: string | null) => `enroll:ip:${ip ?? "desconhecido"}`,
  enrollCode: (normalizedCode: string) => `enroll:code:${sha256Hex(normalizedCode)}`,
}

/**
 * Conta uma requisição na chave. Passou do limite: lança 429 `rate_limited` com `retry_after_s`
 * (arredondado para cima, no mínimo 1 s).
 */
export async function enforceRateLimit(db: GatewayDb, key: string, limit: RateLimit, now: Date): Promise<void> {
  const [row] = await queryRows<{ allowed: boolean; retry_after_ms: string | number }>(
    db,
    sql`SELECT allowed, retry_after_ms FROM app.rate_limit_take(${key}, ${limit.intervalMs}::integer, ${limit.burst}::integer, ${now.toISOString()}::timestamptz)`,
  )
  if (row === undefined) throw new Error("app.rate_limit_take não devolveu linha")
  if (row.allowed) return
  const retryAfterS = Math.max(1, Math.ceil(Number(row.retry_after_ms) / 1000))
  throw new GatewayApiError("rate_limited", `Limite de requisições atingido. Tente de novo em ${retryAfterS} s.`, {
    retryAfterS,
  })
}
