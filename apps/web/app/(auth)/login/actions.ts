"use server"

/**
 * Server Actions do login (W5). Validam a entrada (zod), chamam o Better Auth NO SERVIDOR
 * (`auth.api.*`, com os cookies do pedido; o plugin nextCookies grava os cookies da resposta) e
 * devolvem um resultado simples para a tela. Mensagens em português, sem revelar se o e-mail existe.
 *
 * Sem `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`/banco:
 * - com `AUTH_ENFORCED` desligado (padrão no `next dev`): modo demonstração, segue para /inicio como
 *   o protótipo fazia;
 * - com `AUTH_ENFORCED` ligado: "login indisponível".
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { isAPIError } from "better-auth/api"
import { z } from "zod"
import { getAuth } from "@/lib/server/auth"
import { AUTH_ERROR } from "@/lib/server/auth/auth"
import { authEnforced } from "@/lib/server/auth/env"
import { landingPath, safeNextPath } from "@/lib/server/auth/landing"
import { PASSWORD_MAX_LENGTH } from "@/lib/server/auth/password"
import { getAuthDb, getDb } from "@/lib/server/db"

export type SignInResult =
  | { readonly status: "ok"; readonly redirectTo: string }
  | { readonly status: "two_factor" }
  | { readonly status: "demo"; readonly redirectTo: string }
  | { readonly status: "error"; readonly message: string; readonly field?: "email" | "password" | "code" }

const SignInInput = z.object({
  email: z.string().trim().min(1, "Informe seu e-mail.").max(254).pipe(z.email("E-mail inválido. Confira se digitou corretamente.")),
  password: z.string().min(1, "Informe sua senha.").max(PASSWORD_MAX_LENGTH * 4),
  remember: z.boolean(),
  next: z.string().max(512).optional(),
})

const TwoFactorInput = z.object({
  method: z.enum(["totp", "backup"]),
  code: z.string().trim().min(1, "Informe o código.").max(32),
  next: z.string().max(512).optional(),
})

const UNAVAILABLE: SignInResult = {
  status: "error",
  message: "Login indisponível no momento. Fale com o suporte Engemase.",
}

function apiErrorCode(error: unknown): string | undefined {
  if (!isAPIError(error)) return undefined
  return (error.body as { code?: string } | undefined)?.code
}

async function destination(user: { id: string; role?: unknown }, next: string | undefined): Promise<string> {
  const safe = safeNextPath(next)
  if (safe !== null) return safe
  const db = getAuthDb()
  if (db === null) return "/inicio"
  return landingPath(db, { id: user.id, role: typeof user.role === "string" ? user.role : null }, getDb())
}

export async function signInAction(input: unknown): Promise<SignInResult> {
  const parsed = SignInInput.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path[0] === "password" ? "password" : "email"
    return { status: "error", message: issue?.message ?? "Confira os dados.", field }
  }
  const auth = getAuth()
  if (auth === null) {
    return authEnforced() ? UNAVAILABLE : { status: "demo", redirectTo: "/inicio" }
  }
  const { email, password, remember, next } = parsed.data
  try {
    const result = await auth.api.signInEmail({
      body: { email, password, rememberMe: remember },
      headers: await headers(),
    })
    if ("twoFactorRedirect" in result && result.twoFactorRedirect) return { status: "two_factor" }
    if (!("user" in result)) return UNAVAILABLE
    return { status: "ok", redirectTo: await destination(result.user, next) }
  } catch (error) {
    if (isAPIError(error)) {
      if (apiErrorCode(error) === AUTH_ERROR.accountLocked) {
        return { status: "error", message: "Muitas tentativas com senha errada. Espere 15 minutos e tente de novo." }
      }
      if (error.statusCode === 401) return { status: "error", message: "E-mail ou senha incorretos.", field: "password" }
      if (error.statusCode === 429) return { status: "error", message: "Muitas tentativas. Aguarde um pouco e tente de novo." }
    }
    console.error("[login] falha inesperada no login", error)
    return { status: "error", message: "Não foi possível entrar. Tente de novo ou fale com o administrador da sua empresa." }
  }
}

export async function verifyTwoFactorAction(input: unknown): Promise<SignInResult> {
  const parsed = TwoFactorInput.safeParse(input)
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Informe o código.", field: "code" }
  const auth = getAuth()
  if (auth === null) return UNAVAILABLE
  const { method, code, next } = parsed.data
  try {
    const requestHeaders = await headers()
    const result =
      method === "totp"
        ? await auth.api.verifyTOTP({ body: { code: code.replace(/\s/g, "") }, headers: requestHeaders })
        : await auth.api.verifyBackupCode({ body: { code }, headers: requestHeaders })
    return { status: "ok", redirectTo: await destination(result.user, next) }
  } catch (error) {
    if (isAPIError(error)) {
      const errorCode = apiErrorCode(error)
      if (errorCode === "INVALID_TWO_FACTOR_COOKIE") {
        return { status: "error", message: "O tempo para digitar o código acabou. Entre de novo com e-mail e senha." }
      }
      if (error.statusCode === 401) return { status: "error", message: "Código inválido. Confira e tente de novo.", field: "code" }
      if (error.statusCode === 400 || error.statusCode === 429 || error.statusCode === 423) {
        return { status: "error", message: "Muitas tentativas com código errado. Espere 15 minutos e entre de novo." }
      }
    }
    console.error("[login] falha inesperada na verificação em duas etapas", error)
    return { status: "error", message: "Não foi possível confirmar o código. Tente de novo." }
  }
}

/** Sai (apaga a sessão no banco e os cookies) e volta para o login. */
export async function signOutAction(): Promise<void> {
  const auth = getAuth()
  if (auth !== null) {
    try {
      await auth.api.signOut({ headers: await headers() })
    } catch (error) {
      console.error("[login] falha ao sair", error)
    }
  }
  redirect("/login")
}
