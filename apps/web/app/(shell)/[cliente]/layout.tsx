import { notFound } from "next/navigation"
import { PauseCircleIcon, ShieldCheckIcon } from "lucide-react"

import {
  clientParams,
  getAccessibleClients,
  getClientBranding,
  getClientBySlug,
  getCurrentUser,
  getLines,
  getMachines,
  getNotifications,
  getUnits,
} from "@/lib/mock"
import { ago, initials } from "@/lib/format"
import { CLIENT_ROLE_LABEL, PLATFORM_ROLE_LABEL } from "@/lib/roles"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { ClientSwitcher } from "@/components/shell/client-switcher"
import { HelpButton } from "@/components/shell/help-button"
import { ClientNavMenu } from "@/components/shell/nav-menu"
import { NotificationBell } from "@/components/shell/notification-bell"
import { UnitSelector } from "@/components/shell/unit-selector"
import { UserMenu } from "@/components/shell/user-menu"
import { ThemeToggle } from "@/components/theme-toggle"

export function generateStaticParams() {
  return clientParams()
}

export default async function ClientLayout({ children, params }: LayoutProps<"/[cliente]">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const me = getCurrentUser()
  const membership = me.memberships.find((m) => m.clientId === client.id)
  const roleLabel = me.platformRole ? `Engemase · ${PLATFORM_ROLE_LABEL[me.platformRole]}` : membership ? CLIENT_ROLE_LABEL[membership.role] : ""
  const units = getUnits(client.id)
  const branding = getClientBranding(client.id)
  const firstMachine = getMachines(client.id)[0]
  const firstLine = getLines(client.id)[0]
  const bellItems = getNotifications(client.id).map((n) => ({
    id: n.id,
    severity: n.severity,
    title: n.title,
    body: n.body,
    href: n.href,
    ago: ago(n.at),
    read: n.read,
  }))

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
            clients={getAccessibleClients().map((c) => ({ slug: c.slug, name: c.name, status: c.status }))}
            isPlatform={Boolean(me.platformRole)}
          />
        </SidebarHeader>
        <SidebarContent>
          <ClientNavMenu slug={client.slug} machineId={firstMachine?.id} lineId={firstLine?.id} />
        </SidebarContent>
        <SidebarFooter>
          <UserMenu name={me.name} email={me.email ?? me.username ?? ""} roleLabel={roleLabel} initials={initials(me.name)} isPlatform={Boolean(me.platformRole)} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        {me.platformRole && (
          <div className="flex items-center gap-2 bg-primary px-4 py-1.5 text-xs text-primary-foreground">
            <ShieldCheckIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              Você está acessando <strong>{client.name}</strong> como equipe Engemase ({PLATFORM_ROLE_LABEL[me.platformRole]}). As ações ficam registradas na auditoria.
            </span>
          </div>
        )}
        {client.status === "suspended" && (
          <div className="flex items-center gap-2 bg-state-fault px-4 py-1.5 text-xs text-white">
            <PauseCircleIcon className="size-3.5 shrink-0" />
            Cliente suspenso: usuários do cliente não conseguem entrar. Os dados e os gateways continuam preservados.
          </div>
        )}
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-5" />
          <span className="truncate text-sm font-medium">{client.name}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <UnitSelector units={units.map((u) => ({ id: u.id, name: u.name }))} />
            <HelpButton href={`/${client.slug}/ajuda`} />
            <NotificationBell items={bellItems} allHref={`/${client.slug}/notificacoes`} />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
