"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRightIcon, PlusIcon, SettingsIcon } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { adminNav, clientNav, type NavItem, type NavModel } from "@/components/shell/nav"

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Botões do menu: altura confortável, item ativo destacado como na referência. */
const BUTTON = "h-10 rounded-lg px-3 text-[13px] font-medium text-sidebar-foreground/85 hover:text-white data-[active=true]:bg-white/12 data-[active=true]:text-white data-[active=true]:shadow-[inset_3px_0_0_0_var(--color-sidebar-primary)]"

function Menu({ model }: { model: NavModel }) {
  const pathname = usePathname()
  const configOpen = model.config.some((i) => isActive(pathname, i.href))

  return (
    <>
      <SidebarGroup className="pt-3">
        <SidebarGroupContent>
          <SidebarMenu className="gap-0.5">
            {model.main.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(pathname, item.href, item.exact)} />
            ))}
            {model.config.length > 0 && (
              <Collapsible defaultOpen={configOpen} className="group/collapsible" asChild>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Configurações" isActive={configOpen} className={BUTTON}>
                      <SettingsIcon />
                      <span>Configurações</span>
                      <ChevronRightIcon className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub className="border-white/15">
                      {model.config.map((item) => (
                        <SidebarMenuSubItem key={item.href}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive(pathname, item.href)}
                            className="h-8 text-[13px] text-sidebar-foreground/80 hover:text-white data-[active=true]:bg-white/12 data-[active=true]:text-white"
                          >
                            <Link href={item.href}>
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {model.quick.length > 0 && (
        <SidebarGroup className="mt-1">
          <SidebarGroupLabel className="text-[11px] font-semibold tracking-wide text-sidebar-foreground/60 uppercase">Ações rápidas</SidebarGroupLabel>
          <SidebarGroupAction asChild title="Nova máquina">
            <Link href={model.quick.find((q) => q.title.startsWith("Nov"))?.href ?? model.quick[0].href} aria-label="Criar novo">
              <PlusIcon />
            </Link>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0">
              {model.quick.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title} className="h-8 rounded-lg px-3 text-xs text-sidebar-foreground/75 hover:text-white">
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  )
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.title} className={BUTTON}>
        <Link href={item.href}>
          <item.icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function ClientNavMenu({ slug, machineId, lineId }: { slug: string; machineId?: string; lineId?: string }) {
  return <Menu model={clientNav(slug, { machineId, lineId })} />
}

export function AdminNavMenu() {
  return <Menu model={adminNav} />
}
