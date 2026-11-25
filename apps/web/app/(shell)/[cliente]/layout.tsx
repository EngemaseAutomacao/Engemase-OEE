import { notFound } from "next/navigation"
import { Suspense } from "react"
import { PauseCircleIcon } from "lucide-react"

import { clientParams } from "@/lib/mock"
import { carregarCliente, clientesDoSeletor } from "@/lib/data/config/cliente"
import { ago, initials } from "@/lib/format"
import { CLIENT_ROLE_LABEL, PLATFORM_ROLE_LABEL } from "@/lib/roles"
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

/** Sem banco, os clientes simulados são pré-renderizados; com banco, o cliente da URL é lido no pedido. */
export function generateStaticParams() {
  return clientParams()
}

/** Protótipo com dados simulados: navegação pode bloquear (a versão real usará <Suspense>). */
export const instant = false

/**
 * Casca do cliente (menu, cabeçalho, faixa de suspenso). Com banco, passa por `requireTenant`
 * (sem acesso: 404) e por isso fica dentro do <Suspense>.
 */
async function Casca({ params, children }: { params: LayoutProps<"/[cliente]">["params"]; children: React.ReactNode }) {
  const { cliente } = await params
  const loaded = await carregarCliente(cliente)
  if (!loaded) notFound()
  const { r, client } = loaded

  const me = r.getCurrentUser()
  const membership = me.memberships.find((m) => m.clientId === client.id)
  const roleLabel = me.platformRole ? `Engemase · ${PLATFORM_ROLE_LABEL[me.platformRole]}` : membership ? CLIENT_ROLE_LABEL[membership.role] : ""
  const access = r.getConfigAccess(client.id)
  const perms = { canConfigure: access.canConfigure, canManageUsers: access.canManageUsers }
  const branding = r.getClientBranding(client.id)
  const firstMachine = r.getMachines(client.id)[0]
  const firstLine = r.getLines(client.id)[0]
  const bellItems = r.getNotifications(client.id).map((n) => ({
    id: n.id,
    severity: n.severity,
    title: n.title,
    body: n.body,
    href: n.href,
    ago: ago(n.at),
    read: n.read,
  }))
  const entities = [
    ...r.getMachines(client.id).map((m) => ({ kind: "machine" as const, label: m.name, hint: m.code, href: `/${client.slug}/maquinas/${m.id}` })),
    ...r.getGateways(client.id).map((g) => ({ kind: "gateway" as const, label: g.name, hint: g.hostname, href: `/${client.slug}/config/gateways/${g.id}` })),
  ]
  const clients = await clientesDoSeletor(loaded)

  return (
    <SidebarProvider>
      {branding && (
        // Identidade visual do cliente (docs/14): tokens já calculados no servidor; cores de estado não mudam.
        <style>{`html:root{--primary:${branding.tokens.light.primary};--ring:${branding.tokens.light.ring};--sidebar:${branding.tokens.light.sidebar};--sidebar-primary:${branding.tokens.light.primary};--sidebar-accent:color-mix(in oklab,${branding.tokens.light.sidebar} 82%,white);--sidebar-border:color-mix(in oklab,${branding.tokens.light.sidebar} 80%,white)}html.dark{--primary:${branding.tokens.dark.primary};--ring:${branding.tokens.dark.ring};--sidebar:${branding.tokens.dark.sidebar};--sidebar-primary:${branding.tokens.dark.primary};--sidebar-accent:color-mix(in oklab,${branding.tokens.dark.sidebar} 85%,white)}`}</style>
      )}
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <ClientSwitcher current={{ slug: client.slug, name: client.name }} clients={clients} isPlatform={Boolean(me.platformRole)} />
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
          user={{ name: me.name, email: me.email ?? me.username ?? "", roleLabel, initials: initials(me.name), isPlatform: Boolean(me.platformRole) }}
          bell={bellItems}
          entities={entities}
          platformNotice={
            me.platformRole
              ? `Você está acessando ${client.name} como equipe Engemase (${PLATFORM_ROLE_LABEL[me.platformRole]}). As ações ficam registradas na auditoria visível ao cliente.`
              : undefined
          }
        />
        <main className="min-w-0 flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function CascaCarregando() {
  return (
    <div className="flex min-h-svh" aria-busy="true" aria-label="Carregando">
      <div className="hidden w-64 shrink-0 border-r bg-sidebar p-3 md:block">
        <Skeleton className="h-10 rounded-lg" />
      </div>
      <div className="flex-1">
        <div className="h-16 border-b bg-card/90" />
      </div>
    </div>
  )
}

export default function ClientLayout({ children, params }: LayoutProps<"/[cliente]">) {
  return (
    <Suspense fallback={<CascaCarregando />}>
      <Casca params={params}>{children}</Casca>
    </Suspense>
  )
}
