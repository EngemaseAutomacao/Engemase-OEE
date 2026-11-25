/**
 * "Esqueci minha senha" (docs/15, seção 5 e itens 2, 9 e 15), chamado só pelas Server Actions (as rotas
 * `/api/auth/request-password-reset` e `/reset-password` continuam FECHADAS, `routes.ts`).
 *
 * Pedido (`requestPasswordReset`):
 * - limite por IP (10/h) e por e-mail (3/h, exista a conta ou não);
 * - resposta igual para e-mail que existe e que não existe; o envio do e-mail vai para depois da resposta
 *   (o app passa `after`), então o tempo da resposta também não revela nada;
 * - o link vai no endereço canônico, com o token no fragmento, vale 30 min (`auth.ts`).
 *
 * Redefinição (`resetPassword`): limite por IP (20 envios/15 min), política da senha nova (hook do
 * `auth.ts`), token de uso único; derruba todas as sessões e o bloqueio por senhas erradas.
 */
import { isAPIError } from "better-auth/api"
import type { Auth } from "./auth"
import { AUTH_ERROR } from "./auth"
import { attemptKey, RESET_REQUEST_PER_EMAIL, RESET_REQUEST_PER_IP, takeAttempt, TOKEN_SUBMIT_PER_IP } from "./attempts"
import { RESET_TOKEN_PATTERN } from "./reset-link"
import type { ThrottleDb } from "./throttle"

export interface PasswordResetDeps {
  readonly auth: Auth
  /** Banco do login (contagem das tentativas). */
  readonly authDb: ThrottleDb
  readonly now: Date
  /** IP de quem pede (para o limite). Sem IP, todos caem na mesma contagem. */
  readonly ip: string | null
}

export type RequestResetResult = { readonly status: "ok" } | { readonly status: "throttled"; readonly retryAt: Date | null }

export async function requestPasswordReset(deps: PasswordResetDeps, email: string): Promise<RequestResetResult> {
  const normalized = email.trim().toLowerCase()
  const byIp = await takeAttempt(deps.authDb, attemptKey("reset-ip", deps.ip ?? "sem-ip"), RESET_REQUEST_PER_IP, deps.now)
  if (!byIp.allowed) return { status: "throttled", retryAt: byIp.retryAt }
  const byEmail = await takeAttempt(deps.authDb, attemptKey("reset-email", normalized), RESET_REQUEST_PER_EMAIL, deps.now)
  if (!byEmail.allowed) return { status: "throttled", retryAt: byEmail.retryAt }
  try {
    await deps.auth.api.requestPasswordReset({ body: { email: normalized } })
  } catch (error) {
    // Nunca muda a resposta (não revela nada); só registra.
    console.error("[senha] falha ao gerar o pedido de redefinição", error)
  }
  return { status: "ok" }
}

export type ResetPasswordResult =
  | { readonly status: "ok" }
  | { readonly status: "invalid_token" }
  | { readonly status: "password_rejected"; readonly message: string }
  | { readonly status: "throttled"; readonly retryAt: Date | null }

export async function resetPassword(
  deps: PasswordResetDeps,
  input: { readonly token: string; readonly password: string },
): Promise<ResetPasswordResult> {
  const byIp = await takeAttempt(deps.authDb, attemptKey("token-ip", deps.ip ?? "sem-ip"), TOKEN_SUBMIT_PER_IP, deps.now)
  if (!byIp.allowed) return { status: "throttled", retryAt: byIp.retryAt }
  if (!RESET_TOKEN_PATTERN.test(input.token)) return { status: "invalid_token" }
  try {
    await deps.auth.api.resetPassword({ body: { token: input.token, newPassword: input.password } })
    return { status: "ok" }
  } catch (error) {
    if (isAPIError(error)) {
      const body = error.body as { code?: string; message?: string } | undefined
      if (body?.code === AUTH_ERROR.passwordRejected) return { status: "password_rejected", message: body.message ?? "Senha recusada." }
      if (body?.code === "PASSWORD_TOO_SHORT" || body?.code === "PASSWORD_TOO_LONG") {
        return { status: "password_rejected", message: "A senha precisa ter de 12 a 128 caracteres." }
      }
      if (error.statusCode === 400) return { status: "invalid_token" }
    }
    throw error
  }
}
