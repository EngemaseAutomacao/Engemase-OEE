"use server"

/**
 * Server Actions da gestão de usuários do cliente (D12): convidar, reenviar convite, alterar papel e escopo,
 * desativar/reativar, pedir a redefinição de senha e reiniciar a verificação em duas etapas de outra pessoa.
 * Cada uma confere de novo, no servidor, a sessão, o cliente da URL e a permissão `users.manage`
 * (`requirePermission`; sem acesso → 404) e só então chama a regra em `lib/server/users` (que valida a
 * entrada, aplica a RLS e audita). Usadas pela tela `config/usuarios` (`components/settings/users-manager.tsx`).
 */
import { headers } from "next/headers"
import { user } from "@engemase/db"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { requirePermission } from "@/lib/server/access/require-tenant"
import { getAuth } from "@/lib/server/auth"
import { authSettings } from "@/lib/server/auth/env"
import { requestPasswordReset } from "@/lib/server/auth/password-reset"
import { requestIp } from "@/lib/server/auth/request-ip"
import { getAuthDb, getDb } from "@/lib/server/db"
import { getEmailSender } from "@/lib/server/email"
import { type InviteResult, inviteMember, type ResendResult, resendInvite, type UsersDeps } from "@/lib/server/users/invite"
import { changeMemberAccess, type ManageResult, memberUserId, setMemberActive } from "@/lib/server/users/manage"
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

export type PasswordResetByAdminResult =
  | { readonly status: "ok" }
  | { readonly status: "error"; readonly code: "not_found" | "throttled"; readonly message: string }

/**
 * Manda para a pessoa o mesmo e-mail do "Esqueci minha senha" (link de 30 min; a senha atual vale até ela
 * definir outra). Só para vínculo ativo deste cliente e conta que já tem senha; os limites por IP e por
 * e-mail do pedido normal continuam valendo.
 */
export async function sendPasswordResetAction(slug: unknown, memberId: unknown): Promise<PasswordResetByAdminResult | Unavailable> {
  return run(slug, async (d, ctx) => {
    const notFound = { status: "error", code: "not_found", message: "Usuário não encontrado neste cliente. Atualize a página." } as const
    const target = await memberUserId(d, ctx, typeof memberId === "string" ? memberId : "")
    if (target === null || !target.active) return notFound
    const auth = getAuth()
    if (auth === null) return UNAVAILABLE
    const [person] = await d.authDb.select({ email: user.email, banned: user.banned }).from(user).where(eq(user.id, target.userId)).limit(1)
    if (person === undefined || person.banned) return notFound
    const reset = await requestPasswordReset({ auth, authDb: d.authDb, now: d.now, ip: requestIp(await headers()) }, person.email)
    if (reset.status === "throttled") {
      return { status: "error", code: "throttled", message: "Muitos pedidos de redefinição. Tente de novo mais tarde." }
    }
    return { status: "ok" }
  })
}
