import { notFound } from "next/navigation"

import { clientParams, getClientBranding, getClientBySlug } from "@/lib/mock"

export function generateStaticParams() {
  return clientParams()
}

/** Layout de tela cheia (TV/Andon e tablet do operador): sem menu lateral. */
/** Protótipo com dados simulados: navegação pode bloquear (a versão real usará <Suspense>). */
export const instant = false

export default async function KioskLayout({ children, params }: LayoutProps<"/[cliente]">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()
  const branding = getClientBranding(client.id)
  return (
    <div className="min-h-dvh bg-background">
      {branding && (
        // Identidade visual do cliente (docs/14), igual à área do cliente: só primária e foco; cores de estado não mudam.
        <style>{`html:root{--primary:${branding.tokens.light.primary};--ring:${branding.tokens.light.ring}}html.dark{--primary:${branding.tokens.dark.primary};--ring:${branding.tokens.dark.ring}}`}</style>
      )}
      {children}
    </div>
  )
}
