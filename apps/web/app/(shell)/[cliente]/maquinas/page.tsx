import Link from "next/link"
import { notFound } from "next/navigation"
import { FactoryIcon, PlusIcon } from "lucide-react"

import { getClientBySlug, getLines, getMachinesWithLive, getUnits } from "@/lib/mock"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { MachineExplorer } from "@/components/monitoring/machine-explorer"
import { currentShift, stateCounts } from "@/components/monitoring/queries"
import { ShiftStatus } from "@/components/monitoring/shift-status"

export default async function Page({ params }: PageProps<"/[cliente]/maquinas">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const machines = getMachinesWithLive(client.id)
  const units = getUnits(client.id).filter((u) => machines.some((m) => m.unitId === u.id))
  const lines = getLines(client.id).filter((l) => machines.some((m) => m.lineId === l.id))
  const counts = stateCounts(machines)

  return (
    <PageBody>
      <PageHeader
        title="Máquinas"
        description={
          machines.length > 0
            ? `${machines.length} ${machines.length === 1 ? "máquina" : "máquinas"} · ${counts.RUNNING} produzindo agora · OEE e contagens do turno corrente`
            : "Estado ao vivo, contagens e OEE do turno corrente"
        }
        actions={<ShiftStatus shift={currentShift()} />}
      />
      {machines.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FactoryIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma máquina cadastrada</EmptyTitle>
            <EmptyDescription>Cadastre a primeira máquina e vincule-a a um CLP do gateway para começar a medir o OEE.</EmptyDescription>
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
        <MachineExplorer
          machines={machines}
          units={units.map((u) => ({ id: u.id, name: u.name }))}
          lines={lines.map((l) => ({ id: l.id, name: l.name, code: l.code, unitId: l.unitId }))}
          clientSlug={client.slug}
        />
      )}
    </PageBody>
  )
}
