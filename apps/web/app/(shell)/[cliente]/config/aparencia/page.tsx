import type { Metadata } from "next"
import { Suspense } from "react"

import { brandPresets, getClientBranding } from "@/lib/mock"
import { ConfigAccessProvider, EngemaseManagedNote } from "@/components/config/engemase-managed"
import { BrandEditor } from "@/components/settings/brand-editor"
import { BrandEditorBanco } from "@/components/settings/brand-editor-banco"
import type { BrandingInitial, PreviewMachine } from "@/components/settings/types"
import { CarregandoPagina } from "@/components/shell/carregando"
import { exigirCliente } from "@/lib/data/config/cliente"
import { bancoObrigatorio } from "@/lib/data/admin/acesso"
import { lerAparencia } from "@/lib/server/config/branding"

export const metadata: Metadata = { title: "Aparência" }

/** Lê a sessão e a identidade (com banco: `config.read`, RLS): fica dentro do <Suspense>. */
async function Tela({ params }: { params: PageProps<"/[cliente]/config/aparencia">["params"] }) {
  const { cliente } = await params
  const { r, client, ctx } = await exigirCliente(cliente)

  // Sem registro de identidade = padrão Engemase (docs/14).
  const branding = ctx === null ? getClientBranding(client.id) : await lerAparencia(bancoObrigatorio(), ctx)
  const engemase = brandPresets.find((p) => p.name === "Azul Engemase") ?? brandPresets[0]!
  const initial: BrandingInitial = branding
    ? {
        displayName: branding.displayName,
        shortName: "shortName" in branding ? branding.shortName : branding.displayName.replace(/\s+OEE$/i, "").slice(0, 12),
        preset: branding.preset,
        brandColor: branding.brandColor,
        sidebarMode: branding.sidebarMode,
        tokens: branding.tokens,
        custom: true,
      }
    : {
        displayName: client.name.slice(0, 40),
        shortName: client.name.split(/\s+/)[0]!.slice(0, 12),
        preset: engemase.name,
        brandColor: engemase.hex,
        sidebarMode: "neutral",
        tokens: null,
        custom: false,
      }

  const first = r.getMachines(client.id)[0]
  const machine: PreviewMachine = first ? { name: first.name, line: r.getLines(client.id).find((l) => l.id === first.lineId)?.name ?? "" } : { name: "Máquina 01", line: "Linha 1" }

  return (
    <ConfigAccessProvider canEdit={r.getConfigAccess(client.id).canConfigure}>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <EngemaseManagedNote clientSlug={client.slug} subject="Cor da marca, menu lateral, nome exibido e logotipos" />
        {ctx === null ? (
          <BrandEditor clientName={client.name} initial={initial} presets={brandPresets} machine={machine} />
        ) : (
          <BrandEditorBanco clientSlug={client.slug} clientName={client.name} initial={initial} presets={brandPresets} machine={machine} />
        )}
      </div>
    </ConfigAccessProvider>
  )
}

export default function Page({ params }: PageProps<"/[cliente]/config/aparencia">) {
  return (
    <Suspense fallback={<CarregandoPagina />}>
      <Tela params={params} />
    </Suspense>
  )
}
