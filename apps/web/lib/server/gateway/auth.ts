/**
 * Autenticação do gateway (docs/04, "Autenticação"; docs/08): `Authorization: Bearer gw_live_...`.
 *
 * O token tem 256 bits aleatórios e o banco guarda só o SHA-256 (`gateway.token_hash`). A busca pelo
 * hash acontece ANTES de se saber o cliente, pela função SECURITY DEFINER
 * `app.resolve_gateway_token_state` (@engemase/db, `resolveGatewayTokenState`), que devolve o gateway,
 * o cliente e o ESTADO do token — aceitando o token anterior durante a rotação. Daí em diante tudo
 * roda com `withTenant()`.
 *
 * - ausente, malformado ou desconhecido → 401 `unauthorized`;
 * - `revoked` (gateway revogado ou excluído; token atual ou anterior) → 401 `token_revoked`;
 * - `pending_enrollment` ou `rotated` (token anterior fora da janela da rotação) → 401 `unauthorized`;
 * - `active` ou `previous` (token anterior dentro da janela de 10 min) → autenticado.
 *
 * Os ids que a busca devolve nos estados recusados nunca vão na resposta de erro.
 *
 * A autenticação acontece ANTES de ler o corpo; até a transação começar, uma reativação (token novo)
 * ou o fim da janela da rotação podem invalidar o token. Por isso o principal leva o hash do token e
 * o /sync e o /config recalculam o estado dentro da transação (`tokenStateInTx` +
 * `assertTokenStillValid`), na mesma consulta que lê (e, no /sync, trava) a linha do gateway.
 */
import { randomBytes } from "node:crypto"
import { GatewayTokenSchema } from "@engemase/contracts"
import { gateway, type GatewayTokenState, resolveGatewayTokenState, sha256Hex } from "@engemase/db"
import { type SQL, sql } from "drizzle-orm"
import { GatewayApiError } from "./errors"
import { type GatewayDb, type GatewayPrincipal, rowsExecutor } from "./types"

/** Prefixo dos tokens emitidos (o contrato também aceita `gw_test_`). */
export const GATEWAY_TOKEN_PREFIX = "gw_live_"

/** Gera um token novo: prefixo + 256 bits aleatórios em base64url (43 caracteres). */
export function generateGatewayToken(): string {
  return `${GATEWAY_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`
}

/** Hash guardado no banco (SHA-256 hexadecimal, o mesmo de `@engemase/db`). */
export function hashGatewayToken(token: string): string {
  return sha256Hex(token)
}

/**
 * Extrai o token do cabeçalho `Authorization`. Devolve `null` se faltar, se o esquema não for Bearer
 * ou se o token não tiver o formato do contrato (rejeitado sem ir ao banco).
 */
export function parseBearerToken(authorization: string | null): string | null {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(authorization ?? "")
  const token = match?.[1]
  if (token === undefined || !GatewayTokenSchema.safeParse(token).success) return null
  return token
}

/** Erro do contrato para um token que não autentica (ver a lista no início do arquivo). */
function rejectedTokenError(state: Exclude<GatewayTokenState, "active" | "previous">): GatewayApiError {
  switch (state) {
    case "revoked":
      return new GatewayApiError("token_revoked")
    case "pending_enrollment":
    case "rotated":
      return new GatewayApiError("unauthorized")
  }
}

/** Lança o erro do contrato se o estado não autentica (`null` = token desconhecido). */
function assertAuthenticates(state: GatewayTokenState | null): void {
  if (state === null) throw new GatewayApiError("unauthorized")
  if (state !== "active" && state !== "previous") throw rejectedTokenError(state)
}

/**
 * Autentica pelo cabeçalho `Authorization`. Token ausente, malformado ou desconhecido → 401
 * `unauthorized`; gateway revogado ou excluído → 401 `token_revoked` (o agente para de enviar).
 */
export async function authenticateGateway(db: GatewayDb, authorization: string | null): Promise<GatewayPrincipal> {
  const token = parseBearerToken(authorization)
  if (token === null) throw new GatewayApiError("unauthorized")
  const tokenHash = hashGatewayToken(token)
  const ref = await resolveGatewayTokenState(rowsExecutor(db), tokenHash)
  if (ref === null) throw new GatewayApiError("unauthorized")
  assertAuthenticates(ref.state)
  return { gatewayId: ref.id, organizationId: ref.organizationId, tokenHash }
}

/**
 * Estado do token da requisição calculado na própria linha do gateway, para usar DENTRO da
 * transação do cliente como coluna do `select` que lê (no /sync, trava com `FOR UPDATE`) o gateway.
 *
 * É o mesmo CASE de `app.resolve_gateway_token_state` (migração 0003 de @engemase/db), sobre as
 * colunas da linha lida — e não uma nova busca, que no `FOR UPDATE` poderia enxergar a versão
 * anterior a uma reativação que acabou de gravar. `NULL` = o hash não confere mais nem com o token
 * atual nem com o anterior (reativação trocou o token). O teste "estado do token dentro da
 * transação" (test/gateway/http.test.ts) confere que os dois dão o mesmo resultado em cada estado.
 */
export function tokenStateInTx(tokenHash: string): SQL<GatewayTokenState | null> {
  return sql<GatewayTokenState | null>`CASE
    WHEN ${gateway.tokenHash} IS DISTINCT FROM ${tokenHash}
      AND ${gateway.previousTokenHash} IS DISTINCT FROM ${tokenHash} THEN NULL
    WHEN ${gateway.status} = 'revoked' OR ${gateway.deletedAt} IS NOT NULL THEN 'revoked'
    WHEN ${gateway.status} <> 'active' THEN 'pending_enrollment'
    WHEN ${gateway.tokenHash} = ${tokenHash} THEN 'active'
    WHEN ${gateway.previousTokenExpiresAt} > now() THEN 'previous'
    ELSE 'rotated'
  END`
}

/**
 * Confere, já dentro da transação do cliente, se o token que autenticou a requisição ainda vale
 * (`tokenState` vem de `tokenStateInTx`), com os mesmos erros da autenticação: revogado ou excluído
 * → `token_revoked`; token trocado (reativação), anterior fora da janela, aguardando nova ativação
 * ou gateway sumido → `unauthorized`.
 */
export function assertTokenStillValid<T extends { readonly tokenState: GatewayTokenState | null }>(
  row: T | undefined,
): asserts row is T {
  assertAuthenticates(row?.tokenState ?? null)
}
