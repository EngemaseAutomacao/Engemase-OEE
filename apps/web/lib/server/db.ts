/**
 * Conexões com o Postgres (Neon) para o código de servidor, criadas sob demanda. Nada conecta na
 * importação nem no build: sem endereço, `getDb()` devolve `null` e as rotas respondem 503.
 * Endereços de cada papel (app, Better Auth, manutenção): `lib/server/db-url.ts`.
 *
 * Driver: `pg` (node-postgres) com pool, via `drizzle-orm/node-postgres`. É o recomendado para
 * Functions da Vercel com Fluid compute (instâncias reaproveitadas entre requisições) e tem
 * transação interativa, que a RLS exige (`withTenant`: SET LOCAL ROLE + app.set_tenant). O driver HTTP
 * da Neon não serve. Em produção, use a URL com pooler da Neon (`-pooler`, PgBouncer em modo
 * transação: compatível, porque `SET LOCAL`/`set_config(..., true)` valem só dentro da transação).
 *
 * O usuário de login precisa ser membro de `app_user` (ver packages/db/README.md), nunca o dono das
 * tabelas.
 */
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { appDatabaseUrl, authDatabaseUrl, maintenanceDatabaseUrl } from "./db-url"
import type { GatewayDb } from "./gateway/types"

interface CachedDb {
  readonly url: string
  readonly db: GatewayDb
  readonly pool: Pool
}

let cached: CachedDb | undefined
let cachedAuth: CachedDb | undefined

function poolMax(): number {
  const value = Number(process.env.DATABASE_POOL_MAX ?? "")
  return Number.isInteger(value) && value >= 1 && value <= 50 ? value : 5
}

function connect(url: string, previous: CachedDb | undefined, label: string): CachedDb {
  if (previous?.url === url) return previous
  void previous?.pool.end().catch(() => undefined)
  const pool = new Pool({
    connectionString: url,
    max: poolMax(),
    // Instâncias ociosas não seguram conexões no pooler da Neon.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
  // Erro numa conexão ociosa (ex.: o pooler fechou) não pode derrubar o processo.
  pool.on("error", (error) => console.error(`[db] erro numa conexão ociosa do pool (${label})`, error))
  return { url, pool, db: drizzle({ client: pool }) }
}

/** Banco da aplicação, ou `null` se não houver endereço seguro (ver `lib/server/db-url.ts`). */
export function getDb(): GatewayDb | null {
  const url = appDatabaseUrl()
  if (url === null) return null
  cached = connect(url, cached, "app")
  return cached.db
}

/**
 * Banco do Better Auth (login que herda `auth_service`; ver `lib/server/db-url.ts`).
 */
export function getAuthDb(): GatewayDb | null {
  const url = authDatabaseUrl()
  if (url === null) return null
  if (url === appDatabaseUrl()) return getDb()
  cachedAuth = connect(url, cachedAuth, "auth")
  return cachedAuth.db
}

/** Roda `fn` com uma conexão de manutenção aberta só para isso. */
export type MaintenanceDbRunner = <T>(fn: (db: GatewayDb) => Promise<T>) => Promise<T>

/**
 * Conexão de MANUTENÇÃO (`DATABASE_MAINTENANCE_URL`, senão o `DATABASE_URL_UNPOOLED` da integração): o papel DONO das tabelas, usado só pela limpeza
 * diária para criar e apagar partições (`maintainPartitions()`, que é DDL). Conexão direta (sem pooler),
 * aberta para a tarefa e fechada no fim: nunca fica num pool da aplicação. Sem a variável devolve `null`,
 * e a limpeza registra e pula as partições.
 */
export function maintenanceDbRunner(): MaintenanceDbRunner | null {
  const url = maintenanceDatabaseUrl()
  if (url === null) return null
  return async (fn) => {
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 1_000 })
    pool.on("error", (error) => console.error("[db] erro na conexão de manutenção", error))
    try {
      return await fn(drizzle({ client: pool }))
    } finally {
      await pool.end().catch(() => undefined)
    }
  }
}
