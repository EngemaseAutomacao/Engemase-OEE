import type { Metadata } from "next"
import { Suspense } from "react"

import { dadosGateways } from "@/lib/data/config/telas"
import { GatewaysView } from "@/components/access/gateways-view"
import { ConfigAccessProvider } from "@/components/config/engemase-managed"
import { FonteDadosProvider } from "@/components/config/fonte-dados"
import { CarregandoPagina } from "@/components/shell/carregando"

export const metadata: Metadata = { title: "Gateways" }

/** Com banco, lê a sessão e o cadastro (requireTenant): fica dentro do <Suspense>. */
async function Lista({ params }: { params: PageProps<"/[cliente]/config/gateways">["params"] }) {
  const { cliente } = await params
  const d = await dadosGateways(cliente)
  return (
    <FonteDadosProvider banco={d.banco} slug={d.client.slug}>
      <ConfigAccessProvider canEdit={d.access.canConfigure}>
        <GatewaysView clientSlug={d.client.slug} rows={d.rows} units={d.units} limit={d.client.limits.gateways} freshExpiresLabel={d.freshExpiresLabel} />
      </ConfigAccessProvider>
    </FonteDadosProvider>
  )
}

export default function Page({ params }: PageProps<"/[cliente]/config/gateways">) {
  return (
    <Suspense fallback={<CarregandoPagina />}>
      <Lista params={params} />
    </Suspense>
  )
}
