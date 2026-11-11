import { notFound } from "next/navigation"
import { FactoryIcon, RouterIcon, UsersIcon } from "lucide-react"

import { getAreas, getClientBySlug, getClientUsers, getGateways, getLines, getMachines, getUnits } from "@/lib/mock"
import { PLAN_LABEL } from "@/lib/roles"
import { PageBody } from "@/components/shell/page-header"
import { PlanUsage } from "@/components/config/plan-usage"
import { UnitsManager, type AreaNode, type LineNode, type UnitNode } from "@/components/config/units-manager"

export default async function Page({ params }: PageProps<"/[cliente]/config/unidades">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const machines = getMachines(client.id)
  const gateways = getGateways(client.id)
  const units = getUnits(client.id)

  const unitNodes: UnitNode[] = units.map((u) => ({
    id: u.id,
    name: u.name,
    city: u.city,
    state: u.state,
    timezone: u.timezone,
    gateways: gateways.filter((g) => g.unitId === u.id).map((g) => ({ id: g.id, name: g.name, status: g.status })),
  }))
  const areaNodes: AreaNode[] = units.flatMap((u) => getAreas(u.id).map((a) => ({ id: a.id, unitId: a.unitId, name: a.name })))
  const lineNodes: LineNode[] = getLines(client.id).map((l) => ({
    id: l.id,
    unitId: l.unitId,
    areaId: l.areaId,
    name: l.name,
    code: l.code,
    machineCount: machines.filter((m) => m.lineId === l.id).length,
  }))

  return (
    <PageBody>
      <UnitsManager
        clientSlug={client.slug}
        title="Unidades e linhas"
        description={`Estrutura de ${client.name}: unidade → área → linha → máquinas.`}
        initialUnits={unitNodes}
        initialAreas={areaNodes}
        initialLines={lineNodes}
        summary={
          <PlanUsage
            planLabel={PLAN_LABEL[client.plan]}
            items={[
              { label: "Máquinas", used: machines.length, limit: client.limits.machines, icon: FactoryIcon },
              { label: "Gateways", used: gateways.length, limit: client.limits.gateways, icon: RouterIcon },
              { label: "Usuários", used: getClientUsers(client.id).length, limit: client.limits.users, icon: UsersIcon },
            ]}
            footnote={
              <>
                Retenção de dados: {client.limits.retentionMonths} meses. Para ampliar os limites, fale com a Engemase.
              </>
            }
          />
        }
      />
    </PageBody>
  )
}
