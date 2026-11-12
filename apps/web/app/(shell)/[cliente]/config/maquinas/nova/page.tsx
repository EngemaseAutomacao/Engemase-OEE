import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, LockIcon } from "lucide-react"

import { getAreas, getClientBySlug, getConfigAccess, getDevices, getGateways, getLines, getMachines, getTags, getUnits } from "@/lib/mock"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ConfigAccessProvider, EngemaseManagedNote } from "@/components/config/engemase-managed"
import { MACHINE_TYPES, STATE_MODE_LABEL, ttyFromSerial, ttyPortsFor } from "@/components/config/labels"
import { NewMachineWizard } from "@/components/config/new-machine-wizard"
import type { MachineTemplate, WizardDevice, WizardGateway, WizardLine, WizardUnit } from "@/components/config/wizard-model"

export default async function Page({ params }: PageProps<"/[cliente]/config/maquinas/nova">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const units: WizardUnit[] = getUnits(client.id).map((u) => ({ id: u.id, name: u.name }))
  const lines: WizardLine[] = getLines(client.id).map((l) => ({
    id: l.id,
    unitId: l.unitId,
    areaName: getAreas(l.unitId).find((a) => a.id === l.areaId)?.name ?? "Sem área",
    name: l.name,
    code: l.code,
  }))

  const rawGateways = getGateways(client.id)
  const gateways: WizardGateway[] = rawGateways.map((g) => ({
    id: g.id,
    unitId: g.unitId,
    name: g.name,
    hostname: g.hostname,
    status: g.status,
    configVersion: g.configVersion,
    serialPorts: ttyPortsFor(g.hardware),
    ipOt: g.ipOt,
  }))
  const devices: WizardDevice[] = rawGateways.flatMap((g) =>
    getDevices(g.id).map((d) => ({
      id: d.id,
      gatewayId: d.gatewayId,
      name: d.name,
      protocol: d.protocol,
      host: d.params.host,
      port: d.params.port,
      serialPort: ttyFromSerial(d.params.serialPort),
      baudRate: d.params.baudRate,
      parity: d.params.parity,
      dataBits: d.params.dataBits,
      stopBits: d.params.stopBits,
      unitId: d.params.unitId,
    })),
  )

  const machines = getMachines(client.id)
  // "Copiar de máquina igual": sinais e regras das máquinas já mapeadas.
  const machineTemplates: MachineTemplate[] = machines.flatMap((m) => {
    const tags = getTags({ machineId: m.id })
    if (tags.length === 0) return []
    return [
      {
        id: `tpl_${m.id}`,
        label: `${m.name} (${m.code})`,
        description: `${tags.length} sinais · ${STATE_MODE_LABEL[m.stateMode]}`,
        machineType: m.type,
        stateMode: m.stateMode,
        idealCycleS: m.idealCycleS,
        tags: tags.map((t) => ({ name: t.name, role: t.role, area: t.area, address: t.address, dataType: t.dataType, byteOrder: t.byteOrder, pollMs: t.pollMs })),
      },
    ]
  })
  const machineTypes = [...new Set([...MACHINE_TYPES, ...machines.map((m) => m.type)])]

  const access = getConfigAccess(client.id)

  return (
    <ConfigAccessProvider canEdit={access.canConfigure}>
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <EngemaseManagedNote clientSlug={client.slug} subject="Máquinas, conexões com os CLPs e sinais" />
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            <Link href={`/${client.slug}/config/maquinas`} className="hover:text-primary">
              Cadastro de máquinas
            </Link>{" "}
            / Nova máquina
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">Nova máquina</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {access.canConfigure
              ? `Cadastre, conecte ao CLP por Modbus e ative a coleta de OEE em ${client.name}, sem SSH e sem desenvolvedor.`
              : `Máquinas novas em ${client.name} são cadastradas pela equipe Engemase.`}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/${client.slug}/config/maquinas`}>
            <ArrowLeftIcon />
            Voltar ao cadastro
          </Link>
        </Button>
      </div>

      {access.canConfigure ? (
      <NewMachineWizard
        clientSlug={client.slug}
        clientName={client.name}
        units={units}
        lines={lines}
        gateways={gateways}
        devices={devices}
        existingCodes={machines.map((m) => m.code)}
        machineTypes={machineTypes}
        machineTemplates={machineTemplates}
        machineCount={machines.length}
        machineLimit={client.limits.machines}
      />
      ) : (
        <Empty className="rounded-2xl border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockIcon />
            </EmptyMedia>
            <EmptyTitle>Cadastro de máquinas é feito pela Engemase</EmptyTitle>
            <EmptyDescription>
              Conectar o CLP, mapear os sinais e ativar a coleta é trabalho da equipe Engemase. Abra um chamado com a máquina, a linha e o modelo do CLP.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href={`/${client.slug}/ajuda`}>Abrir chamado</Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </div>
    </ConfigAccessProvider>
  )
}
