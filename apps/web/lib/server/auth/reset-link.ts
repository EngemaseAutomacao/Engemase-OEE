/** Link e validade da redefinição de senha ("esqueci minha senha"). Sem dependências: usado também pelas telas. */

/** Tela que recebe o link (o token vai no fragmento: `/redefinir-senha#t=<token>`). */
export const RESET_PASSWORD_PATH = "/redefinir-senha"

/** Validade do link de redefinição: 30 minutos. */
export const RESET_PASSWORD_TTL_MS = 30 * 60_000

/** Formato do token de redefinição do Better Auth (24 caracteres alfanuméricos). */
export const RESET_TOKEN_PATTERN = /^[A-Za-z0-9]{24}$/
