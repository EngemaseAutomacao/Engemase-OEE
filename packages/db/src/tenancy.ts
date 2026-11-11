/**
 * Isolamento por cliente (docs/15, seção 4): contexto da transação, papéis do banco e lista das
 * tabelas de cliente.
 *
 * Regra de ouro: toda consulta a tabela de cliente roda DENTRO de uma transação que começou com
 * `app.set_tenant(<organization_id>)` (que faz `set_config('app.org_id', ..., true)`). Fora disso,
 * a RLS devolve zero linhas e bloqueia escritas ("fail-closed").
 * Exige driver com transação interativa (`pg` com pool ou driver serverless da Neon via WebSocket);
 * o driver HTTP da Neon não serve.
 */
import { getTableColumns, getTableName, is, type SQL, sql } from "drizzle-orm"
import { PgTable } from "drizzle-orm/pg-core"
import * as schema from "./schema/index"

/** Papéis do banco criados pela migração 0001_rls.sql (todos NOLOGIN e sem BYPASSRLS). */
export const DB_ROLES = {
  /** Papel da aplicação: tabelas de cliente com RLS forçada por `organization_id`. */
  app: "app_user",
  /** Papel do Better Auth: só as tabelas de identidade (user, session, account, verification, organization, member). */
  auth: "auth_service",
  /** Dono das funções de busca por hash de token (SECURITY DEFINER); ninguém usa diretamente. */
  lookup: "app_lookup",
} as const
export type DbRole = (typeof DB_ROLES)[keyof typeof DB_ROLES]

/** Nome da configuração de sessão com o cliente da transação. */
export const TENANT_SETTING = "app.org_id"

/** Nome da coluna que marca uma tabela de cliente. */
export const TENANT_COLUMN = "organization_id"

const schemaExports: readonly unknown[] = Object.values(schema)

/** Todas as tabelas declaradas no schema. */
export const ALL_TABLES: readonly PgTable[] = schemaExports.filter((value): value is PgTable => is(value, PgTable))

/** Tabelas do schema que têm `organization_id` (todas devem ter RLS forçada). */
export const TENANT_TABLES: readonly PgTable[] = ALL_TABLES.filter((table) =>
  Object.values(getTableColumns(table)).some((column) => column.name === TENANT_COLUMN),
)

/** Nomes das tabelas de cliente, em ordem alfabética. */
export const TENANT_TABLE_NAMES: readonly string[] = TENANT_TABLES.map((table) => getTableName(table)).sort()

/** Única tabela de cliente em que `organization_id` pode ser nulo (eventos de plataforma). */
export const NULLABLE_TENANT_TABLES: readonly string[] = ["audit_log"]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Erro de uso do contexto de cliente (mensagem em português, para logs). */
export class TenantContextError extends Error {
  override readonly name = "TenantContextError"
}

function assertOrganizationId(organizationId: string): void {
  if (!UUID_RE.test(organizationId)) {
    throw new TenantContextError(`organization_id inválido: "${organizationId}" (esperado um UUID).`)
  }
}

/** SQL que define o cliente da transação atual (`app.set_tenant`). */
export function setTenantSql(organizationId: string): SQL {
  assertOrganizationId(organizationId)
  return sql`SELECT app.set_tenant(${organizationId}::uuid)`
}

/** O mínimo que precisamos de uma transação do Drizzle. */
export interface SqlExecutor {
  execute(query: SQL): PromiseLike<unknown>
}

/** O mínimo que precisamos de um banco do Drizzle (`PgDatabase`). */
export interface TransactionalDb<TTx extends SqlExecutor> {
  transaction<T>(fn: (tx: TTx) => Promise<T>): Promise<T>
}

export interface WithTenantOptions {
  /**
   * Papel assumido dentro da transação (`SET LOCAL ROLE`). Padrão: `app_user`.
   *
   * Defesa em profundidade: mesmo que a aplicação conecte por engano com um usuário de mais
   * poderes (ex.: o dono das tabelas), a transação roda como `app_user` — ou falha alto, se o
   * usuário da conexão não for membro de `app_user`. Use `null` para não trocar de papel.
   */
  readonly role?: DbRole | null
}

/**
 * Executa `fn` numa transação com o cliente definido. Tudo o que `fn` fizer com `tx` fica
 * restrito às linhas do cliente pela RLS.
 *
 * ```ts
 * const machines = await withTenant(db, ctx.organizationId, (tx) => tx.select().from(machine))
 * ```
 */
export async function withTenant<TTx extends SqlExecutor, T>(
  db: TransactionalDb<TTx>,
  organizationId: string,
  fn: (tx: TTx) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> {
  assertOrganizationId(organizationId)
  const role = options.role === undefined ? DB_ROLES.app : options.role
  if (role !== null && !Object.values(DB_ROLES).includes(role)) {
    throw new TenantContextError(`papel desconhecido: "${String(role)}"`)
  }
  return db.transaction(async (tx) => {
    // O nome do papel vem de uma lista fechada (DB_ROLES), então pode ir direto no SQL.
    if (role !== null) await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`))
    await tx.execute(setTenantSql(organizationId))
    return fn(tx)
  })
}
