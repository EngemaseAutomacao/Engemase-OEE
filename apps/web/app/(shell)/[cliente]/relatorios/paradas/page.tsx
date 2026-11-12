import Link from "next/link"
import { notFound } from "next/navigation"
import { ChartNoAxesCombinedIcon, ListOrderedIcon, RouterIcon } from "lucide-react"

import { MOCK_NOW, getClientBySlug, getLines, getMachines, getUnits } from "@/lib/mock"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { PageTitle } from "@/components/refresh/page-title"
import { SoftLink } from "@/components/refresh/soft-action"
import { addDays } from "@/components/reports/report-utils"
import { buildStopRecords } from "@/components/reports/stops-data"
import { StopsReport } from "@/components/reports/stops-report"

export default async function Page({ params }: PageProps<"/[cliente]/relatorios/paradas">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const allMachines = getMachines(client.id)
  const records = buildStopRecords(allMachines.map((m) => m.id))
  const withData = new Set(records.map((r) => r.machineId))
  const machines = allMachines
    .filter((m) => withData.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, code: m.code, unitId: m.unitId, lineId: m.lineId }))
  const lineIds = new Set(machines.map((m) => m.lineId))
  const unitIds = new Set(machines.map((m) => m.unitId))
  const lines = getLines(client.id)
    .filter((l) => lineIds.has(l.id))
    .map((l) => ({ id: l.id, name: l.name, unitId: l.unitId }))
  const units = getUnits(client.id)
    .filter((u) => unitIds.has(u.id))
    .map((u) => ({ id: u.id, name: u.name }))
  // período fechado até ontem (dia anterior ao "agora" do protótipo)
  const endDate = addDays(MOCK_NOW.slice(0, 10), -1)

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageTitle
        title="Paradas (Pareto)"
        description={`${client.name} · onde a produção está parando: motivos, categorias, MTBF e MTTR.`}
        actions={
          <SoftLink href={`/${client.slug}/relatorios/oee`} tone="blue">
            <ChartNoAxesCombinedIcon />
            Relatório de OEE
          </SoftLink>
        }
      />
      {records.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListOrderedIcon />
            </EmptyMedia>
            <EmptyTitle>Ainda não há paradas registradas</EmptyTitle>
            <EmptyDescription>
              {allMachines.length === 0
                ? "Cadastre as máquinas e vincule cada uma a um CLP de um gateway. As paradas aparecem aqui assim que os eventos de estado começarem a chegar."
                : "Os gateways deste cliente ainda não enviaram eventos de estado. Assim que as máquinas estiverem comunicando, o Pareto de paradas é montado automaticamente."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link href={`/${client.slug}/config/gateways`}>
                <RouterIcon />
                Ver gateways
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <StopsReport clientSlug={client.slug} records={records} machines={machines} units={units} lines={lines} endDate={endDate} />
      )}
    </div>
  )
}
