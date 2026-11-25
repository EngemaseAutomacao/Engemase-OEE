"use server"

/**
 * Server Actions da gestão de usuários do cliente (D12): convidar, reenviar convite e reiniciar a verificação
 * em duas etapas de outra pessoa. Cada uma confere de novo, no servidor, a sessão, o cliente da URL e a
 * permissão `users.manage` (`requirePermission`; sem acesso → 404) e só então chama a regra em
 * `lib/server/users` (que valida a entrada, aplica a RLS e audita).
 *
 * A tela de usuários ainda mostra o protótipo (dados simulados); ligar estas ações a ela é da W8 (troca do
 * mock), junto com a lista real de membros.
 */
import { z } from "zod"
import { requirePermission } from "@/lib/server/access/require-tenant"
import { authSettings } from "@/lib/server/auth/env"
import { getAuthDb, getDb } from "@/lib/server/db"
import { getEmailSender } from "@/lib/server/email"
import { type InviteResult, inviteMember, type ResendResult, resendInvite, type UsersDeps } from "@/lib/server/users/invite"
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
