/**
 * Para onde a pessoa vai depois do login. O `next` (de onde ela veio) só vale se for um caminho
 * RELATIVO deste app, sem esquema nem host (docs/15, item 2: nada de redirecionar para fora).
 */
import { member, organization, PLATFORM_ROLES } from "@engemase/db"
import { eq } from "drizzle-orm"
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

/**
 * Página inicial da pessoa: equipe Engemase → console (/admin); quem tem um cliente só → o painel
 * dele; mais de um (ou nenhum) → seletor de cliente (/inicio). Lê com o banco do Better Auth
 * (`auth_service` enxerga `member` e `organization` de todos os clientes). Não autoriza nada: a
 * página de destino passa por `requireTenant`.
 */
export async function landingPath(
  db: ThrottleDb,
  person: { readonly id: string; readonly role: string | null },
): Promise<string> {
  if (person.role !== null && (PLATFORM_ROLES as readonly string[]).includes(person.role)) return "/admin"
  const rows = await db
    .select({ slug: organization.slug })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, person.id))
    .limit(2)
  return rows.length === 1 && rows[0] !== undefined ? `/${rows[0].slug}` : "/inicio"
}
