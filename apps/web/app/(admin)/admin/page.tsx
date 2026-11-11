import type { Metadata } from "next"
import Link from "next/link"
import { BellRingIcon, Building2Icon, CalendarClockIcon, CpuIcon, FactoryIcon, PlusIcon } from "lucide-react"

import { MOCK_NOW, getCurrentUser } from "@/lib/mock"
import { date, num, time } from "@/lib/format"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { Button } from "@/components/ui/button"
import { buildPlatformOverview } from "@/components/admin/admin-data"
import { AttentionList, FleetSummary, OverviewClientsTable, RecentActivity } from "@/components/admin/overview-sections"

export const metadata: Metadata = { title: "Console da plataforma" }

export default function Page() {
  const me = getCurrentUser()
  const firstName = me.name.split(" ")[0]
  const d = buildPlatformOverview()
  const c = d.counts
  const weekday = new Date(MOCK_NOW).toLocaleDateString("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" })
  const hour = Number(time(MOCK_NOW).slice(0, 2))
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite"

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      {/* Saudação */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting}, {firstName} 👋
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Veja como estão os clientes, os gateways e os alertas da plataforma agora.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium shadow-xs">
            <CalendarClockIcon className="size-4 text-muted-foreground" />
            <span className="capitalize">{weekday.split("-")[0]}</span> · {date(MOCK_NOW)} · {time(MOCK_NOW)}
          </span>
          <Button asChild>
            <Link href="/admin/clientes/novo">
              <PlusIcon />
              Novo cliente
            </Link>
          </Button>
        </div>
      </div>

      {/* Indicadores */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Building2Icon}
          tone="blue"
          label="Clientes ativos"
          value={
            <>
              {c.active}
              <span className="text-base font-semibold text-muted-foreground"> / {c.clients}</span>
            </>
          }
          hint={`${c.onboarding} implantação · ${c.suspended} suspenso${c.suspended === 1 ? "" : "s"}`}
        />
        <StatCard
          icon={FactoryIcon}
          tone="navy"
          label="Máquinas monitoradas"
          value={num(c.machines)}
          hint={`${c.machinesRunning} produzindo agora`}
        />
        <StatCard
          icon={CpuIcon}
          tone="teal"
          label="Gateways online"
          value={
            <>
              {c.gatewaysOnline}
              <span className="text-base font-semibold text-muted-foreground"> / {c.gateways}</span>
            </>
          }
          hint={`${c.gatewaysOffline} offline · ${c.gatewaysDegraded} com alerta`}
        />
        <StatCard
          icon={BellRingIcon}
          tone="orange"
          label="Alertas abertos"
          value={c.alerts}
          hint={`${c.alertsCritical} ${c.alertsCritical === 1 ? "crítico" : "críticos"} · ${c.alertsUnacked} novos`}
        />
      </div>

      {/* Clientes + frota */}
      <div className="grid gap-4 xl:grid-cols-12">
        <SectionCard title="Clientes" description="OEE do turno corrente e saúde dos gateways" href="/admin/clientes" className="xl:col-span-8">
          <OverviewClientsTable rows={d.rows} />
        </SectionCard>
        <SectionCard title="Frota de gateways" description="Situação agora, em todos os clientes" href="/admin/gateways" className="xl:col-span-4">
          <FleetSummary fleet={d.fleet} versions={d.versions} remote={d.remote} />
        </SectionCard>
      </div>

      {/* Atenção + atividade */}
      <div className="grid gap-4 lg:grid-cols-12">
        <SectionCard
          title="Precisa de atenção"
          description={d.attention.length === 0 ? "Nada pendente" : `${d.attention.length} itens para acompanhar`}
          href="/admin/gateways"
          linkLabel="Ver frota"
          className="lg:col-span-5"
        >
          <AttentionList items={d.attention} />
        </SectionCard>
        <SectionCard title="Atividade recente" description="Auditoria de todos os clientes e da plataforma" href="/admin/auditoria" className="lg:col-span-7">
          <RecentActivity items={d.activity} />
        </SectionCard>
      </div>
    </div>
  )
}
