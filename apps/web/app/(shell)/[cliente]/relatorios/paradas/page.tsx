import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { ChartNoAxesCombinedIcon, ListOrderedIcon, RouterIcon } from "lucide-react"

import { getClientData } from "@/lib/data/cliente"
import { DEFAULT_TZ } from "@/lib/mock"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { PageTitle } from "@/components/refresh/page-title"
import { SoftLink } from "@/components/refresh/soft-action"
import { addDays } from "@/components/reports/report-utils"
import { StopsReport } from "@/components/reports/stops-report"
import { PageSkeleton } from "@/components/shell/page-skeleton"

export const metadata: Metadata = { title: "Paradas (Pareto)" }

export default function Page({ params }: PageProps<"/[cliente]/relatorios/paradas">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={2} />}>
      <Report params={params} />
    </Suspense>
  )
}

async function Report({ params }: { params: PageProps<"/[cliente]/relatorios/paradas">["params"] }) {
  const { cliente } = await params
  const data = await getClientData(cliente, { paradas: true })
  const { client } = data

  const allMachines = data.machines
  const records = data.getStopRecords(allMachines.map((m) => m.id))
  const withData = new Set(records.map((r) => r.machineId))
  const machines = allMachines
    .filter((m) => withData.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, code: m.code, unitId: m.unitId, lineId: m.lineId }))
  const lineIds = new Set(machines.map((m) => m.lineId))
  const unitIds = new Set(machines.map((m) => m.unitId))
  const lines = data.lines
    .filter((l) => lineIds.has(l.id))
    .map((l) => ({ id: l.id, name: l.name, unitId: l.unitId }))
  const units = data.units
    .filter((u) => unitIds.has(u.id))
    .map((u) => ({ id: u.id, name: u.name }))
  // período fechado até ontem (dia anterior ao "agora" do protótipo)
  const endDate = addDays(new Date(data.nowMs).toLocaleDateString("en-CA", { timeZone: DEFAULT_TZ }), -1)

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
                ? data.access.canConfigure
                  ? "Cadastre as máquinas e vincule cada uma a um CLP de um gateway. As paradas aparecem aqui assim que os eventos de estado começarem a chegar."
                  : "A equipe Engemase cadastra as máquinas e liga cada uma ao CLP. As paradas aparecem aqui assim que os eventos de estado começarem a chegar."
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
