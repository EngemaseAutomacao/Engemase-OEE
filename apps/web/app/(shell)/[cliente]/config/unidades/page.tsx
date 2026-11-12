import { notFound } from "next/navigation"
import { FactoryIcon, RouterIcon, UsersIcon } from "lucide-react"

import { getAreas, getClientBySlug, getClientUsers, getConfigAccess, getGateways, getLines, getMachines, getUnits } from "@/lib/mock"
import { PLAN_LABEL } from "@/lib/roles"
import { SectionCard } from "@/components/dashboard/section-card"
import { ConfigAccessProvider, EngemaseManagedNote } from "@/components/config/engemase-managed"
import { UsageMeter, type UsageItem } from "@/components/config/plan-usage"
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

  const usage: UsageItem[] = [
    { label: "Máquinas em uso / contratadas", used: machines.length, limit: client.limits.machines, icon: FactoryIcon },
    { label: "Gateways", used: gateways.length, limit: client.limits.gateways, icon: RouterIcon },
    { label: "Usuários", used: getClientUsers(client.id).length, limit: client.limits.users, icon: UsersIcon },
  ]

  return (
    <ConfigAccessProvider canEdit={getConfigAccess(client.id).canConfigure}>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <EngemaseManagedNote clientSlug={client.slug} subject="Unidades, áreas e linhas" />
        <UnitsManager
          clientSlug={client.slug}
          title="Unidades e linhas"
          description={`Estrutura de ${client.name}: unidade → área → linha → máquinas.`}
          machineLimit={client.limits.machines}
          initialUnits={unitNodes}
          initialAreas={areaNodes}
          initialLines={lineNodes}
          summary={
            <SectionCard
              title={`Plano ${PLAN_LABEL[client.plan]}`}
              description={`Assinatura cobrada por máquina: ${client.limits.machines} máquinas contratadas · retenção de dados de ${client.limits.retentionMonths} meses. Para contratar mais máquinas, fale com a Engemase.`}
              href={`/${client.slug}/ajuda`}
              linkLabel="Falar com a Engemase"
            >
              <div className="grid gap-4 sm:grid-cols-3">
                {usage.map((it) => (
                  <UsageMeter key={it.label} item={it} />
                ))}
              </div>
            </SectionCard>
          }
        />
      </div>
    </ConfigAccessProvider>
  )
}
