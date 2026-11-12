import type { Metadata } from "next"
import Link from "next/link"
import { Building2Icon, CalendarClockIcon, FactoryIcon, HourglassIcon, LogOutIcon, RouterIcon } from "lucide-react"

import {
  MOCK_NOW,
  getAccessibleClients,
  getClientBranding,
  getClientSummary,
  getCurrentUser,
  getGateways,
  getMachinesWithLive,
  getUnits,
} from "@/lib/mock"
import { ago, dateTime, initials, num, time } from "@/lib/format"
import { GATEWAY_STATUS_LABEL, PLATFORM_ROLE_LABEL } from "@/lib/roles"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/dashboard/stat-card"
import { BrandLogo, BrandWatermark } from "@/components/shell/brand"
import { ThemeToggle } from "@/components/theme-toggle"
import { ClientPicker, type ClientPickerItem } from "@/components/kiosk/client-picker"
import { ConsoleShortcut } from "@/components/kiosk/console-shortcut"
import { PageTitle } from "@/components/refresh/page-title"

export const metadata: Metadata = { title: "Escolha o cliente" }

/** Azul Engemase: cor do avatar quando o cliente não tem identidade visual própria (docs/14). */
const DEFAULT_BRAND = "#257bb4"

function greeting(iso: string) {
  const hour = Number(time(iso).slice(0, 2))
  if (hour < 12) return "Bom dia"
  if (hour < 18) return "Boa tarde"
  return "Boa noite"
}

export default function Page() {
  const me = getCurrentUser()
  const clients = getAccessibleClients()
  const roleLabel = me.platformRole ? PLATFORM_ROLE_LABEL[me.platformRole] : null

  const items: ClientPickerItem[] = clients.map((c) => {
    const summary = getClientSummary(c.id)
    const machines = getMachinesWithLive(c.id)
    const gateways = getGateways(c.id)
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      legalName: c.legalName,
      initials: initials(c.name),
      brandColor: getClientBranding(c.id)?.brandColor ?? DEFAULT_BRAND,
      city: c.city,
      state: c.state,
      status: c.status,
      plan: c.plan,
      machinesContracted: c.limits.machines,
      unitNames: getUnits(c.id).map((u) => u.name),
      machines: summary.machines,
      running: summary.running,
      faults: machines.filter((m) => m.live?.state === "FAULT").length,
      noComm: machines.filter((m) => m.live?.state === "NO_COMM").length,
      gateways: summary.gateways,
      gatewaysOnline: summary.gatewaysOnline,
      problemGateways: gateways
        .filter((g) => g.status === "offline" || g.status === "degraded")
        .map((g) => ({
          name: g.name,
          statusLabel: GATEWAY_STATUS_LABEL[g.status],
          lastSeen: g.status === "offline" ? `sem sinal ${ago(g.lastSeen)}` : `visto ${ago(g.lastSeen)}`,
        })),
      pendingGateways: gateways.filter((g) => g.status === "pending").length,
      oee: summary.oee.machinesWithData > 0 ? summary.oee.oee : null,
      machinesWithData: summary.oee.machinesWithData,
    }
  })

  const allGateways = getGateways()
  const totalMachines = items.reduce((s, i) => s + i.machines, 0)
  const totalRunning = items.reduce((s, i) => s + i.running, 0)
  const onboarding = clients.filter((c) => c.status === "onboarding").length
  const activeClients = clients.filter((c) => c.status === "active").length
  const problemGateways = allGateways.filter((g) => g.status === "offline" || g.status === "degraded").length
  const pendingGateways = allGateways.filter((g) => g.status === "pending").length

  const firstName = me.name.split(" ")[0]

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip bg-background">
      {/* Marca d'água decorativa da Engemase */}
      <BrandWatermark className="absolute top-16 -right-28 -z-10 w-[360px] sm:w-[480px] lg:-right-16 lg:w-[620px]" />

      <header className="sticky top-0 z-20 border-b bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
          <Link href="/" aria-label="Engemase OEE · início" className="shrink-0 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <BrandLogo width={112} priority />
          </Link>
          <span aria-hidden className="hidden h-8 border-l sm:block" />
          <span className="hidden text-sm leading-tight font-semibold text-muted-foreground sm:block">
            Plataforma
            <br />
            de OEE
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="mr-1 hidden items-center gap-2.5 sm:flex">
              <div className="grid text-right leading-tight">
                <span className="text-sm font-semibold">{me.name}</span>
                <span className="text-xs text-muted-foreground">{roleLabel ? `Engemase · ${roleLabel}` : me.email}</span>
              </div>
              <Avatar className="size-9">
                <AvatarFallback className="bg-[#2c4e73] text-xs font-semibold text-white">{initials(me.name)}</AvatarFallback>
              </Avatar>
            </div>
            <ThemeToggle />
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login" aria-label="Sair">
                <LogOutIcon />
                <span className="hidden sm:inline">Sair</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
          <PageTitle
            title={`${greeting(MOCK_NOW)}, ${firstName} 👋`}
            description={
              me.platformRole
                ? `Como equipe Engemase, você acessa os ${clients.length} clientes da plataforma; cada cliente vê apenas os próprios dados.`
                : "Escolha o cliente que deseja acompanhar."
            }
            actions={
              <span className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium shadow-xs">
                <CalendarClockIcon className="size-4 text-muted-foreground" />
                Hoje · {dateTime(MOCK_NOW).replace(" ", " · ")}
              </span>
            }
          />

          {me.platformRole && roleLabel && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard icon={Building2Icon} tone="blue" label="Clientes" value={num(clients.length)} hint={`${activeClients} ativos na plataforma`} />
                <StatCard
                  icon={HourglassIcon}
                  tone="teal"
                  label="Em implantação"
                  value={num(onboarding)}
                  hint={pendingGateways > 0 ? `${pendingGateways} ${pendingGateways === 1 ? "gateway aguardando" : "gateways aguardando"} ativação` : "Nenhum gateway pendente"}
                />
                <StatCard
                  icon={FactoryIcon}
                  tone="navy"
                  label="Máquinas monitoradas"
                  value={num(totalMachines)}
                  hint={`${num(totalRunning)} produzindo agora`}
                />
                <StatCard
                  icon={RouterIcon}
                  tone="orange"
                  label="Gateways com problema"
                  value={
                    <span className={problemGateways > 0 ? "text-state-fault" : undefined}>
                      {num(problemGateways)}
                      <span className="text-base font-semibold text-muted-foreground"> / {num(allGateways.length)}</span>
                    </span>
                  }
                  hint={problemGateways > 0 ? "Offline ou com alertas" : "Todos online"}
                />
              </div>
              <ConsoleShortcut roleLabel={roleLabel} />
            </>
          )}

          <ClientPicker items={items} consoleHref={me.platformRole ? "/admin/clientes" : undefined} />
        </div>
      </main>

      <footer className="border-t bg-card/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-6">
          <span>Engemase Engenharia · Plataforma de OEE</span>
          <span>Protótipo com dados simulados · referência {dateTime(MOCK_NOW)} (horário de Brasília)</span>
        </div>
      </footer>
    </div>
  )
}
