/**
 * Reiniciar a verificação em duas etapas de OUTRA pessoa (perdeu o celular e os códigos de recuperação).
 *
 * Quem pode (D12: usuários do cliente são do admin do cliente; D13: a Engemase não mexe em usuários, exceto
 * o super admin; D14: 2FA obrigatório para admin do cliente e equipe Engemase):
 *
 * | quem pede                | pessoa-alvo                                                  |
 * |--------------------------|--------------------------------------------------------------|
 * | admin do cliente         | membro do PRÓPRIO cliente, que não é admin e não tem vínculo com outro cliente |
 * | super admin (no cliente) | qualquer membro do cliente (inclusive admin)                 |
 * | técnico, demais papéis   | ninguém (sem `users.manage`)                                 |
 *
 * Nunca: a própria pessoa (ela troca o aplicativo em "Segurança da conta"), nem alguém da equipe Engemase
 * (runbook da direção). O admin não reinicia quem também acessa outro cliente porque o efeito valeria lá
 * também; nesse caso, e para outro admin, o pedido vai ao suporte Engemase (super admin). A mensagem de
 * recusa é a mesma nos dois casos (não revela que a pessoa tem outros vínculos).
 *
 * A pessoa-alvo é identificada pelo id do VÍNCULO no cliente da URL (lido sob a RLS), nunca por `user_id`
 * vindo do navegador. Efeito: apaga o segredo TOTP e os códigos de recuperação, desliga o 2FA e encerra todas
 * as sessões dela; no próximo login, como o papel exige 2FA, ela cadastra de novo. Auditado no cliente
 * (visível ao admin, D5) ANTES de executar; se a execução falhar, um segundo registro diz que falhou.
 */
import { auditLog, CLIENT_ROLES, member, memberAccess, PLATFORM_ROLES, session, twoFactor, user } from "@engemase/db"
import { and, eq, ne } from "drizzle-orm"
import { z } from "zod"
import { assertPermission, type TenantContext } from "@/lib/server/access/context"
import { withContext } from "@/lib/server/access/load"
import { sendSafely } from "@/lib/server/email"
import { twoFactorResetEmail } from "@/lib/server/email/templates"
import { actorDisplayName, auditActor } from "./audit"
import type { UsersDeps } from "./invite"

export type ResetTwoFactorResult =
  | { readonly status: "ok"; readonly emailSent: boolean }
  | {
      readonly status: "error"
      readonly code: "not_found" | "self" | "refused" | "not_enabled"
      readonly message: string
    }

const NOT_FOUND = { status: "error", code: "not_found", message: "Usuário não encontrado neste cliente." } as const
const REFUSED = {
  status: "error",
  code: "refused",
  message: "A verificação em duas etapas desta pessoa só pode ser reiniciada pelo suporte Engemase.",
} as const

export async function resetMemberTwoFactor(deps: UsersDeps, ctx: TenantContext, memberId: string): Promise<ResetTwoFactorResult> {
  assertPermission(ctx, "users.manage")
  if (!z.uuid().safeParse(memberId).success) return NOT_FOUND
  const isSuperAdmin = ctx.access.kind === "engemase" && ctx.access.role === "super_admin"
  if (ctx.access.kind === "engemase" && !isSuperAdmin) return REFUSED

  // 1. O vínculo e o papel, sob a RLS do cliente da URL.
  const target = await withContext(deps.db, ctx, async (tx) => {
    const [row] = await tx
      .select({ userId: member.userId, role: memberAccess.role })
      .from(member)
      .leftJoin(memberAccess, and(eq(memberAccess.memberId, member.id), eq(memberAccess.organizationId, member.organizationId)))
      .where(eq(member.id, memberId))
      .limit(1)
    return row ?? null
  })
  if (target === null) return NOT_FOUND
  if (target.userId === ctx.user.id) {
    return { status: "error", code: "self", message: "Para trocar o seu próprio aplicativo, use a página Segurança da conta." }
  }

  // 2. A pessoa e os outros vínculos dela, no banco do login.
  const [person] = await deps.authDb
    .select({ email: user.email, name: user.name, role: user.role, twoFactorEnabled: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.id, target.userId))
    .limit(1)
  if (person === undefined) return NOT_FOUND
  if (person.role !== null && (PLATFORM_ROLES as readonly string[]).includes(person.role)) return REFUSED
  if (!isSuperAdmin) {
    const targetRole = (CLIENT_ROLES as readonly string[]).includes(target.role ?? "") ? target.role : null
    if (targetRole === "client_admin") return REFUSED
    const [elsewhere] = await deps.authDb
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, target.userId), ne(member.organizationId, ctx.organizationId)))
      .limit(1)
    if (elsewhere !== undefined) return REFUSED
  }
  if (!person.twoFactorEnabled) {
    return { status: "error", code: "not_enabled", message: "Esta pessoa ainda não ativou a verificação em duas etapas." }
  }

  // 3. Auditoria antes de executar (nunca um reinício sem registro).
  const actor = auditActor(ctx)
  const audit = (action: string) =>
    withContext(deps.db, ctx, (tx) =>
      tx.insert(auditLog).values({
        organizationId: ctx.organizationId,
        ...actor,
        action,
        entityType: "member",
        entityId: memberId,
        at: deps.now,
      }),
    )
  await audit("user.two_factor_reset")

  // 4. Execução no banco do login: sem segredo, sem códigos, sem sessões.
  try {
    await deps.authDb.transaction(async (tx) => {
      await tx.delete(twoFactor).where(eq(twoFactor.userId, target.userId))
      await tx.update(user).set({ twoFactorEnabled: false, updatedAt: deps.now }).where(eq(user.id, target.userId))
      await tx.delete(session).where(eq(session.userId, target.userId))
    })
  } catch (error) {
    await audit("user.two_factor_reset_failed").catch(() => undefined)
    throw error
  }

  const sent = await sendSafely(
    deps.sendEmail,
    twoFactorResetEmail({
      to: person.email,
      name: person.name,
      resetBy: actorDisplayName(ctx),
      loginUrl: `${new URL(deps.baseURL).origin}/login`,
    }),
    "2FA reiniciado",
  )
  return { status: "ok", emailSent: sent.status !== "failed" }
}
