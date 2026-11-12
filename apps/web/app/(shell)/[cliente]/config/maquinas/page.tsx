import Link from "next/link"
import { notFound } from "next/navigation"
import { PlusIcon } from "lucide-react"

import { getClientBySlug, getDevice, getGateways, getLines, getMachines, getTags, getUnits } from "@/lib/mock"
import { Button } from "@/components/ui/button"
import {
  MachineRegistry,
  type ConnInfo,
  type MachineRow,
  type RegistryGateway,
  type RegistryLine,
  type RegistryUnit,
} from "@/components/config/machine-registry"
import { serialPortsFor } from "@/components/config/labels"
import { PageTitle } from "@/components/refresh/page-title"

export default async function Page({ params }: PageProps<"/[cliente]/config/maquinas">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const machines = getMachines(client.id)
  const units: RegistryUnit[] = getUnits(client.id).map((u) => ({ id: u.id, name: u.name }))
  const lines: RegistryLine[] = getLines(client.id).map((l) => ({ id: l.id, unitId: l.unitId, name: l.name, code: l.code }))
  const gateways: RegistryGateway[] = getGateways(client.id).map((g) => ({
    id: g.id,
    unitId: g.unitId,
    name: g.name,
    status: g.status,
    configVersion: g.configVersion,
    serialPorts: serialPortsFor(g.hardware),
  }))

  const rows: MachineRow[] = machines.map((m) => {
    const device = m.deviceId ? getDevice(m.deviceId) : undefined
    const conn: ConnInfo | null = device ? { protocol: device.protocol, ...device.params } : null
    return {
      id: m.id,
      name: m.name,
      code: m.code,
      type: m.type,
      unitId: m.unitId,
      lineId: m.lineId,
      gatewayId: m.gatewayId,
      deviceName: device?.name ?? null,
      conn,
      stateMode: m.stateMode,
      idealCycleS: m.idealCycleS,
      microStopThresholdS: m.microStopThresholdS,
      active: m.active,
      tagCount: getTags({ machineId: m.id }).length,
    }
  })

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageTitle
        title="Cadastro de máquinas"
        description="Identificação, conexão Modbus com o CLP, modo de estado e ciclo ideal de cada máquina."
        actions={
          <Button asChild>
            <Link href={`/${client.slug}/config/maquinas/nova`}>
              <PlusIcon />
              Nova máquina
            </Link>
          </Button>
        }
      />
      <MachineRegistry
        clientSlug={client.slug}
        initialRows={rows}
        units={units}
        lines={lines}
        gateways={gateways}
        machineLimit={client.limits.machines}
      />
    </div>
  )
}
