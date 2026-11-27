"use server"

/**
 * Server Actions da equipe Engemase (console): concessões de suporte, atribuições e ações sobre os
 * membros. Quem pode o quê é conferido de novo em `lib/server/team/manage.ts` (a tela só esconde botões).
 */
import { revalidatePath } from "next/cache"
import { equipeNaAcao, type Resultado } from "@/lib/data/admin/acesso"
import { authSettings } from "@/lib/server/auth/env"
import { getAuthDb } from "@/lib/server/db"
import { getEmailSender } from "@/lib/server/email"
import {
  changeMemberRole,
  createAssignment,
  endSupportGrant,
  openSupportGrant,
  renewAssignment,
  resendTeamInvite,
  resetMemberTwoFactorStaff,
  revokeAssignment,
  setMemberDisabled,
  type TeamActorWithRole,
  type TeamDeps,
  type TeamResult,
} from "@/lib/server/team/manage"

const SEM_ACESSO: Resultado<never> = { ok: false, mensagem: "Sessão encerrada ou sem permissão. Entre de novo." }

async function contexto(): Promise<{ deps: TeamDeps; actor: TeamActorWithRole } | null> {
  const equipe = await equipeNaAcao(["super_admin", "technician"])
  const authDb = getAuthDb()
  if (equipe === null || authDb === null) return null
  return {
    deps: { db: equipe.db, authDb, now: new Date(), baseURL: authSettings()?.baseURL ?? "", sendEmail: getEmailSender() },
    actor: { id: equipe.session.user.id, name: equipe.session.user.name, email: equipe.session.user.email, role: equipe.role },
  }
}

async function executar<T, R = T>(
  op: (deps: TeamDeps, actor: TeamActorWithRole) => Promise<TeamResult<T>>,
  mapa: (t: T) => R = (t) => t as unknown as R,
): Promise<Resultado<R>> {
  const c = await contexto()
  if (c === null) return SEM_ACESSO
  try {
    const r = await op(c.deps, c.actor)
    if (r.status === "error") return { ok: false, mensagem: r.message }
    revalidatePath("/admin", "layout")
    return { ok: true, dados: mapa(r.data) }
  } catch (error) {
    console.error("[equipe] falha numa ação da equipe", error)
    return { ok: false, mensagem: "Não foi possível concluir. Tente de novo em instantes." }
  }
}

export async function abrirConcessaoAction(input: unknown) {
  return executar((d, a) => openSupportGrant(d, a, input), (r) => ({ id: r.id, terminaEm: r.endsAt.toISOString() }))
}
export async function encerrarConcessaoAction(input: unknown) {
  return executar((d, a) => endSupportGrant(d, a, input))
}
export async function criarAtribuicaoAction(input: unknown) {
  return executar((d, a) => createAssignment(d, a, input))
}
export async function renovarAtribuicaoAction(input: unknown) {
  return executar((d, a) => renewAssignment(d, a, input))
}
export async function revogarAtribuicaoAction(input: unknown) {
  return executar((d, a) => revokeAssignment(d, a, input))
}
export async function trocarPapelAction(input: unknown) {
  return executar((d, a) => changeMemberRole(d, a, input))
}
export async function desativarMembroAction(input: unknown) {
  return executar((d, a) => setMemberDisabled(d, a, input, true))
}
export async function reativarMembroAction(input: unknown) {
  return executar((d, a) => setMemberDisabled(d, a, input, false))
}
export async function reenviarConviteAction(input: unknown) {
  return executar((d, a) => resendTeamInvite(d, a, input), (r) => ({ link: r.link, expiraEm: r.expiresAt.toISOString(), emailEnviado: r.emailSent }))
}
export async function reiniciar2faMembroAction(input: unknown) {
  return executar((d, a) => resetMemberTwoFactorStaff(d, a, input))
}
