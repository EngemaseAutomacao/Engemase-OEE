"use client"

import { useState } from "react"
import Link from "next/link"
import { BellIcon, BellRingIcon, CheckCheckIcon, SmartphoneIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

export interface BellItem {
  id: string
  severity: "critical" | "warning" | "info"
  title: string
  body: string
  href: string
  ago: string
  read: boolean
}

const SEVERITY_DOT = {
  critical: "bg-state-fault",
  warning: "bg-state-stopped",
  info: "bg-primary",
} as const

/**
 * Notificação de teste. No Chrome do Android `new Notification()` lança "Illegal constructor"
 * (exige service worker), então tenta primeiro pelo service worker registrado.
 */
async function showTestNotification(): Promise<boolean> {
  const title = "Engemase OEE"
  const options: NotificationOptions = {
    body: "Notificações ativadas neste dispositivo. Você receberá os alertas das suas máquinas.",
    icon: "/brand/engemase-icone.png",
    tag: "engemase-teste",
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, options)
      return true
    }
  } catch {
    // segue para o construtor
  }
  try {
    new Notification(title, options)
    return true
  } catch {
    return false
  }
}

/**
 * Sino de notificações (central no app). O push é só um canal de entrega: a central é a fonte da verdade.
 * "Ativar notificações neste dispositivo" pede a permissão do navegador e mostra uma notificação de teste.
 */
export function NotificationBell({ items, allHref }: { items: BellItem[]; allHref: string }) {
  const [list, setList] = useState(items)
  const unread = list.filter((n) => !n.read).length

  async function enablePush() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.info("Este navegador não suporta notificações. No iPhone/iPad, instale o app na Tela de Início (Compartilhar › Adicionar à Tela de Início).")
      return
    }
    let permission: NotificationPermission
    try {
      permission = await Notification.requestPermission()
    } catch {
      toast.error("Não foi possível pedir a permissão de notificações neste navegador.")
      return
    }
    if (permission !== "granted") {
      toast.warning("Permissão negada. Você pode liberar nas configurações do navegador.")
      return
    }
    const shown = await showTestNotification()
    toast.success(shown ? "Notificações ativadas neste dispositivo" : "Permissão concedida. A notificação de teste não pôde ser exibida neste navegador.")
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notificações${unread ? `: ${unread} não lidas` : ""}`}>
          {unread > 0 ? <BellRingIcon className="size-4" /> : <BellIcon className="size-4" />}
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-state-fault px-1 text-[10px] leading-4 font-semibold text-white">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Notificações</span>
            {unread > 0 && <Badge variant="secondary">{unread} novas</Badge>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={unread === 0}
            onClick={() => setList((l) => l.map((n) => ({ ...n, read: true })))}
          >
            <CheckCheckIcon className="size-3.5" />
            Marcar como lidas
          </Button>
        </div>
        <Separator />
        <ScrollArea className="max-h-[360px]">
          {list.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma notificação.</p>
          ) : (
            <ul className="divide-y">
              {list.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    onClick={() => setList((l) => l.map((x) => (x.id === n.id ? { ...x, read: true } : x)))}
                    className={cn("flex gap-3 px-4 py-3 hover:bg-accent", !n.read && "bg-primary/5")}
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY_DOT[n.severity])} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm", !n.read && "font-semibold")}>{n.title}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{n.ago}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <Separator />
        <div className="flex items-center justify-between gap-2 p-2">
          <Button variant="ghost" size="sm" className="text-xs" onClick={enablePush}>
            <SmartphoneIcon className="size-3.5" />
            Ativar neste dispositivo
          </Button>
          <Button asChild variant="outline" size="sm" className="text-xs">
            <Link href={allHref}>Ver todas</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
