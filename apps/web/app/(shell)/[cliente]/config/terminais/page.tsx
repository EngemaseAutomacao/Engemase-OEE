import type { Metadata } from "next"
import { Suspense } from "react"
import { ConfigAccessProvider, EngemaseManagedNote } from "@/components/config/engemase-managed"
import { TerminalsManager } from "@/components/settings/terminals-manager"
import { CarregandoPagina } from "@/components/shell/carregando"
import { dadosTerminais } from "@/lib/data/config/terminais"

export const metadata: Metadata = { title: "Terminais" }

/** Lê a sessão e o cadastro (com banco, `requireTenant`): fica dentro do <Suspense>. */
async function Tela({ params }: { params: PageProps<"/[cliente]/config/terminais">["params"] }) {
  const { cliente } = await params
  const d = await dadosTerminais(cliente)
  return (
    <ConfigAccessProvider canEdit={d.canEdit}>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <EngemaseManagedNote clientSlug={d.client.slug} subject="Terminais (TVs Andon e tablets) e o que cada um mostra" />
        <TerminalsManager
          clientSlug={d.client.slug}
          clientName={d.client.name}
          currentUserName={d.currentUserName}
          units={d.units}
          lines={d.lines}
          machines={d.machines}
          initialTerminals={d.terminals}
          banco={d.banco}
        />
      </div>
    </ConfigAccessProvider>
  )
}

export default function Page({ params }: PageProps<"/[cliente]/config/terminais">) {
  return (
    <Suspense fallback={<CarregandoPagina />}>
      <Tela params={params} />
    </Suspense>
  )
}
