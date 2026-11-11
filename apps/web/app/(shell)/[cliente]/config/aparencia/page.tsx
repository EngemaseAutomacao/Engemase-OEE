import { notFound } from "next/navigation"

import { brandPresets, getClientBranding, getClientBySlug, getLine, getMachines } from "@/lib/mock"
import { BrandEditor } from "@/components/settings/brand-editor"
import type { BrandingInitial, PreviewMachine } from "@/components/settings/types"

export default async function Page({ params }: PageProps<"/[cliente]/config/aparencia">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  // Sem registro de identidade = padrão Engemase (docs/14).
  const branding = getClientBranding(client.id)
  const engemase = brandPresets.find((p) => p.name === "Azul Engemase") ?? brandPresets[0]!
  const initial: BrandingInitial = branding
    ? {
        displayName: branding.displayName,
        shortName: branding.displayName.replace(/\s+OEE$/i, "").slice(0, 12),
        preset: branding.preset,
        brandColor: branding.brandColor,
        sidebarMode: branding.sidebarMode,
        tokens: branding.tokens,
        custom: true,
      }
    : {
        displayName: client.name,
        shortName: client.name.split(/\s+/)[0]!.slice(0, 12),
        preset: engemase.name,
        brandColor: engemase.hex,
        sidebarMode: "neutral",
        tokens: null,
        custom: false,
      }

  const first = getMachines(client.id)[0]
  const machine: PreviewMachine = first ? { name: first.name, line: getLine(first.lineId)?.name ?? "" } : { name: "Máquina 01", line: "Linha 1" }

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <BrandEditor clientName={client.name} initial={initial} presets={brandPresets} machine={machine} />
    </div>
  )
}
