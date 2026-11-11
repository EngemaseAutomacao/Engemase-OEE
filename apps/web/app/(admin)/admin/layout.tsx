import { ShieldCheckIcon } from "lucide-react"

import { getCurrentUser } from "@/lib/mock"
import { initials } from "@/lib/format"
import { PLATFORM_ROLE_LABEL } from "@/lib/roles"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
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
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Brand } from "@/components/shell/brand"
import { AdminNavMenu } from "@/components/shell/nav-menu"
import { UserMenu } from "@/components/shell/user-menu"
import { ThemeToggle } from "@/components/theme-toggle"

/** Console da plataforma: só para a equipe Engemase. */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  const me = getCurrentUser()
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
        <SidebarFooter>
          <UserMenu
            name={me.name}
            email={me.email ?? ""}
            roleLabel={me.platformRole ? `Engemase · ${PLATFORM_ROLE_LABEL[me.platformRole]}` : ""}
            initials={initials(me.name)}
            isPlatform
          />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-5" />
          <span className="text-sm font-medium">Console Engemase</span>
          <Badge variant="secondary" className="gap-1">
            <ShieldCheckIcon className="size-3" />
            Acesso de plataforma
          </Badge>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
