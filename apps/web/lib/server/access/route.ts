/**
 * `requireTenant` para route handlers (respostas JSON em vez de redirecionar): sessão pelo cookie do
 * pedido, cliente da URL, vínculo/escopo sob RLS. Sem login 401; sem acesso (ou cliente inexistente)
 * 404; papel sem a permissão 404; cliente suspenso 403; 2FA pendente 403. Sempre `no-store`.
 */
import { isIP } from "node:net"
import type { Auth } from "@/lib/server/auth/auth"
import { readSession } from "@/lib/server/auth/session"
import type { ThrottleDb } from "@/lib/server/auth/throttle"
import type { GatewayDb } from "@/lib/server/gateway/types"
import { type AccessDenial, hasPermission, type TenantContext } from "./context"
import { loadTenantContext } from "./load"
import type { Permission } from "./permissions"

export const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const

const DENIAL_RESPONSE: Record<AccessDenial, { status: number; code: string; message: string }> = {
  unauthenticated: { status: 401, code: "unauthenticated", message: "Entre na plataforma para continuar." },
  not_found: { status: 404, code: "not_found", message: "Não encontrado." },
  forbidden: { status: 404, code: "not_found", message: "Não encontrado." },
  client_suspended: { status: 403, code: "client_suspended", message: "O acesso da sua empresa está suspenso." },
  two_factor_required: {
    status: 403,
    code: "two_factor_required",
    message: "Ative a verificação em duas etapas em /conta/seguranca para continuar.",
  },
}

export function denialResponse(reason: AccessDenial): Response {
  const { status, code, message } = DENIAL_RESPONSE[reason]
  return Response.json({ error: code, message }, { status, headers: NO_STORE_HEADERS })
}

export interface TenantRouteDeps {
  readonly auth: Auth | null
  readonly authDb: ThrottleDb | null
  readonly db: GatewayDb | null
  readonly now?: () => Date
}

/** Resolve o contexto do pedido ou devolve a resposta de erro pronta. */
export async function tenantForRequest(
  request: Request,
  slug: string,
  permission: Permission,
  deps: TenantRouteDeps,
): Promise<{ readonly ctx: TenantContext } | { readonly response: Response }> {
  if (deps.auth === null || deps.authDb === null || deps.db === null) {
    return { response: Response.json({ error: "unavailable", message: "Serviço indisponível." }, { status: 503, headers: NO_STORE_HEADERS }) }
  }
  const now = deps.now?.() ?? new Date()
  const session = await readSession(deps.auth, deps.authDb, request.headers, now)
  if (session === null) return { response: denialResponse("unauthenticated") }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? ""
  const decision = await loadTenantContext(deps.db, {
    slug,
    user: session.user,
    sessionId: session.sessionId,
    now,
    ip: isIP(ip) !== 0 ? ip : null,
    userAgent: request.headers.get("user-agent"),
  })
  if (!decision.ok) return { response: denialResponse(decision.reason) }
  if (!hasPermission(decision.context, permission)) return { response: denialResponse("forbidden") }
  return { ctx: decision.context }
}
