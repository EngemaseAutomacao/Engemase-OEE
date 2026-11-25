/**
 * Tokens próprios de uso único (`account_token`, docs/15 seção 5): "definir senha" do convite e do
 * primeiro super admin. O valor só existe no link enviado à pessoa (no FRAGMENTO `#` da URL, que o
 * navegador não manda ao servidor nem põe no Referer, docs/15 item 9); o banco guarda o SHA-256.
 */
import { randomBytes } from "node:crypto"
import { sha256Hex } from "./lookups"

/** Validade do link "definir senha" do convite (72 h: dá tempo de um fim de semana). */
export const SET_PASSWORD_TOKEN_TTL_MS = 72 * 3_600_000

/** Caminho da tela "definir senha" (o token vai no fragmento: `/definir-senha#t=<token>`). */
export const SET_PASSWORD_PATH = "/definir-senha"

/** Formato do token no link: 32 bytes aleatórios em base64url (43 caracteres). */
export const ACCOUNT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export interface NewAccountToken {
  /** Valor que vai no link (nunca gravado nem registrado em log). */
  readonly token: string
  /** SHA-256 hexadecimal (coluna `account_token.token_hash`). */
  readonly hash: string
}

/** Gera um token novo (256 bits). */
export function newAccountToken(): NewAccountToken {
  const token = randomBytes(32).toString("base64url")
  return { token, hash: sha256Hex(token) }
}

/** Link "definir senha" no endereço canônico (`BETTER_AUTH_URL`), com o token no fragmento. */
export function setPasswordUrl(baseURL: string, token: string): string {
  return `${new URL(baseURL).origin}${SET_PASSWORD_PATH}#t=${token}`
}
