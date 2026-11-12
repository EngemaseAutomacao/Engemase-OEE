import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Building2Icon, CpuIcon, FactoryIcon, HistoryIcon, LayoutDashboardIcon, PaletteIcon, ShieldCheckIcon, UsersIcon } from "lucide-react"

import { adminClientParams, getClientById } from "@/lib/mock"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buildClientDetail } from "@/components/admin/admin-data"
import { ClientDetailProvider } from "@/components/admin/client-detail-context"
import { ClientDetailHeader } from "@/components/admin/client-detail-header"
import { AppearanceSection, GatewaysSection, MachinesSection, OeeCard, OverviewStats, UnitsSection, UsersSection } from "@/components/admin/detail-sections"
import { EngemaseAccess } from "@/components/admin/engemase-access"
import { LifecycleTab } from "@/components/admin/lifecycle-tab"
import { ContactsCard, RegistryCard } from "@/components/admin/registry-card"
import { UsageCard } from "@/components/admin/usage-card"

export function generateStaticParams() {
  return adminClientParams()
}

export async function generateMetadata({ params }: PageProps<"/admin/clientes/[clienteId]">): Promise<Metadata> {
  const { clienteId } = await params
  return { title: getClientById(clienteId)?.name ?? "Cliente" }
}

function Count({ n }: { n: number }) {
  return <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">{n}</span>
}

const TRIGGER =
  "h-8 flex-none rounded-lg px-3 text-[13px] data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-primary/15 dark:data-[state=active]:text-primary"

export default async function Page({ params }: PageProps<"/admin/clientes/[clienteId]">) {
  const { clienteId } = await params
  const d = buildClientDetail(clienteId)
  if (!d) notFound()
  const c = d.client

  const engemasePeople = [
    ...d.assignments.filter((a) => a.status === "active").map((a) => ({ name: a.userName, role: `Engenheiro de campo · atribuição até ${a.end}` })),
    ...d.grants.filter((g) => g.status === "active").map((g) => ({ name: g.userName, role: `Suporte · chamado ${g.ticket} até ${g.end}` })),
  ]

  return (
    <ClientDetailProvider
      initialStatus={c.status}
      initialInfo={{
        name: c.name,
        legalName: c.legalName,
        contactName: c.contactName,
        contactEmail: c.contactEmail,
        plan: c.plan,
        limits: c.limits,
      }}
    >
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <ClientDetailHeader slug={c.slug} cnpj={c.cnpj} city={c.city} state={c.state} createdAt={c.createdAt} brandColor={d.branding?.brandColor ?? "#2c4e73"} />

        <Tabs defaultValue="geral" className="gap-4">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList className="h-10 w-max rounded-xl border bg-card p-1 shadow-xs">
              <TabsTrigger value="geral" className={TRIGGER}>
                <LayoutDashboardIcon />
                Visão geral
              </TabsTrigger>
              <TabsTrigger value="unidades" className={TRIGGER}>
                <Building2Icon />
                Unidades <Count n={d.units.length} />
              </TabsTrigger>
              <TabsTrigger value="maquinas" className={TRIGGER}>
                <FactoryIcon />
                Máquinas <Count n={d.machines.length} />
              </TabsTrigger>
              <TabsTrigger value="gateways" className={TRIGGER}>
                <CpuIcon />
                Gateways <Count n={d.gateways.length} />
              </TabsTrigger>
              <TabsTrigger value="usuarios" className={TRIGGER}>
                <UsersIcon />
                Usuários <Count n={d.users.length} />
              </TabsTrigger>
              <TabsTrigger value="engemase" className={TRIGGER}>
                <ShieldCheckIcon />
                Acesso Engemase
              </TabsTrigger>
              <TabsTrigger value="aparencia" className={TRIGGER}>
                <PaletteIcon />
                Aparência
              </TabsTrigger>
              <TabsTrigger value="ciclo" className={TRIGGER}>
                <HistoryIcon />
                Ciclo de vida
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="geral" className="flex flex-col gap-4">
            <OverviewStats s={d.summary} />
            <div className="grid gap-4 xl:grid-cols-12">
              <UsageCard used={d.usage} className="xl:col-span-7" />
              <OeeCard s={d.summary} history={d.oeeHistory} slug={c.slug} className="xl:col-span-5" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <ContactsCard admins={d.admins} engemase={engemasePeople} remotePolicy={d.remotePolicy} />
              <RegistryCard slug={c.slug} cnpj={c.cnpj} city={c.city} state={c.state} createdAt={c.createdAt} />
            </div>
          </TabsContent>

          <TabsContent value="unidades">
            <UnitsSection units={d.units} slug={c.slug} />
          </TabsContent>

          <TabsContent value="maquinas">
            <MachinesSection machines={d.machines} slug={c.slug} limit={c.limits.machines} />
          </TabsContent>

          <TabsContent value="gateways">
            <GatewaysSection gateways={d.gateways} limit={c.limits.gateways} />
          </TabsContent>

          <TabsContent value="usuarios">
            <UsersSection users={d.users} slug={c.slug} limit={c.limits.users} />
          </TabsContent>

          <TabsContent value="engemase">
            <EngemaseAccess
              clientName={c.name}
              now={d.now}
              grants={d.grants}
              assignments={d.assignments}
              supportPeople={d.platformSupport}
              fieldPeople={d.platformField}
              units={d.unitOptions}
              remoteSessions={d.remoteSessions}
              remotePolicy={d.remotePolicy}
            />
          </TabsContent>

          <TabsContent value="aparencia">
            <AppearanceSection branding={d.branding} name={c.name} slug={c.slug} />
          </TabsContent>

          <TabsContent value="ciclo">
            <LifecycleTab checklist={d.checklist} events={d.lifecycle} name={c.name} slug={c.slug} />
          </TabsContent>
        </Tabs>
      </div>
    </ClientDetailProvider>
  )
}
