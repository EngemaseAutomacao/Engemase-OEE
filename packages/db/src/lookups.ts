/**
 * Buscas ANTES de se saber o cliente (docs/04 e docs/15): por hash de token (autenticação do
 * gateway, código de ativação, token de terminal e tokens próprios de uso único) e pelo slug da URL.
 *
 * Com a RLS, o papel `app_user` não enxerga nenhuma linha sem `app.org_id`. Estas funções do banco
 * (SECURITY DEFINER, donas: papel `app_lookup`) devolvem só (id, organization_id) do registro cujo
 * hash confere — e, nas variantes `*_state`, o estado da credencial, para a API responder o erro
 * certo do contrato; com isso a aplicação define o cliente e segue com `withTenant()`.
 */
import { createHash } from "node:crypto"
import { EnrollResponseSchema } from "@engemase/contracts"
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

function assertTokenHash(tokenHash: string): void {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) {
    throw new Error("hash de token inválido: esperado SHA-256 em hexadecimal minúsculo (64 caracteres)")
  }
}

/** SQL da busca: devolve 0 ou 1 linha com as colunas `id` e `organization_id`. */
export function lookupSql(kind: LookupKind, tokenHash: string): SQL {
  assertTokenHash(tokenHash)
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

// --- Estado da credencial (para os erros do contrato) ----------------------------------------

/**
 * Estados do código de ativação (`app.resolve_gateway_enrollment_state`), em ordem de precedência.
 * Nenhuma linha = código desconhecido. Mapeamento para o contrato (docs/04, "Erros e retentativas"):
 *
 * | estado            | resposta                         |
 * |-------------------|----------------------------------|
 * | (nenhuma linha)   | 400 `activation_code_invalid`    |
 * | `gateway_revoked` | 400 `activation_code_invalid`    |
 * | `used`            | 410 `activation_code_used`       |
 * | `expired`         | 410 `activation_code_expired`    |
 * | `valid`           | segue a ativação                 |
 */
export const GATEWAY_ENROLLMENT_STATES = ["gateway_revoked", "used", "expired", "valid"] as const
export type GatewayEnrollmentState = (typeof GATEWAY_ENROLLMENT_STATES)[number]

/**
 * Estados do token do gateway (`app.resolve_gateway_token_state`). Nenhuma linha = token desconhecido.
 *
 * | estado               | resposta                     |
 * |----------------------|------------------------------|
 * | (nenhuma linha)      | 401 `unauthorized`           |
 * | `revoked`            | 401 `token_revoked`          |
 * | `pending_enrollment` | 401 `unauthorized`           |
 * | `rotated`            | 401 `unauthorized`           |
 * | `active`, `previous` | autenticado                  |
 */
export const GATEWAY_TOKEN_STATES = ["revoked", "pending_enrollment", "active", "previous", "rotated"] as const
export type GatewayTokenState = (typeof GATEWAY_TOKEN_STATES)[number]

/** Estados de token que autenticam (o mesmo conjunto que `app.resolve_gateway_token` devolve). */
export const GATEWAY_TOKEN_VALID_STATES: readonly GatewayTokenState[] = ["active", "previous"]

/**
 * Código de ativação encontrado pelo hash, com o estado. Os ids servem para auditoria e para
 * seguir a ativação; nunca devolva-os na resposta de erro ao gateway.
 */
export interface GatewayEnrollmentLookup extends TenantRef {
  readonly gatewayId: string
  readonly state: GatewayEnrollmentState
}

/** Token de gateway encontrado pelo hash, com o estado (ids para auditoria; ver `GatewayEnrollmentLookup`). */
export interface GatewayTokenLookup extends TenantRef {
  readonly state: GatewayTokenState
}

/** SQL de `app.resolve_gateway_enrollment_state`: 0 ou 1 linha (`id`, `organization_id`, `gateway_id`, `state`). */
export function gatewayEnrollmentStateSql(codeHash: string): SQL {
  assertTokenHash(codeHash)
  return sql`SELECT id, organization_id, gateway_id, state FROM app.resolve_gateway_enrollment_state(${codeHash})`
}

/** SQL de `app.resolve_gateway_token_state`: 0 ou 1 linha (`id`, `organization_id`, `state`). */
export function gatewayTokenStateSql(tokenHash: string): SQL {
  assertTokenHash(tokenHash)
  return sql`SELECT id, organization_id, state FROM app.resolve_gateway_token_state(${tokenHash})`
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value)
}

/** Estado do código de ativação pelo hash (`null` = código desconhecido). */
export async function resolveGatewayEnrollmentState(
  db: RowsExecutor,
  codeHash: string,
): Promise<GatewayEnrollmentLookup | null> {
  const result = await db.execute(gatewayEnrollmentStateSql(codeHash))
  const row = result.rows[0]
  const ref = toTenantRef(row)
  if (ref === null) return null
  const { gateway_id: gatewayId, state } = row as Record<string, unknown>
  if (typeof gatewayId !== "string" || !isOneOf(GATEWAY_ENROLLMENT_STATES, state)) return null
  return { ...ref, gatewayId, state }
}

/** Estado do token do gateway pelo hash (`null` = token desconhecido). */
export async function resolveGatewayTokenState(
  db: RowsExecutor,
  tokenHash: string,
): Promise<GatewayTokenLookup | null> {
  const result = await db.execute(gatewayTokenStateSql(tokenHash))
  const row = result.rows[0]
  const ref = toTenantRef(row)
  if (ref === null) return null
  const { state } = row as Record<string, unknown>
  if (!isOneOf(GATEWAY_TOKEN_STATES, state)) return null
  return { ...ref, state }
}

// --- Slug da URL ------------------------------------------------------------------------------

/** Formato do slug de cliente: o do contrato (`org` na resposta do /enroll). */
const OrgSlugSchema = EnrollResponseSchema.shape.org

/** SQL de `app.resolve_org_slug`: 0 ou 1 linha com a coluna `id` (o cliente). */
export function orgSlugSql(slug: string): SQL {
  return sql`SELECT id FROM app.resolve_org_slug(${slug})`
}

/**
 * Slug da URL → id do cliente, antes de definir o cliente da transação (`null` = não existe ou
 * formato inválido, sem ir ao banco). NÃO autoriza: depois, com `withTenant()`, confira o vínculo.
 */
export async function resolveOrganizationSlug(db: RowsExecutor, slug: string): Promise<string | null> {
  if (!OrgSlugSchema.safeParse(slug).success) return null
  const result = await db.execute(orgSlugSql(slug))
  const row = result.rows[0]
  if (typeof row !== "object" || row === null) return null
  const { id } = row as Record<string, unknown>
  return typeof id === "string" ? id : null
}
