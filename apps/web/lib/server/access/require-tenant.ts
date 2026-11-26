/**
 * `requireTenant(slug)` — porta de entrada de TODA página, Server Action e route handler com dado de
 * cliente (docs/15, seção 4, item 2). Resolve sessão → cliente da URL → vínculo/papel/escopo/estado/
 * concessão sob RLS e devolve o `TenantContext`. Sem acesso:
 *
 * | motivo                | resposta                                         |
 * |-----------------------|--------------------------------------------------|
 * | sem login             | /login                                           |
 * | cliente não existe ou pessoa sem acesso | 404 (não revela que o cliente existe) |
 * | cliente suspenso      | /acesso-suspenso                                 |
 * | papel sem a permissão | 404 (`requirePermission`)                        |
 *
 * Memorizado por pedido (`cache` do React). Lê o pedido: em páginas, chame dentro de `<Suspense>`
 * (Cache Components). Server Actions chamam de novo (não confiam na página que as mostrou).
 */
import { isIP } from "node:net"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { cache } from "react"
import { getCurrentSession } from "@/lib/server/auth/current"
import { getDb } from "@/lib/server/db"
import { type AccessDenial, hasPermission, type TenantContext } from "./context"
import { loadTenantContext } from "./load"
import type { Permission } from "./permissions"

function deny(reason: AccessDenial): never {
  switch (reason) {
    case "unauthenticated":
      redirect("/login")
    case "client_suspended":
      redirect("/acesso-suspenso")
    case "not_found":
    case "forbidden":
      notFound()
  }
}

export const requireTenant = cache(async (slug: string): Promise<TenantContext> => {
  const session = await getCurrentSession()
  if (session === null) deny("unauthenticated")
  const db = getDb()
  if (db === null) throw new Error("DATABASE_URL não configurado: dados de cliente indisponíveis")
  const h = await headers()
  // Na Vercel o x-forwarded-for é escrito pela plataforma; ainda assim só vai para a auditoria (inet) se for um IP.
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? ""
  const decision = await loadTenantContext(db, {
    slug,
    user: session.user,
    sessionId: session.sessionId,
    now: new Date(),
    ip: isIP(ip) !== 0 ? ip : null,
    userAgent: h.get("user-agent"),
  })
  if (!decision.ok) deny(decision.reason)
  return decision.context
})

/** `requireTenant` + permissão do papel (sem a permissão: 404). */
export async function requirePermission(slug: string, permission: Permission): Promise<TenantContext> {
  const ctx = await requireTenant(slug)
  if (!hasPermission(ctx, permission)) deny("forbidden")
  return ctx
}
