import { Suspense } from "react"

import { dadosCabecalhoConsole } from "@/lib/data/admin/console"
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

/** Cabeçalho com a pessoa logada (com banco, lê a sessão: fica dentro do <Suspense>). */
async function Cabecalho() {
  const d = await dadosCabecalhoConsole()
  return <AppHeader user={d.user} bell={d.bell} entities={d.entities} />
}

/** Console da plataforma: só para a equipe Engemase (com banco, conferido em cada página e ação). */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
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
      <SidebarInset className="min-w-0 bg-background">
        <Suspense fallback={<div className="h-16 shrink-0 border-b bg-card/90" aria-hidden />}>
          <Cabecalho />
        </Suspense>
        <main className="min-w-0 flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
