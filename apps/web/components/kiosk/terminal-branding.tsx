import { getClientBranding } from "@/lib/mock"

/** Identidade do cliente no terminal (docs/14): só primária e foco; as cores de estado não mudam. */
export function TerminalBranding({ clientId }: { clientId: string }) {
  const branding = getClientBranding(clientId)
  if (!branding) return null
  return (
    <style>{`html:root{--primary:${branding.tokens.light.primary};--ring:${branding.tokens.light.ring}}html.dark{--primary:${branding.tokens.dark.primary};--ring:${branding.tokens.dark.ring}}`}</style>
  )
}
