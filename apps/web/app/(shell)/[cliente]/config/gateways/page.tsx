import { notFound } from "next/navigation"

import { getAuditLog, getClientBySlug, getDevices, getGateways, getMachines, getUnits } from "@/lib/mock"
import { freshCodeExpiresLabel, gatewayRow } from "@/components/access/gateway-view"
import { GatewaysView } from "@/components/access/gateways-view"

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
    <GatewaysView
      clientSlug={client.slug}
      managed={client.management === "engemase"}
      rows={rows}
      units={units.map((u) => ({ id: u.id, name: u.name }))}
      limit={client.limits.gateways}
      freshExpiresLabel={freshCodeExpiresLabel()}
    />
  )
}
