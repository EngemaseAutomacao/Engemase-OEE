import { Suspense } from "react"

import { getClientData } from "@/lib/data/cliente"

/** Layout de tela cheia (TV/Andon e tablet do operador): sem menu lateral. */
export default function KioskLayout({ children, params }: LayoutProps<"/[cliente]">) {
  return (
    <div className="min-h-dvh bg-background">
      <Suspense fallback={null}>
        <KioskBranding params={params} />
      </Suspense>
      {children}
    </div>
  )
}

/** Identidade visual do cliente (docs/14), igual à área do cliente: só primária e foco; cores de estado não mudam. */
async function KioskBranding({ params }: { params: LayoutProps<"/[cliente]">["params"] }) {
  const { cliente } = await params
  const { branding } = await getClientData(cliente, { somenteCadastro: true })
  if (!branding) return null
  return (
    <style>{`html:root{--primary:${branding.tokens.light.primary};--ring:${branding.tokens.light.ring}}html.dark{--primary:${branding.tokens.dark.primary};--ring:${branding.tokens.dark.ring}}`}</style>
  )
}
