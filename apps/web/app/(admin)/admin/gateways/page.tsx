import type { Metadata } from "next"

import { OpsTitle } from "@/components/admin-ops/bits"
import { FleetProvider } from "@/components/admin-ops/fleet-context"
import { buildFleet } from "@/components/admin-ops/fleet-data"
import { FleetStats } from "@/components/admin-ops/fleet-stats"
import { FleetTable } from "@/components/admin-ops/fleet-table"
import { OtaPanel } from "@/components/admin-ops/ota-panel"
import { ProvisionGatewayButton } from "@/components/admin-ops/provision-gateway-dialog"

export const metadata: Metadata = { title: "Frota de gateways" }

export default function Page() {
  const data = buildFleet()

  return (
    <FleetProvider data={data}>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <OpsTitle
          title="Frota de gateways"
          description={`Todos os gateways de todos os clientes: conexão, versão do agente, configuração e fila · atualizado ${data.generatedAt}`}
          actions={<ProvisionGatewayButton />}
        />
        <FleetStats />
        <FleetTable />
        <OtaPanel />
      </div>
    </FleetProvider>
  )
}
