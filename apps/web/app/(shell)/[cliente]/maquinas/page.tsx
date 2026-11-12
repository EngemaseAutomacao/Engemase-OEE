import Link from "next/link"
import { notFound } from "next/navigation"
import { AlertTriangleIcon, FactoryIcon, GaugeIcon, PackageCheckIcon, PlusIcon } from "lucide-react"

import { aggregateOee, getClientBySlug, getConfigAccess, getLines, getMachinesWithLive, getTimeline, getUnits } from "@/lib/mock"
import { num, pct } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Ring } from "@/components/dashboard/ring"
import { StatCard } from "@/components/dashboard/stat-card"
import { MachineExplorer } from "@/components/monitoring/machine-explorer"
import { currentShift, productionTotals, stateCounts, unclassifiedStops } from "@/components/monitoring/queries"
import { ShiftStatus } from "@/components/monitoring/shift-status"
import { PageTitle } from "@/components/refresh/page-title"

export default async function Page({ params }: PageProps<"/[cliente]/maquinas">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const machines = getMachinesWithLive(client.id)
  const units = getUnits(client.id).filter((u) => machines.some((m) => m.unitId === u.id))
  const lines = getLines(client.id).filter((l) => machines.some((m) => m.lineId === l.id))
  const counts = stateCounts(machines)
  const oee = aggregateOee(machines)
  const production = productionTotals(machines)
  const unplanned = counts.FAULT + counts.STOPPED
  const pendingStops = machines.reduce((s, m) => s + unclassifiedStops(getTimeline(m.id), m.microStopThresholdS).length, 0)

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageTitle
        title="Máquinas"
        description={
          machines.length > 0
            ? `${machines.length} ${machines.length === 1 ? "máquina" : "máquinas"} · estado ao vivo, contagens e OEE do turno corrente`
            : "Estado ao vivo, contagens e OEE do turno corrente"
        }
        actions={<ShiftStatus shift={currentShift()} />}
      />

      {machines.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FactoryIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma máquina cadastrada</EmptyTitle>
            <EmptyDescription>
              {getConfigAccess(client.id).canConfigure
                ? "Cadastre a primeira máquina e vincule-a a um CLP do gateway para começar a medir o OEE."
                : "A equipe Engemase cadastra as máquinas e liga cada uma ao CLP. Elas aparecem aqui assim que a coleta começar."}
            </EmptyDescription>
          </EmptyHeader>
          {getConfigAccess(client.id).canConfigure && (
            <EmptyContent>
              <Button asChild>
                <Link href={`/${client.slug}/config/maquinas/nova`}>
                  <PlusIcon />
                  Cadastrar máquina
                </Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={FactoryIcon}
              tone="teal"
              label="Produzindo agora"
              value={
                <>
                  {counts.RUNNING}
                  <span className="text-base font-semibold text-muted-foreground"> / {machines.length}</span>
                </>
              }
              hint={`${pct(counts.RUNNING / machines.length, 0)} da frota`}
              aside={<Ring value={counts.RUNNING / machines.length} size={52} stroke={6} color="#0e9384" />}
            />
            <StatCard
              icon={GaugeIcon}
              tone="blue"
              label="OEE médio do turno"
              value={oee.machinesWithData > 0 ? pct(oee.oee) : "—"}
              hint={
                oee.machinesWithData > 0
                  ? `D ${pct(oee.availability, 0)} · P ${pct(oee.performance, 0)} · Q ${pct(oee.quality, 0)}`
                  : "Sem dados atualizados no turno"
              }
            />
            <StatCard
              icon={PackageCheckIcon}
              tone="navy"
              label="Peças boas no turno"
              value={num(production.good)}
              hint={`${num(production.reject)} refugadas · meta ${num(production.target)}`}
            />
            <StatCard
              icon={AlertTriangleIcon}
              tone="orange"
              label="Em parada ou falha"
              value={
                <span className={unplanned > 0 ? "text-state-fault" : undefined}>
                  {unplanned}
                  <span className="text-base font-semibold text-muted-foreground"> {unplanned === 1 ? "máquina" : "máquinas"}</span>
                </span>
              }
              hint={pendingStops > 0 ? `${pendingStops} ${pendingStops === 1 ? "parada sem motivo" : "paradas sem motivo"} no turno` : "Todas as paradas classificadas"}
            />
          </div>

          <MachineExplorer
            machines={machines}
            units={units.map((u) => ({ id: u.id, name: u.name }))}
            lines={lines.map((l) => ({ id: l.id, name: l.name, code: l.code, unitId: l.unitId }))}
            clientSlug={client.slug}
          />
        </>
      )}
    </div>
  )
}
