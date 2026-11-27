/**
 * Para onde a pessoa vai depois do login. O `next` (de onde ela veio) só vale se for um caminho
 * RELATIVO deste app, sem esquema nem host (docs/15, item 2: nada de redirecionar para fora).
 */
import { member, memberAccess, organization, PLATFORM_ROLES, withTenant } from "@engemase/db"
import { and, asc, eq } from "drizzle-orm"
import type { GatewayDb } from "@/lib/server/gateway/types"
import type { ThrottleDb } from "./throttle"

const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/]*$/
const NEVER_NEXT = ["/api/", "/login", "/_next/"]

/** Caminho de retorno seguro, ou `null`. */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== "string" || next.length > 512 || !SAFE_PATH.test(next)) return null
  if (next.includes("/../") || next.endsWith("/..")) return null
  if (NEVER_NEXT.some((prefix) => next === prefix.replace(/\/$/, "") || next.startsWith(prefix))) return null
  return next
}

export interface ClientLink {
  readonly id: string
  readonly slug: string
  readonly name: string
}

/**
 * Clientes em que a pessoa tem vínculo ATIVO, em ordem de nome. Os vínculos vêm do banco do login
 * (`auth_service` enxerga `member` e `organization` de todos os clientes); se o vínculo está desativado
 * (`member_access.active = false`, gravado pelo admin do cliente) é conferido no banco do app, sob a RLS de
 * cada cliente. Sem o banco do app, devolve todos (cada painel confere de novo em `requireTenant`).
 */
export async function activeClients(authDb: ThrottleDb, appDb: GatewayDb | null, userId: string): Promise<ClientLink[]> {
  const rows = await authDb
    .select({ id: organization.id, slug: organization.slug, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name))
  if (appDb === null) return rows
  const active: ClientLink[] = []
  for (const org of rows) {
    const ok = await withTenant(appDb, org.id, async (tx) => {
      const [row] = await tx
        .select({ id: memberAccess.id })
        .from(member)
        .innerJoin(memberAccess, eq(memberAccess.memberId, member.id))
        .where(and(eq(member.userId, userId), eq(memberAccess.active, true)))
        .limit(1)
      return row !== undefined
    })
    if (ok) active.push(org)
  }
  return active
}

/**
 * Página inicial da pessoa: equipe Engemase → console (/admin); quem tem um cliente ativo só → o painel
 * dele; mais de um (ou nenhum) → seletor de cliente (/inicio). Não autoriza nada: a página de destino passa
 * por `requireTenant`.
 */
export async function landingPath(
  db: ThrottleDb,
  person: { readonly id: string; readonly role: string | null },
  appDb: GatewayDb | null = null,
): Promise<string> {
  if (person.role !== null && (PLATFORM_ROLES as readonly string[]).includes(person.role)) return "/admin"
  const rows = await activeClients(db, appDb, person.id)
  return rows.length === 1 && rows[0] !== undefined ? `/${rows[0].slug}` : "/inicio"
}
