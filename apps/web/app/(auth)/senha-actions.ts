"use server"

/**
 * Server Actions das telas públicas de senha: "definir senha" (link do convite, token próprio de uso único),
 * "esqueci minha senha" (pedido) e "redefinir senha" (link do e-mail). Validam a entrada (zod), limitam as
 * tentativas por IP e por e-mail e nunca dizem se um e-mail tem conta. Mensagens em português.
 */
import { headers } from "next/headers"
import { z } from "zod"
import type { NewPasswordResult } from "@/components/account/new-password-form"
import { getAuth } from "@/lib/server/auth"
import { authEnforced } from "@/lib/server/auth/env"
import { attemptKey, takeAttempt, TOKEN_SUBMIT_PER_IP } from "@/lib/server/auth/attempts"
import { PASSWORD_MAX_LENGTH } from "@/lib/server/auth/password"
import { requestPasswordReset, resetPassword } from "@/lib/server/auth/password-reset"
import { requestIp } from "@/lib/server/auth/request-ip"
import { setPasswordWithToken } from "@/lib/server/auth/set-password"
import { getAuthDb, getDb } from "@/lib/server/db"

const UNAVAILABLE: NewPasswordResult = {
  status: "error",
  message: "Serviço indisponível no momento. Tente de novo mais tarde ou fale com o suporte Engemase.",
}

const TokenInput = z.object({
  token: z.string().max(200),
  password: z.string().max(PASSWORD_MAX_LENGTH * 4),
})

function throttledMessage(retryAt: Date | null): string {
  if (retryAt === null) return "Muitas tentativas. Aguarde alguns minutos e tente de novo."
  const at = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(retryAt)
  return `Muitas tentativas. Tente de novo depois das ${at}.`
}

const INVALID_TOKEN: NewPasswordResult = { status: "error", field: "token", message: "Link inválido ou vencido." }

export async function setPasswordAction(input: unknown): Promise<NewPasswordResult> {
  const parsed = TokenInput.safeParse(input)
  if (!parsed.success) return INVALID_TOKEN
  const auth = getAuth()
  const authDb = getAuthDb()
  const db = getDb()
  if (auth === null || authDb === null || db === null) return UNAVAILABLE
  const now = new Date()
  const ip = requestIp(await headers())
  try {
    const attempt = await takeAttempt(authDb, attemptKey("token-ip", ip ?? "sem-ip"), TOKEN_SUBMIT_PER_IP, now)
    if (!attempt.allowed) return { status: "error", message: throttledMessage(attempt.retryAt) }
    const result = await setPasswordWithToken({ db, authDb, auth, now }, parsed.data)
    if (result.status === "ok") return { status: "ok" }
    if (result.status === "password_rejected") return { status: "error", field: "password", message: result.message }
    return INVALID_TOKEN
  } catch (error) {
    console.error("[definir-senha] falha inesperada", error)
    return { status: "error", message: "Não foi possível salvar a senha. Tente de novo." }
  }
}

export async function resetPasswordAction(input: unknown): Promise<NewPasswordResult> {
  const parsed = TokenInput.safeParse(input)
  if (!parsed.success) return INVALID_TOKEN
  const auth = getAuth()
  const authDb = getAuthDb()
  if (auth === null || authDb === null) return UNAVAILABLE
  try {
    const result = await resetPassword({ auth, authDb, now: new Date(), ip: requestIp(await headers()) }, parsed.data)
    if (result.status === "ok") return { status: "ok" }
    if (result.status === "password_rejected") return { status: "error", field: "password", message: result.message }
    if (result.status === "throttled") return { status: "error", message: throttledMessage(result.retryAt) }
    return INVALID_TOKEN
  } catch (error) {
    console.error("[redefinir-senha] falha inesperada", error)
    return { status: "error", message: "Não foi possível salvar a senha. Tente de novo." }
  }
}

export type ForgotPasswordResult =
  | { readonly status: "ok" }
  /** Login não configurado e `AUTH_ENFORCED` desligado: protótipo, nada é enviado. */
  | { readonly status: "demo" }
  | { readonly status: "error"; readonly message: string }

const ForgotInput = z.object({
  email: z.string().trim().min(1, "Informe o e-mail cadastrado na plataforma.").max(254).pipe(z.email("Informe o e-mail cadastrado na plataforma.")),
})

/** "Esqueci minha senha": resposta igual exista ou não a conta. */
export async function requestPasswordResetAction(input: unknown): Promise<ForgotPasswordResult> {
  const parsed = ForgotInput.safeParse(input)
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Informe o e-mail." }
  const auth = getAuth()
  const authDb = getAuthDb()
  if (auth === null || authDb === null) {
    if (!authEnforced()) return { status: "demo" }
    return { status: "error", message: "Redefinição de senha indisponível no momento. Fale com o administrador da sua empresa." }
  }
  try {
    const result = await requestPasswordReset(
      { auth, authDb, now: new Date(), ip: requestIp(await headers()) },
      parsed.data.email,
    )
    if (result.status === "throttled") return { status: "error", message: throttledMessage(result.retryAt) }
    return { status: "ok" }
  } catch (error) {
    console.error("[esqueci-senha] falha inesperada", error)
    return { status: "error", message: "Não foi possível fazer o pedido agora. Tente de novo." }
  }
}
