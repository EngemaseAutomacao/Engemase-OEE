/**
 * Buscas por hash de token ANTES de se saber o cliente (docs/04 e docs/15):
 * autenticação do gateway, código de ativação, token de terminal e tokens próprios de uso único.
 *
 * Com a RLS, o papel `app_user` não enxerga nenhuma linha sem `app.org_id`. Estas funções do banco
 * (SECURITY DEFINER, donas: papel `app_lookup`) devolvem só (id, organization_id) do registro cujo
 * hash confere; com isso a aplicação define o cliente e segue com `withTenant()`.
 */
import { createHash } from "node:crypto"
import { type SQL, sql } from "drizzle-orm"

/** SHA-256 em hexadecimal minúsculo (formato de todas as colunas `*_hash`). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

/** Resultado de uma busca: o registro e o cliente dele. */
export interface TenantRef {
  readonly id: string
  readonly organizationId: string
}

/** Funções de busca existentes no schema `app`. */
export const LOOKUP_FUNCTIONS = {
  /** Token `gw_live_...` do gateway (aceita o token anterior durante a rotação). */
  gatewayToken: "app.resolve_gateway_token",
  /** Código de ativação ainda válido (não usado e não vencido). */
  gatewayEnrollment: "app.resolve_gateway_enrollment",
  /** Token de dispositivo de terminal pareado, não revogado e dentro do prazo. */
  terminalToken: "app.resolve_terminal_token",
  /** Token próprio de uso único ainda válido (definir senha, verificar e-mail, pareamento). */
  accountToken: "app.resolve_account_token",
} as const
export type LookupKind = keyof typeof LOOKUP_FUNCTIONS

/** SQL da busca: devolve 0 ou 1 linha com as colunas `id` e `organization_id`. */
export function lookupSql(kind: LookupKind, tokenHash: string): SQL {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) {
    throw new Error("hash de token inválido: esperado SHA-256 em hexadecimal minúsculo (64 caracteres)")
  }
  return sql`SELECT id, organization_id FROM ${sql.raw(LOOKUP_FUNCTIONS[kind])}(${tokenHash})`
}

/** Banco/transação cujo `execute` devolve `{ rows }` (node-postgres, Neon serverless e PGlite). */
export interface RowsExecutor {
  execute(query: SQL): PromiseLike<{ rows: readonly unknown[] }>
}

function toTenantRef(row: unknown): TenantRef | null {
  if (typeof row !== "object" || row === null) return null
  const { id, organization_id: organizationId } = row as Record<string, unknown>
  return typeof id === "string" && typeof organizationId === "string" ? { id, organizationId } : null
}

/** Executa a busca e devolve o registro encontrado (ou `null`). */
export async function resolveByTokenHash(
  db: RowsExecutor,
  kind: LookupKind,
  tokenHash: string,
): Promise<TenantRef | null> {
  const result = await db.execute(lookupSql(kind, tokenHash))
  return toTenantRef(result.rows[0])
}
