import { Suspense } from "react"
import { PauseCircleIcon } from "lucide-react"

import { getClientData } from "@/lib/data/cliente"
import { clientParams } from "@/lib/mock"
import { ago, initials } from "@/lib/format"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { AppHeader } from "@/components/shell/app-header"
import { ClientSwitcher } from "@/components/shell/client-switcher"
import { HelpCard } from "@/components/shell/help-card"
import { ClientNavMenu } from "@/components/shell/nav-menu"

/**
 * Fica a lista da demonstração: as telas de configuração ainda simuladas (turnos, produtos, motivos,
 * usuários, terminais, aparência, auditoria) são pré-renderizadas com ela. Com banco, os clientes reais
 * são renderizados no pedido (`dynamicParams`).
 */
export function generateStaticParams() {
  return clientParams()
}

/**
 * As telas de acompanhamento e as de cadastro da W8 (unidades, máquinas, nova máquina, gateways e detalhe)
 * já leem os dados dentro de `<Suspense>`; as demais de `config/*` ainda leem `params` fora dele. Sai
 * quando elas também tiverem `<Suspense>` (junto com o `generateStaticParams`).
 */
export const instant = false

/** Esqueleto do menu e do cabeçalho enquanto a sessão e o cliente são conferidos. */
function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-64 shrink-0 flex-col gap-3 border-r bg-sidebar p-3 md:flex">
        <Skeleton className="h-12 rounded-xl" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-8 rounded-lg" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Skeleton className="h-16 rounded-none" />
        <div className="grid gap-4 p-4 md:p-6">
          <Skeleton className="h-10 w-64" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

export default function ClientLayout({ children, params }: LayoutProps<"/[cliente]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <ClientShell params={params}>{children}</ClientShell>
    </Suspense>
  )
}

/** Menu, cabeçalho e sino com os dados do cliente (banco com a sessão, ou simulados). */
async function ClientShell({ children, params }: { children: React.ReactNode; params: LayoutProps<"/[cliente]">["params"] }) {
  const { cliente } = await params
  const data = await getClientData(cliente, { somenteCadastro: true, notificacoes: true })
  const { client, viewer: me, access, branding } = data
  const perms = { canConfigure: access.canConfigure, canManageUsers: access.canManageUsers }
  const firstMachine = data.machines[0]
  const firstLine = data.lines[0]
  const bellItems = data.getNotifications().map((n) => ({
    id: n.id,
    severity: n.severity,
    title: n.title,
    body: n.body,
    href: n.href,
    ago: ago(n.at, data.now),
    read: n.read,
  }))
  const entities = [
    ...data.machines.map((m) => ({ kind: "machine" as const, label: m.name, hint: m.code, href: `/${client.slug}/maquinas/${m.id}` })),
    ...data.gateways.map((g) => ({ kind: "gateway" as const, label: g.name, hint: g.hostname, href: `/${client.slug}/config/gateways/${g.id}` })),
  ]

  return (
    <SidebarProvider>
      {branding && (
        // Identidade visual do cliente (docs/14): tokens já calculados no servidor; cores de estado não mudam.
        <style>{`html:root{--primary:${branding.tokens.light.primary};--ring:${branding.tokens.light.ring};--sidebar:${branding.tokens.light.sidebar};--sidebar-primary:${branding.tokens.light.primary};--sidebar-accent:color-mix(in oklab,${branding.tokens.light.sidebar} 82%,white);--sidebar-border:color-mix(in oklab,${branding.tokens.light.sidebar} 80%,white)}html.dark{--primary:${branding.tokens.dark.primary};--ring:${branding.tokens.dark.ring};--sidebar:${branding.tokens.dark.sidebar};--sidebar-primary:${branding.tokens.dark.primary};--sidebar-accent:color-mix(in oklab,${branding.tokens.dark.sidebar} 85%,white)}`}</style>
      )}
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <ClientSwitcher
            current={{ slug: client.slug, name: client.name }}
            clients={[...data.accessibleClients]}
            isPlatform={me.isPlatform}
          />
        </SidebarHeader>
        <SidebarContent>
          <ClientNavMenu slug={client.slug} machineId={firstMachine?.id} lineId={firstLine?.id} perms={perms} />
        </SidebarContent>
        <SidebarFooter className="p-3">
          <HelpCard href={`/${client.slug}/ajuda`} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0 bg-background">
        {client.status === "suspended" && (
          <div className="flex items-center gap-2 bg-state-fault px-4 py-1.5 text-xs text-white">
            <PauseCircleIcon className="size-3.5 shrink-0" />
            Cliente suspenso: usuários do cliente não conseguem entrar. Os dados e os gateways continuam preservados.
          </div>
        )}
        <AppHeader
          slug={client.slug}
          kiosk={{ machineId: firstMachine?.id, lineId: firstLine?.id }}
          perms={perms}
          user={{ name: me.name, email: me.email, roleLabel: me.roleLabel, initials: initials(me.name), isPlatform: me.isPlatform }}
          bell={bellItems}
          entities={entities}
          platformNotice={
            me.isPlatform
              ? `Você está acessando ${client.name} como equipe Engemase (${me.roleLabel.replace(/^Engemase · /, "")}). As ações ficam registradas na auditoria visível ao cliente.`
              : undefined
          }
        />
        <main data-entrada className="min-w-0 flex-1">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
