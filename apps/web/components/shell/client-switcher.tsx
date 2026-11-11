"use client"

import Link from "next/link"
import { CheckIcon, ChevronsUpDownIcon, ShieldCheckIcon } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { Brand } from "@/components/shell/brand"

/** Troca de cliente (para quem tem acesso a mais de um) + atalho para o console da plataforma. */
export function ClientSwitcher({
  current,
  clients,
  isPlatform,
}: {
  current: { slug: string; name: string }
  clients: { slug: string; name: string; status: string }[]
  isPlatform: boolean
}) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <Brand subtitle={current.name} />
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64" align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Clientes</DropdownMenuLabel>
            {clients.map((c) => (
              <DropdownMenuItem key={c.slug} asChild>
                <Link href={`/${c.slug}`}>
                  <span className="truncate">{c.name}</span>
                  {c.status === "suspended" && <span className="ml-1 text-xs text-muted-foreground">(suspenso)</span>}
                  {c.slug === current.slug && <CheckIcon className="ml-auto" />}
                </Link>
              </DropdownMenuItem>
            ))}
            {isPlatform && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/admin">
                    <ShieldCheckIcon />
                    Console Engemase
                  </Link>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
