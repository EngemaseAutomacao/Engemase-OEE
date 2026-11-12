import { notFound } from "next/navigation"

import { getAuditLog, getClientBySlug, getConfigAccess, getDevices, getGateways, getMachines, getUnits } from "@/lib/mock"
import { freshCodeExpiresLabel, gatewayRow } from "@/components/access/gateway-view"
import { GatewaysView } from "@/components/access/gateways-view"
import { ConfigAccessProvider } from "@/components/config/engemase-managed"

export default async function Page({ params }: PageProps<"/[cliente]/config/gateways">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const units = getUnits(client.id)
  const machines = getMachines(client.id)
  const audit = getAuditLog(client.id)
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? "—"
  const rows = getGateways(client.id).map((g) => gatewayRow(g, unitName(g.unitId), getDevices(g.id), machines, audit))

  return (
    <ConfigAccessProvider canEdit={getConfigAccess(client.id).canConfigure}>
      <GatewaysView
        clientSlug={client.slug}
        rows={rows}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        limit={client.limits.gateways}
        freshExpiresLabel={freshCodeExpiresLabel()}
      />
    </ConfigAccessProvider>
  )
}
