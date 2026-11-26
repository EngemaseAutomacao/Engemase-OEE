/**
 * Conexão com o Postgres (Neon) para o código de servidor, criada sob demanda. Nada conecta na
 * importação nem no build: sem endereço, `getDb()` devolve `null` e as rotas respondem 503.
 *
 * Endereço (`resolveDatabaseUrl`), nesta ordem:
 * 1. `APP_DATABASE_URL`, se existir.
 * 2. `DATABASE_URL` (da integração Neon, com pooler) trocando o usuário e a senha pelos da aplicação:
 *    `APP_DB_USER` (padrão `app_login`) e `APP_DB_PASSWORD`. O usuário é criado pelo
 *    `pnpm --filter @engemase/db db:migrate` no build de produção (packages/db/README.md).
 * 3. Fora da Vercel (dev, testes): `DATABASE_URL` como está.
 * Na Vercel, sem 1 ou 2, não conecta: o `DATABASE_URL` da integração é do dono das tabelas, e o app
 * nunca pode usá-lo.
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

type Env = Readonly<Record<string, string | undefined>>

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === "" ? undefined : trimmed
}

/** Endereço do banco para a aplicação (ver o comentário do topo), ou `null` se não houver um seguro. */
export function resolveDatabaseUrl(env: Env = process.env): string | null {
  const explicit = nonEmpty(env.APP_DATABASE_URL)
  if (explicit !== undefined) return explicit

  const base = nonEmpty(env.DATABASE_URL)
  const password = nonEmpty(env.APP_DB_PASSWORD)
  if (base !== undefined && password !== undefined) {
    try {
      const url = new URL(base)
      url.username = nonEmpty(env.APP_DB_USER) ?? "app_login"
      url.password = password
      return url.toString()
    } catch {
      console.error("[db] DATABASE_URL inválido: não foi possível montar o endereço da aplicação")
      return null
    }
  }

  if (nonEmpty(env.VERCEL) !== undefined) return null
  return base ?? null
}

/** Banco da aplicação, ou `null` se não houver endereço (ver `resolveDatabaseUrl`). */
export function getDb(): GatewayDb | null {
  const url = resolveDatabaseUrl()
  if (url === null) return null
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
