import { getAuditLog, getClients, getCurrentUser, getGateways } from "@/lib/mock"
import { initials } from "@/lib/format"
import { PLATFORM_ROLE_LABEL } from "@/lib/roles"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar"
import { AppHeader } from "@/components/shell/app-header"
import { Brand } from "@/components/shell/brand"
import { HelpCard } from "@/components/shell/help-card"
import { AdminNavMenu } from "@/components/shell/nav-menu"

/** Console da plataforma: só para a equipe Engemase. */
/** Protótipo com dados simulados: navegação pode bloquear (a versão real usará <Suspense>). */
export const instant = false

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  const me = getCurrentUser()
  const entities = [
    ...getClients().map((c) => ({ kind: "client" as const, label: c.name, hint: `${c.city}/${c.state}`, href: `/admin/clientes/${c.id}` })),
    ...getGateways().map((g) => ({ kind: "gateway" as const, label: g.name, hint: g.hostname, href: `/${getClients().find((c) => c.id === g.clientId)?.slug}/config/gateways/${g.id}` })),
  ]
  const bell = getAuditLog()
    .slice(0, 5)
    .map((a) => ({ id: a.id, severity: "info" as const, title: a.entityName, body: a.details ?? a.action, href: "/admin/auditoria", ago: "", read: true }))
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem className="px-2 py-1.5">
              <Brand subtitle="Console da plataforma" />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <AdminNavMenu />
        </SidebarContent>
        <SidebarFooter className="p-3">
          <HelpCard href="/admin" />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="bg-background">
        <AppHeader
          user={{
            name: me.name,
            email: me.email ?? "",
            roleLabel: me.platformRole ? `Engemase · ${PLATFORM_ROLE_LABEL[me.platformRole]}` : "",
            initials: initials(me.name),
            isPlatform: true,
          }}
          bell={bell}
          entities={entities}
        />
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
