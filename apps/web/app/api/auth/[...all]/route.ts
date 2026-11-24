/**
 * /api/auth/* — Better Auth atrás da lista de permissão (docs/15, seção 5): só as rotas de
 * `ALLOWED_AUTH_ROUTES` chegam ao Better Auth; o resto responde 404. A lógica fica em
 * lib/server/auth (testada sem o Next.js).
 */
import { getAuth } from "@/lib/server/auth"
import { AUTH_BASE_PATH, isAuthRouteAllowed } from "@/lib/server/auth/routes"

const NO_STORE = { "Cache-Control": "private, no-store" }

async function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.slice(AUTH_BASE_PATH.length) || "/"
  if (!isAuthRouteAllowed(request.method, path)) {
    return Response.json({ code: "NOT_FOUND", message: "Rota não encontrada." }, { status: 404, headers: NO_STORE })
  }
  const auth = getAuth()
  if (auth === null) {
    return Response.json(
      { code: "AUTH_UNAVAILABLE", message: "Login indisponível: configuração do servidor incompleta." },
      { status: 503, headers: NO_STORE },
    )
  }
  return auth.handler(request)
}

export const GET = handle
export const POST = handle
