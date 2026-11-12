/**
 * Tipos comuns da API dos gateways (/api/gateway/v1).
 *
 * A lógica não depende do Next.js nem do driver: recebe um banco do Drizzle (`pg` em produção,
 * PGlite nos testes) e devolve o resultado. Toda leitura/escrita de dados de cliente roda dentro de
 * `withTenant()` (@engemase/db): papel `app_user` + `app.org_id` do gateway autenticado, sob RLS.
 */
import type { RowsExecutor } from "@engemase/db"
import type { SQL } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"

/** Banco do Drizzle (qualquer driver Postgres com transação interativa). */
export type GatewayDb = PgDatabase<PgQueryResultHKT>

/** Transação aberta por `db.transaction()` (a que `withTenant()` entrega). */
export type GatewayTx = Parameters<Parameters<GatewayDb["transaction"]>[0]>[0]

/** Gateway autenticado pelo token (o cliente vem do banco, nunca do corpo da requisição). */
export interface GatewayPrincipal {
  readonly gatewayId: string
  readonly organizationId: string
}

/** Dados da requisição usados na auditoria. */
export interface RequestMeta {
  readonly ip?: string | null
  readonly userAgent?: string | null
}

/**
 * `execute()` com as linhas tipadas. node-postgres e PGlite devolvem `{ rows }`; o tipo genérico
 * do Drizzle (`PgQueryResultHKT`) não sabe disso, daí a conversão num lugar só.
 */
export async function queryRows<T>(executor: GatewayDb | GatewayTx, query: SQL): Promise<T[]> {
  const result = (await executor.execute(query)) as { rows?: T[] }
  return result.rows ?? []
}

/** O banco visto como `RowsExecutor` (para `resolveByTokenHash` de @engemase/db). */
export function rowsExecutor(db: GatewayDb | GatewayTx): RowsExecutor {
  return db as unknown as RowsExecutor
}
