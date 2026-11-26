/**
 * Quem entra no console Engemase e no cadastro de um cliente, quando as telas usam o banco (W8).
 *
 * - Console (`/admin`): só a equipe Engemase (papel de plataforma válido, sem bloqueio) e com 2FA
 *   ligado (D14). Sem login → /login; sem papel → 404 (não revela o console); sem 2FA → cadastro.
 * - Cadastro de um cliente: `requireTenant(slug)` (RLS, escopo, concessão) + permissão do papel.
 *
 * Server Actions chamam de novo (não confiam na página que as mostrou).
 */
import { PLATFORM_ROLES, type PlatformRole } from "@engemase/db"
import { notFound, redirect } from "next/navigation"
import { cache } from "react"
import { usarRelogioReal } from "@/lib/mock/clock"
import { PLATFORM_ROLE_LABEL } from "@/lib/roles"
import type { TenantContext } from "@/lib/server/access/context"
import { getCurrentSession } from "@/lib/server/auth/current"
import type { CurrentSession } from "@/lib/server/auth/session"
import { type GatewayAdminActor } from "@/lib/server/gateway/admin-errors"
import { getDb } from "@/lib/server/db"
import type { GatewayDb } from "@/lib/server/gateway/types"

export interface Equipe {
  readonly session: CurrentSession
  readonly role: PlatformRole
  readonly db: GatewayDb
}

/** Papel de plataforma da sessão, ou `null`. */
export function papelDePlataforma(session: CurrentSession): PlatformRole | null {
  const role = session.user.role
  return role !== null && (PLATFORM_ROLES as readonly string[]).includes(role) ? (role as PlatformRole) : null
}

/** Banco da aplicação (com banco ligado ele existe; sem ele, erro de configuração). */
export function bancoObrigatorio(): GatewayDb {
  const db = getDb()
  if (db === null) throw new Error("DATABASE_URL não configurado")
  return db
}

/** Console Engemase numa página (memorizado por pedido). */
export const exigirEquipe = cache(async (): Promise<Equipe> => {
  const session = await getCurrentSession()
  if (session === null) redirect("/login?next=/admin")
  const role = papelDePlataforma(session)
  if (role === null || session.user.banned) notFound()
  usarRelogioReal(new Date().toISOString())
  return { session, role, db: bancoObrigatorio() }
})

/** Resultado padrão das Server Actions (mensagens em português). */
export type Resultado<T = undefined> =
  | { readonly ok: true; readonly dados: T }
  | { readonly ok: false; readonly mensagem: string; readonly problemas?: readonly { readonly campo: string; readonly mensagem: string }[] }

export const falha = (mensagem: string, problemas?: { campo: string; mensagem: string }[]): Resultado<never> => ({ ok: false, mensagem, problemas })

/** Console numa Server Action: sem sessão/papel → `null` (a action responde com a mensagem). */
export async function equipeNaAcao(papeis: readonly PlatformRole[]): Promise<Equipe | null> {
  const session = await getCurrentSession()
  if (session === null) return null
  const role = papelDePlataforma(session)
  if (role === null || session.user.banned || !papeis.includes(role)) return null
  const db = getDb()
  return db === null ? null : { session, role, db }
}

/** Ator da auditoria a partir do contexto do cliente. */
export function atorDoContexto(ctx: TenantContext): GatewayAdminActor {
  if (ctx.access.kind === "engemase") {
    return { type: "engemase", id: ctx.user.id, label: `${ctx.user.name} (${PLATFORM_ROLE_LABEL[ctx.access.role].toLowerCase()} Engemase)` }
  }
  return { type: "user", id: ctx.user.id, label: ctx.user.name }
}

/** Ator da auditoria a partir da equipe (console). */
export function atorDaEquipe(e: Equipe): GatewayAdminActor {
  return { type: "engemase", id: e.session.user.id, label: `${e.session.user.name} (${PLATFORM_ROLE_LABEL[e.role].toLowerCase()} Engemase)` }
}
