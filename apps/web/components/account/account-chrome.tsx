"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { LucideIcon } from "lucide-react"
import { ArrowLeftIcon, BellIcon, Building2Icon, LockKeyholeIcon, MonitorSmartphoneIcon, PaletteIcon, UserRoundIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/** "Voltar": volta para a página anterior da plataforma; sem histórico, vai para o seletor de clientes. */
export function BackButton({ fallbackHref = "/inicio" }: { fallbackHref?: string }) {
  const router = useRouter()
  return (
    <Button asChild variant="outline" size="sm" className="rounded-lg">
      <Link
        href={fallbackHref}
        onClick={(e) => {
          let sameOrigin = false
          try {
            sameOrigin = Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin
          } catch {
            sameOrigin = false
          }
          if (sameOrigin && window.history.length > 1) {
            e.preventDefault()
            router.back()
          }
        }}
      >
        <ArrowLeftIcon />
        Voltar
      </Link>
    </Button>
  )
}

export const ACCOUNT_SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "perfil", label: "Perfil", icon: UserRoundIcon },
  { id: "seguranca", label: "Senha e 2 etapas", icon: LockKeyholeIcon },
  { id: "sessoes", label: "Sessões", icon: MonitorSmartphoneIcon },
  { id: "aparencia", label: "Aparência", icon: PaletteIcon },
  { id: "clientes", label: "Clientes", icon: Building2Icon },
  { id: "notificacoes", label: "Notificações", icon: BellIcon },
]

/** Índice das seções (lateral no desktop, pílulas roláveis no celular), com a seção visível destacada. */
export function AccountNav() {
  const [active, setActive] = useState(ACCOUNT_SECTIONS[0].id)

  useEffect(() => {
    const els = ACCOUNT_SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => Boolean(el))
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: "-96px 0px -55% 0px", threshold: 0 },
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <nav aria-label="Seções da conta" className="sticky top-14 z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6 lg:top-20 lg:mx-0 lg:self-start lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
      <ul className="flex gap-1.5 overflow-x-auto lg:flex-col lg:gap-1 lg:overflow-visible">
        {ACCOUNT_SECTIONS.map((s) => {
          const on = active === s.id
          return (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                onClick={() => setActive(s.id)}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors lg:h-9 lg:rounded-xl lg:border-transparent lg:text-sm",
                  on
                    ? "border-primary bg-primary text-primary-foreground lg:bg-primary/10 lg:text-primary"
                    : "bg-card text-muted-foreground hover:text-foreground lg:bg-transparent lg:hover:bg-card",
                )}
              >
                <s.icon className="size-4 shrink-0" aria-hidden />
                {s.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
