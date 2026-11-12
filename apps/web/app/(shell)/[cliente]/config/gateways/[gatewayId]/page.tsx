import { notFound } from "next/navigation"

import { MOCK_NOW, gatewayParams, getClientBySlug, getConfigAccess, getGateway } from "@/lib/mock"
import { dateTime } from "@/lib/format"
import { buildGatewayDetail } from "@/components/access/gateway-detail-data"
import { GatewayDetailView } from "@/components/access/gateway-detail-view"
import { ConfigAccessProvider } from "@/components/config/engemase-managed"

export async function generateStaticParams({ params }: { params: { cliente: string } }) {
  return gatewayParams(params.cliente)
}

export default async function Page({ params }: PageProps<"/[cliente]/config/gateways/[gatewayId]">) {
  const { cliente, gatewayId } = await params
  const client = getClientBySlug(cliente)
  const gateway = getGateway(gatewayId)
  if (!client || !gateway || gateway.clientId !== client.id) notFound()

  return (
    <ConfigAccessProvider canEdit={getConfigAccess(client.id).canConfigure}>
      <GatewayDetailView data={buildGatewayDetail(client, gateway)} nowLabel={dateTime(MOCK_NOW)} />
    </ConfigAccessProvider>
  )
}
