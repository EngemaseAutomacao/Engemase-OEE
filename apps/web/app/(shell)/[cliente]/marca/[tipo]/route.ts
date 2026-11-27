/**
 * GET /[cliente]/marca/[tipo] — logotipo do cliente (light | dark | symbol), entregue do Blob PRIVADO só para
 * quem tem acesso ao cliente (`requireTenant`). Sem acesso, sem logotipo ou sem armazenamento: 404 (o
 * menu usa o da Engemase). SVG vai com CSP `sandbox`: mesmo aberto direto no navegador, nada roda.
 */
import { connection } from "next/server"
import { requireTenant } from "@/lib/server/access/require-tenant"
import { abrirLogo, blobStore } from "@/lib/server/config/logos"
import { getDb } from "@/lib/server/db"

const NAO_ENCONTRADO = () => new Response("Não encontrado", { status: 404, headers: { "Cache-Control": "no-store" } })

export async function GET(_request: Request, { params }: RouteContext<"/[cliente]/marca/[tipo]">): Promise<Response> {
  await connection()
  const { cliente, tipo } = await params
  const db = getDb()
  if (db === null) return NAO_ENCONTRADO()
  let ctx
  try {
    ctx = await requireTenant(cliente)
  } catch {
    // Sem sessão, sem acesso ao cliente (requireTenant redireciona ou responde 404): nada de logotipo.
    return NAO_ENCONTRADO()
  }
  const logo = await abrirLogo(db, ctx, tipo, await blobStore())
  if (logo === null) return NAO_ENCONTRADO()
  const headers = new Headers({
    "Content-Type": logo.contentType,
    // A URL leva `?v=<hash>`: pode guardar no navegador; é particular (depende do login).
    "Cache-Control": "private, max-age=86400",
    ETag: `"${logo.sha256.slice(0, 32)}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  })
  if (logo.contentType === "image/svg+xml") headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
  return new Response(logo.stream, { headers })
}
