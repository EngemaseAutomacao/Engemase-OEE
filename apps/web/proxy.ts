/**
 * Proxy (antigo middleware): checagem OTIMISTA de login nas telas do sistema.
 *
 * Com `AUTH_ENFORCED` ligado (padrão em produção quando o login está configurado, ver lib/server/auth/env.ts), quem abre uma tela do
 * sistema sem o cookie de sessão vai para /login?next=<tela>. É só um atalho de navegação: a
 * autorização de verdade é no servidor, em cada página/Server Action/rota (`requireTenant`), que
 * confere a sessão no banco, o cliente, o papel e o escopo. As telas do protótipo ainda usam dados
 * simulados (lib/mock) e só passam por esta checagem; a troca pelo banco é da W8.
 *
 * Ficam abertas: a apresentação (/), o login, o aviso de cliente suspenso, as APIs (gateways e
 * /api/auth têm autenticação própria), os terminais pareados (/terminal, token de dispositivo) e os
 * arquivos estáticos.
 */
import { getSessionCookie } from "better-auth/cookies"
import { type NextRequest, NextResponse } from "next/server"
import { AUTH_COOKIE_PREFIX, authEnforced } from "@/lib/server/auth/env"

const PUBLIC_EXACT = new Set(["/", "/login", "/acesso-suspenso", "/produto"])
const PUBLIC_PREFIXES = ["/api/", "/terminal", "/_next/", "/brand/"]

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true
  // Arquivos (ícones, imagens, manifest...): têm extensão no último segmento.
  return /\/[^/]+\.[a-z0-9]+$/i.test(pathname)
}

export function proxy(request: NextRequest) {
  if (!authEnforced()) return NextResponse.next()
  const { pathname, search } = request.nextUrl
  if (isPublicPath(pathname)) return NextResponse.next()
  if (getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX }) !== null) return NextResponse.next()
  const login = new URL("/login", request.url)
  login.searchParams.set("next", `${pathname}${search}`)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
