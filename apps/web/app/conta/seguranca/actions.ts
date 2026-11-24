"use server"

/**
 * Cadastro do 2FA (D14; L20): TOTP no aplicativo autenticador + 10 códigos de recuperação.
 * Toda ação confere a sessão de novo no servidor e pede a senha atual para começar.
 */
import { headers } from "next/headers"
import { isAPIError } from "better-auth/api"
import { z } from "zod"
import { getAuth } from "@/lib/server/auth"
import { getCurrentSession } from "@/lib/server/auth/current"

export type StartSetupResult =
  | { readonly status: "ok"; readonly totpURI: string; readonly secret: string; readonly backupCodes: readonly string[] }
  | { readonly status: "error"; readonly message: string }

export type ConfirmSetupResult = { readonly status: "ok" } | { readonly status: "error"; readonly message: string }

const StartInput = z.object({ password: z.string().min(1, "Informe sua senha atual.").max(512) })
const ConfirmInput = z.object({ code: z.string().trim().regex(/^\d{6}$/, "O código tem 6 dígitos.") })

const NO_SESSION = { status: "error", message: "Sua sessão terminou. Entre de novo." } as const

export async function startTwoFactorSetupAction(input: unknown): Promise<StartSetupResult> {
  const parsed = StartInput.safeParse(input)
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Confira os dados." }
  const auth = getAuth()
  const session = await getCurrentSession()
  if (auth === null || session === null) return NO_SESSION
  try {
    const result = await auth.api.enableTwoFactor({
      body: { password: parsed.data.password, method: "totp" },
      headers: await headers(),
    })
    if (result.method !== "totp") return { status: "error", message: "Método de verificação inesperado." }
    const secret = new URL(result.totpURI).searchParams.get("secret") ?? ""
    return { status: "ok", totpURI: result.totpURI, secret, backupCodes: result.backupCodes }
  } catch (error) {
    if (isAPIError(error) && (error.statusCode === 400 || error.statusCode === 401)) {
      return { status: "error", message: "Senha incorreta." }
    }
    console.error("[2fa] falha ao iniciar o cadastro", error)
    return { status: "error", message: "Não foi possível iniciar a verificação em duas etapas. Tente de novo." }
  }
}

export async function confirmTwoFactorSetupAction(input: unknown): Promise<ConfirmSetupResult> {
  const parsed = ConfirmInput.safeParse(input)
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Informe o código." }
  const auth = getAuth()
  const session = await getCurrentSession()
  if (auth === null || session === null) return NO_SESSION
  try {
    await auth.api.verifyTOTP({ body: { code: parsed.data.code }, headers: await headers() })
    return { status: "ok" }
  } catch (error) {
    if (isAPIError(error) && error.statusCode === 401) {
      return { status: "error", message: "Código inválido. Confira o horário do celular e tente de novo." }
    }
    console.error("[2fa] falha ao confirmar o cadastro", error)
    return { status: "error", message: "Não foi possível confirmar o código. Tente de novo." }
  }
}
