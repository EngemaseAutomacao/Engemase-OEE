import type { Metadata } from "next"
import { Suspense } from "react"
import { ConfigAccessProvider, EngemaseManagedNote } from "@/components/config/engemase-managed"
import { ReasonsManager } from "@/components/config/reasons-manager"
import { CarregandoPagina } from "@/components/shell/carregando"
import { dadosMotivos } from "@/lib/data/config/motivos"

export const metadata: Metadata = { title: "Motivos de parada" }

/** Lê a sessão e o cadastro (com banco, `requireTenant`): fica dentro do <Suspense>. */
async function Tela({ params }: { params: PageProps<"/[cliente]/config/motivos">["params"] }) {
  const { cliente } = await params
  const d = await dadosMotivos(cliente)
  return (
    <ConfigAccessProvider canEdit={d.canEdit}>
      <EngemaseManagedNote padded clientSlug={d.client.slug} subject="Motivos de parada e mapa de códigos de falha" />
      <ReasonsManager initialReasons={d.reasons} initialFaultMap={d.faultMap} machineTypes={d.machineTypes} banco={d.banco} clientSlug={d.client.slug} />
    </ConfigAccessProvider>
  )
}

export default function Page({ params }: PageProps<"/[cliente]/config/motivos">) {
  return (
    <Suspense fallback={<CarregandoPagina />}>
      <Tela params={params} />
    </Suspense>
  )
}
