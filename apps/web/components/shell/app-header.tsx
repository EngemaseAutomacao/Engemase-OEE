"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Building2Icon,
  ChevronDownIcon,
  FactoryIcon,
  LogOutIcon,
  PlusIcon,
  RouterIcon,
  SearchIcon,
  ShieldCheckIcon,
  UserIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { HelpButton } from "@/components/shell/help-button"
import { adminNav, clientNav } from "@/components/shell/nav"
import { NotificationBell, type BellItem } from "@/components/shell/notification-bell"
import { ThemeToggle } from "@/components/theme-toggle"

export interface HeaderUser {
  name: string
  email: string
  roleLabel: string
  initials: string
  isPlatform: boolean
}

export interface SearchEntity {
  label: string
  hint: string
  href: string
  kind: "machine" | "gateway" | "client"
}

/**
 * Cabeçalho do app: busca global (Ctrl/⌘ + K), criação rápida, ajuda, notificações, tema e usuário.
 * `slug` ausente = console da plataforma.
 */
export function AppHeader({
  slug,
  kiosk,
  user,
  bell,
  entities,
  platformNotice,
}: {
  slug?: string
  kiosk?: { machineId?: string; lineId?: string }
  user: HeaderUser
  bell: BellItem[]
  entities: SearchEntity[]
  platformNotice?: string
}) {
  const model = slug ? clientNav(slug, kiosk) : adminNav
  const helpHref = slug ? `/${slug}/ajuda` : "/admin"
  const bellHref = slug ? `/${slug}/notificacoes` : "/admin"

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/75 md:px-6">
      <SidebarTrigger className="-ml-1 text-muted-foreground" />
      <GlobalSearch model={model} entities={entities} />

      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-1.5">
        {platformNotice && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="hidden gap-1 border-primary/20 bg-primary/10 text-primary lg:inline-flex">
                <ShieldCheckIcon className="size-3" />
                Acesso Engemase
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{platformNotice}</TooltipContent>
          </Tooltip>
        )}

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button size="icon" className="size-9 rounded-full shadow-sm" aria-label="Criar">
                  <PlusIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Criar</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Ações rápidas</DropdownMenuLabel>
            {model.quick.map((q) => (
              <DropdownMenuItem key={q.title} asChild>
                <Link href={q.href}>
                  <q.icon />
                  {q.title}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="hidden sm:inline-flex">
          <HelpButton href={helpHref} />
        </span>
        <NotificationBell items={bell} allHref={bellHref} />
        <span className="hidden sm:inline-flex">
          <ThemeToggle />
        </span>

        <span className="mx-1 hidden h-8 w-px bg-border sm:block" />
        <UserChip user={user} />
      </div>
    </header>
  )
}

function GlobalSearch({ model, entities }: { model: ReturnType<typeof clientNav>; entities: SearchEntity[] }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const go = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  const clients = entities.filter((e) => e.kind === "client")
  const machines = entities.filter((e) => e.kind === "machine")
  const gateways = entities.filter((e) => e.kind === "gateway")

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buscar (Ctrl+K)"
        className="flex h-10 w-10 min-w-0 shrink-0 items-center justify-center gap-2 rounded-xl border bg-background text-left text-sm text-muted-foreground shadow-xs transition hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-full sm:max-w-[360px] sm:shrink sm:justify-start sm:px-3"
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="hidden truncate sm:inline">Buscar máquinas, linhas, gateways…</span>
        <Kbd className="ml-auto hidden sm:inline-flex">Ctrl K</Kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Buscar" description="Busque telas, máquinas e gateways">
        <CommandInput placeholder="Digite para buscar…" />
        <CommandList>
          <CommandEmpty>Nada encontrado.</CommandEmpty>
          <CommandGroup heading="Telas">
            {[...model.main, ...model.config].map((i) => (
              <CommandItem key={i.href} value={`tela ${i.title}`} onSelect={() => go(i.href)}>
                <i.icon />
                {i.title}
              </CommandItem>
            ))}
          </CommandGroup>
          {clients.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Clientes">
                {clients.map((c) => (
                  <CommandItem key={c.href} value={`cliente ${c.label} ${c.hint}`} onSelect={() => go(c.href)}>
                    <Building2Icon />
                    <span>{c.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{c.hint}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          {machines.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Máquinas">
                {machines.map((m) => (
                  <CommandItem key={m.href} value={`maquina ${m.label} ${m.hint}`} onSelect={() => go(m.href)}>
                    <FactoryIcon />
                    <span>{m.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{m.hint}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          {gateways.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Gateways">
                {gateways.map((g) => (
                  <CommandItem key={g.href} value={`gateway ${g.label} ${g.hint}`} onSelect={() => go(g.href)}>
                    <RouterIcon />
                    <span>{g.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{g.hint}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  )
}

function UserChip({ user }: { user: HeaderUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-xl px-1.5 py-1 text-left transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Avatar className="size-9">
            <AvatarFallback className="bg-gradient-to-br from-[#257bb4] to-[#1d5a86] text-xs font-semibold text-white">{user.initials}</AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 leading-tight md:grid">
            <span className="truncate text-sm font-semibold">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">{user.roleLabel}</span>
          </span>
          <ChevronDownIcon className={cn("hidden size-4 text-muted-foreground md:block")} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/conta">
            <UserIcon />
            Minha conta
          </Link>
        </DropdownMenuItem>
        {user.isPlatform && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <ShieldCheckIcon />
              Console Engemase
            </Link>
          </DropdownMenuItem>
        )}
        {user.isPlatform && (
          <DropdownMenuItem asChild>
            <Link href="/">
              <FactoryIcon />
              Trocar de cliente
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/login">
            <LogOutIcon />
            Sair
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
