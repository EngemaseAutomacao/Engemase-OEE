"use server"

/**
 * Server Actions da gestão de usuários do cliente (D12): convidar, reenviar convite, alterar papel e escopo,
 * desativar/reativar, pedir a redefinição de senha e reiniciar a verificação em duas etapas de outra pessoa.
 * Cada uma confere de novo, no servidor, a sessão, o cliente da URL e a permissão `users.manage`
 * (`requirePermission`; sem acesso → 404) e só então chama a regra em `lib/server/users` (que valida a
 * entrada, aplica a RLS e audita). Usadas pela tela `config/usuarios` (`components/settings/users-manager.tsx`).
 */
import { z } from "zod"
import { requirePermission } from "@/lib/server/access/require-tenant"
import { getAuth } from "@/lib/server/auth"
import { authSettings } from "@/lib/server/auth/env"
import { requestPasswordReset } from "@/lib/server/auth/password-reset"
import { getAuthDb, getDb } from "@/lib/server/db"
import { getEmailSender } from "@/lib/server/email"
import { type InviteResult, inviteMember, type ResendResult, resendInvite, type UsersDeps } from "@/lib/server/users/invite"
import { changeMemberAccess, type ManageResult, requestMemberPasswordReset, setMemberActive } from "@/lib/server/users/manage"
import { type ResetTwoFactorResult, resetMemberTwoFactor } from "@/lib/server/users/two-factor-reset"

type Unavailable = { readonly status: "error"; readonly code: "unavailable"; readonly message: string }

const UNAVAILABLE: Unavailable = {
  status: "error",
  code: "unavailable",
  message: "Gestão de usuários indisponível no momento. Fale com o suporte Engemase.",
}

const Slug = z.string().min(1).max(63)

function deps(): UsersDeps | null {
  const settings = authSettings()
  const db = getDb()
  const authDb = getAuthDb()
  if (settings === null || db === null || authDb === null) return null
  return { db, authDb, now: new Date(), baseURL: settings.baseURL, sendEmail: getEmailSender() }
}

async function run<T>(slug: unknown, fn: (d: UsersDeps, ctx: Awaited<ReturnType<typeof requirePermission>>) => Promise<T>): Promise<T | Unavailable> {
  const parsed = Slug.safeParse(slug)
  // Slug estranho: mesmo efeito de cliente inexistente (404 dentro de requirePermission).
  const ctx = await requirePermission(parsed.success ? parsed.data : "-", "users.manage")
  const d = deps()
  if (d === null) return UNAVAILABLE
  return fn(d, ctx)
}

export async function inviteUserAction(slug: unknown, input: unknown): Promise<InviteResult | Unavailable> {
  return run(slug, (d, ctx) => inviteMember(d, ctx, input))
}

export async function resendInviteAction(slug: unknown, memberId: unknown): Promise<ResendResult | Unavailable> {
  return run(slug, (d, ctx) => resendInvite(d, ctx, typeof memberId === "string" ? memberId : ""))
}

export async function resetTwoFactorAction(slug: unknown, memberId: unknown): Promise<ResetTwoFactorResult | Unavailable> {
  return run(slug, (d, ctx) => resetMemberTwoFactor(d, ctx, typeof memberId === "string" ? memberId : ""))
}

export async function changeAccessAction(slug: unknown, input: unknown): Promise<ManageResult | Unavailable> {
  return run(slug, (d, ctx) => changeMemberAccess(d, ctx, input))
}

export async function setActiveAction(slug: unknown, input: unknown): Promise<ManageResult | Unavailable> {
  return run(slug, (d, ctx) => setMemberActive(d, ctx, input))
}

/**
 * Manda para a pessoa o mesmo e-mail do "Esqueci minha senha" (regra e auditoria em
 * `requestMemberPasswordReset`). O limite por e-mail do pedido normal continua valendo; o "por IP" usa uma
 * chave própria de quem pede, para não gastar o limite do IP do escritório (colegas atrás do mesmo IP).
 */
export async function sendPasswordResetAction(slug: unknown, memberId: unknown): Promise<ManageResult | Unavailable> {
  return run(slug, async (d, ctx) => {
    const auth = getAuth()
    if (auth === null) return UNAVAILABLE
    const resetKey = `admin:${ctx.organizationId}:${ctx.user.id}`
    return requestMemberPasswordReset(
      { ...d, reset: (email) => requestPasswordReset({ auth, authDb: d.authDb, now: d.now, ip: resetKey }, email) },
      ctx,
      typeof memberId === "string" ? memberId : "",
    )
  })
}
