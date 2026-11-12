/**
 * Conexão com o Postgres (Neon) para o código de servidor, criada sob demanda a partir de
 * `DATABASE_URL`. Nada conecta na importação nem no build: sem a variável, `getDb()` devolve `null`
 * e as rotas respondem 503.
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
import type { GatewayDb } from "./gateway/types"

let cached: { readonly url: string; readonly db: GatewayDb; readonly pool: Pool } | undefined

function poolMax(): number {
  const value = Number(process.env.DATABASE_POOL_MAX ?? "")
  return Number.isInteger(value) && value >= 1 && value <= 50 ? value : 5
}

/** Banco da aplicação, ou `null` se `DATABASE_URL` não estiver definido. */
export function getDb(): GatewayDb | null {
  const url = process.env.DATABASE_URL?.trim()
  if (url === undefined || url === "") return null
  if (cached?.url !== url) {
    void cached?.pool.end().catch(() => undefined)
    const pool = new Pool({
      connectionString: url,
      max: poolMax(),
      // Instâncias ociosas não seguram conexões no pooler da Neon.
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    })
    // Erro numa conexão ociosa (ex.: o pooler fechou) não pode derrubar o processo.
    pool.on("error", (error) => console.error("[db] erro numa conexão ociosa do pool", error))
    cached = { url, pool, db: drizzle({ client: pool }) }
  }
  return cached.db
}
