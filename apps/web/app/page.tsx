import type { Metadata } from "next"
import Link from "next/link"
import { LogOutIcon } from "lucide-react"

import {
  MOCK_NOW,
  getAccessibleClients,
  getClientSummary,
  getCurrentUser,
  getGateways,
  getMachinesWithLive,
  getUnits,
} from "@/lib/mock"
import { ago, dateTime, initials, time } from "@/lib/format"
import { GATEWAY_STATUS_LABEL, PLATFORM_ROLE_LABEL } from "@/lib/roles"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Brand } from "@/components/shell/brand"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { ThemeToggle } from "@/components/theme-toggle"
import { ClientPicker, type ClientPickerItem } from "@/components/kiosk/client-picker"
import { ConsoleShortcut } from "@/components/kiosk/console-shortcut"

export const metadata: Metadata = { title: "Escolha o cliente" }

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
      city: c.city,
      state: c.state,
      status: c.status,
      plan: c.plan,
      management: c.management,
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
  const consoleStats = [
    { label: "Clientes", value: clients.length },
    { label: "Em implantação", value: clients.filter((c) => c.status === "onboarding").length },
    { label: "Máquinas", value: items.reduce((s, i) => s + i.machines, 0) },
    {
      label: "Gateways com problema",
      value: allGateways.filter((g) => g.status === "offline" || g.status === "degraded").length,
      alert: true,
    },
  ]

  const firstName = me.name.split(" ")[0]

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
          <Brand subtitle="Plataforma de OEE" />
          <div className="ml-auto flex items-center gap-1.5">
            <div className="mr-1 hidden items-center gap-2 sm:flex">
              <div className="grid text-right leading-tight">
                <span className="text-sm font-medium">{me.name}</span>
                <span className="text-xs text-muted-foreground">{roleLabel ? `Engemase · ${roleLabel}` : me.email}</span>
              </div>
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials(me.name)}</AvatarFallback>
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
        <PageBody className="mx-auto w-full max-w-6xl">
          <PageHeader
            title="Escolha o cliente"
            description={
              me.platformRole
                ? `${greeting(MOCK_NOW)}, ${firstName}. Como equipe Engemase, você acessa todos os ${clients.length} clientes da plataforma; cada cliente vê apenas os próprios dados.`
                : `${greeting(MOCK_NOW)}, ${firstName}. Selecione o cliente que deseja acompanhar.`
            }
          />

          {me.platformRole && roleLabel && <ConsoleShortcut roleLabel={roleLabel} stats={consoleStats} />}

          <ClientPicker items={items} />
        </PageBody>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-6">
          <span>Engemase Automação · Plataforma de OEE</span>
          <span>Protótipo com dados simulados · referência {dateTime(MOCK_NOW)} (horário de Brasília)</span>
        </div>
      </footer>
    </div>
  )
}
