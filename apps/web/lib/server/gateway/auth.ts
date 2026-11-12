/**
 * Autenticação do gateway (docs/04, "Autenticação"; docs/08): `Authorization: Bearer gw_live_...`.
 *
 * O token tem 256 bits aleatórios e o banco guarda só o SHA-256 (`gateway.token_hash`). A busca pelo
 * hash acontece ANTES de se saber o cliente, pela função SECURITY DEFINER `app.resolve_gateway_token`
 * (@engemase/db, `resolveByTokenHash`), que devolve apenas (id, organization_id) de gateway ativo —
 * aceitando o token anterior durante a rotação. Daí em diante tudo roda com `withTenant()`.
 */
import { randomBytes } from "node:crypto"
import { GatewayTokenSchema } from "@engemase/contracts"
import { resolveByTokenHash, sha256Hex } from "@engemase/db"
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

/** Autentica pelo cabeçalho `Authorization`; token ausente, inválido ou revogado → 401 `unauthorized`. */
export async function authenticateGateway(db: GatewayDb, authorization: string | null): Promise<GatewayPrincipal> {
  const token = parseBearerToken(authorization)
  if (token === null) throw new GatewayApiError("unauthorized")
  // Gateway revogado ou excluído não aparece na busca: não dá para distinguir de token errado sem
  // ler a linha do gateway, e sem cliente definido a RLS não deixa. Os dois casos dão 401.
  const ref = await resolveByTokenHash(rowsExecutor(db), "gatewayToken", hashGatewayToken(token))
  if (ref === null) throw new GatewayApiError("unauthorized")
  return { gatewayId: ref.id, organizationId: ref.organizationId }
}
