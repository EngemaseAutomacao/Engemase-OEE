import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { dadosGateway } from "@/lib/data/config/telas"
import { GatewayDetailView } from "@/components/access/gateway-detail-view"
import { ConfigAccessProvider } from "@/components/config/engemase-managed"
import { FonteDadosProvider } from "@/components/config/fonte-dados"
import { CarregandoPagina } from "@/components/shell/carregando"

export const metadata: Metadata = { title: "Gateway" }

/** Com banco, lê a sessão e o cadastro (requireTenant): fica dentro do <Suspense>. */
async function Detalhe({ params }: { params: PageProps<"/[cliente]/config/gateways/[gatewayId]">["params"] }) {
  const { cliente, gatewayId } = await params
  const d = await dadosGateway(cliente, gatewayId)
  if (d === null) notFound()
  return (
    <FonteDadosProvider banco={d.banco} slug={d.data.clientSlug}>
      <ConfigAccessProvider canEdit={d.canEdit}>
        <GatewayDetailView data={d.data} nowLabel={d.nowLabel} />
      </ConfigAccessProvider>
    </FonteDadosProvider>
  )
}

export default function Page({ params }: PageProps<"/[cliente]/config/gateways/[gatewayId]">) {
  return (
    <Suspense fallback={<CarregandoPagina />}>
      <Detalhe params={params} />
    </Suspense>
  )
}
