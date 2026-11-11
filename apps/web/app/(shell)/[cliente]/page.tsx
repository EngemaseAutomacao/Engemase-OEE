import Link from "next/link"
import { notFound } from "next/navigation"
import { FactoryIcon, InfoIcon, PlusIcon } from "lucide-react"

import { aggregateOee, getAreas, getClientBySlug, getGateways, getLines, getMachinesWithLive, getUnits } from "@/lib/mock"
import { GATEWAY_STATUS_LABEL } from "@/lib/roles"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { AlertsPanel } from "@/components/monitoring/alerts-panel"
import { MachineGroups, type UnitGroup } from "@/components/monitoring/machine-groups"
import { OverviewKpis } from "@/components/monitoring/overview-kpis"
import { buildAlerts, currentShift, productionTotals, stateCounts } from "@/components/monitoring/queries"
import { ShiftStatus } from "@/components/monitoring/shift-status"
import { StateSummary } from "@/components/monitoring/state-summary"

export default async function Page({ params }: PageProps<"/[cliente]">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const machines = getMachinesWithLive(client.id)
  const units = getUnits(client.id)
  const lines = getLines(client.id)
  const shift = currentShift()
  const agg = aggregateOee(machines)
  const counts = stateCounts(machines)
  const production = productionTotals(machines)
  const alerts = buildAlerts(client.slug, client.id, machines)

  const groups: UnitGroup[] = units
    .map((u) => {
      const areaName = new Map(getAreas(u.id).map((a) => [a.id, a.name]))
      const unitMachines = machines.filter((m) => m.unitId === u.id)
      const unitAgg = aggregateOee(unitMachines)
      return {
        id: u.id,
        name: u.name,
        location: `${u.city}/${u.state}`,
        oee: unitAgg.oee,
        machinesWithData: unitAgg.machinesWithData,
        machineCount: unitMachines.length,
        lines: lines
          .filter((l) => l.unitId === u.id)
          .map((l) => {
            const lineMachines = unitMachines.filter((m) => m.lineId === l.id)
            const lineAgg = aggregateOee(lineMachines)
            return {
              id: l.id,
              name: l.name,
              code: l.code,
              areaName: areaName.get(l.areaId) ?? "",
              oee: lineAgg.oee,
              machinesWithData: lineAgg.machinesWithData,
              machines: lineMachines,
            }
          })
          .filter((l) => l.machines.length > 0),
      }
    })
    .filter((u) => u.lines.length > 0)

  const gateways = getGateways(client.id)
  const pendingGateways = gateways.filter((g) => g.status === "pending" || g.status === "offline")

  return (
    <PageBody>
      <PageHeader
        title="Visão geral"
        description={`${client.name} · ${units.length} ${units.length === 1 ? "unidade" : "unidades"} · ${machines.length} ${machines.length === 1 ? "máquina" : "máquinas"}`}
        actions={<ShiftStatus shift={shift} />}
      />

      {machines.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FactoryIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma máquina cadastrada</EmptyTitle>
            <EmptyDescription>
              Cadastre as máquinas e vincule cada uma a um CLP (Modbus TCP ou RTU) de um gateway para acompanhar estado e OEE ao vivo.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href={`/${client.slug}/config/maquinas/nova`}>
                <PlusIcon />
                Cadastrar máquina
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {agg.machinesWithData === 0 && (
            <Alert>
              <InfoIcon />
              <AlertTitle>Nenhum dado de produção neste turno</AlertTitle>
              <AlertDescription>
                {pendingGateways.length > 0
                  ? `${pendingGateways.map((g) => `${g.name} (${GATEWAY_STATUS_LABEL[g.status].toLowerCase()})`).join(", ")}: assim que o gateway se conectar e a configuração for publicada, os indicadores aparecem aqui.`
                  : "As máquinas ainda não enviaram contagens no turno atual. Confira a configuração dos gateways e das tags."}
              </AlertDescription>
            </Alert>
          )}

          <OverviewKpis
            oee={agg}
            machinesWithData={agg.machinesWithData}
            machinesTotal={machines.length}
            running={counts.RUNNING}
            production={production}
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <StateSummary counts={counts} />
            <AlertsPanel alerts={alerts} className="lg:col-span-2" />
          </div>

          <MachineGroups units={groups} clientSlug={client.slug} />
        </>
      )}
    </PageBody>
  )
}
