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
import { adminNav, clientNav, type NavItem, type NavModel, type NavPerms } from "@/components/shell/nav"

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Botões do menu: altura confortável e transição suave de cor. O item ativo ganha fundo em degradê de vidro e uma
 * barrinha clara à esquerda que "cresce" quando ele passa a ser o ativo (some com o menu recolhido).
 */
const BUTTON =
  "relative h-10 rounded-lg px-3 text-[13px] font-medium text-sidebar-foreground/85 transition-[background-color,color,box-shadow,width,height,padding] duration-200 ease-(--ui-ease) hover:text-white [&>svg]:transition-transform [&>svg]:duration-200 hover:[&>svg]:scale-110 " +
  "before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:scale-y-0 before:rounded-r-full before:bg-(--ui-nav-indicator) before:transition-transform before:duration-300 before:ease-(--ui-ease) group-data-[collapsible=icon]:before:hidden " +
  "data-[active=true]:bg-white/6 data-[active=true]:bg-linear-to-r data-[active=true]:from-white/14 data-[active=true]:to-transparent data-[active=true]:text-white data-[active=true]:shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] data-[active=true]:before:scale-y-100"

/**
 * Ação do botão "+" das ações rápidas: só uma que cria algo ("Nova máquina", "Novo cliente", "Adicionar usuário"…).
 * Sem nenhuma (ex.: supervisor, que não configura nem gerencia usuários), o "+" não aparece.
 */
function createAction(quick: NavItem[]): NavItem | undefined {
  return quick.find((q) => /^(Nov[ao]|Adicionar|Provisionar)\b/.test(q.title))
}

function Menu({ model }: { model: NavModel }) {
  const pathname = usePathname()
  const configOpen = model.config.some((i) => isActive(pathname, i.href))
  const create = createAction(model.quick)

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
                      <ChevronRightIcon className="ml-auto transition-transform duration-300 ease-(--ui-ease) group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                    <SidebarMenuSub className="mt-0.5 border-white/15">
                      {model.config.map((item) => (
                        <SidebarMenuSubItem key={item.href}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive(pathname, item.href)}
                            className="h-8 text-[13px] text-sidebar-foreground/80 transition-[background-color,color] duration-200 hover:text-white data-[active=true]:bg-white/12 data-[active=true]:font-medium data-[active=true]:text-white"
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
          {create && (
            <SidebarGroupAction asChild title={create.title}>
              <Link href={create.href} aria-label={create.title}>
                <PlusIcon />
              </Link>
            </SidebarGroupAction>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0">
              {model.quick.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title} className="h-8 rounded-lg px-3 text-xs text-sidebar-foreground/75 transition-[background-color,color,width,height,padding] duration-200 hover:text-white">
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

export function ClientNavMenu({ slug, machineId, lineId, perms }: { slug: string; machineId?: string; lineId?: string; perms?: NavPerms }) {
  return <Menu model={clientNav(slug, { machineId, lineId }, perms)} />
}

export function AdminNavMenu() {
  return <Menu model={adminNav} />
}
