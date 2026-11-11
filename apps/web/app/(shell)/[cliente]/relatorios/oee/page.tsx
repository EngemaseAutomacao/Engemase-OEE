import Link from "next/link"
import { notFound } from "next/navigation"
import { ChartNoAxesCombinedIcon, RouterIcon } from "lucide-react"

import { getClientBySlug, getLines, getMachines, getShiftHistory, getUnits } from "@/lib/mock"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { OeeReport } from "@/components/reports/oee-report"

/** Histórico carregado: 28 dias = período máximo do filtro (14) + período anterior para comparação. */
const HISTORY_DAYS = 28

export default async function Page({ params }: PageProps<"/[cliente]/relatorios/oee">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const allMachines = getMachines(client.id)
  const rows = getShiftHistory(
    allMachines.map((m) => m.id),
    HISTORY_DAYS,
  )
  const withData = new Set(rows.map((r) => r.machineId))
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

  return (
    <PageBody>
      <PageHeader
        title="Relatório de OEE"
        description={`${client.name} · OEE por período, turno e máquina, calculado a partir dos turnos fechados (até ontem).`}
      />
      {rows.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartNoAxesCombinedIcon />
            </EmptyMedia>
            <EmptyTitle>Ainda não há turnos fechados</EmptyTitle>
            <EmptyDescription>
              {allMachines.length === 0
                ? "Cadastre as máquinas e vincule cada uma a um CLP de um gateway. O relatório aparece depois do primeiro turno completo com dados."
                : "As máquinas ainda não enviaram contagens e eventos de estado. Assim que o gateway estiver online e o primeiro turno fechar, o relatório é gerado automaticamente."}
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
        <OeeReport clientSlug={client.slug} rows={rows} machines={machines} units={units} lines={lines} />
      )}
    </PageBody>
  )
}
