"use client"

import Link from "next/link"
import { InboxIcon, PlusIcon, ShieldAlertIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { SectionCard } from "@/components/dashboard/section-card"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { PRIORITY_META, TICKET_STATUS_META } from "./help-meta"
import { useHelp } from "./help-provider"

/** Chamados recentes do cliente (os abertos nesta sessão aparecem no topo). */
export function TicketsCard({ pendingRemote, remoteHref }: { pendingRemote: number; remoteHref: string }) {
  const { tickets, openTicket } = useHelp()
  const active = tickets.filter((t) => t.status !== "resolved").length

  return (
    <SectionCard
      title="Seus chamados"
      description={tickets.length ? `${active} em andamento · ${tickets.length} no total` : "Acompanhe aqui os atendimentos"}
      action={
        <Button variant="ghost" size="xs" className="shrink-0 font-semibold text-primary" onClick={() => openTicket()}>
          <PlusIcon />
          Novo
        </Button>
      }
    >
      {tickets.length > 0 ? (
        <ul className="divide-y">
          {tickets.slice(0, 5).map((t) => {
            const st = TICKET_STATUS_META[t.status]
            return (
              <li key={t.id} className="grid gap-1 py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-muted-foreground">{t.number}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.className)}>{st.label}</span>
                  {t.priority !== "normal" && (
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", PRIORITY_META[t.priority].className)}>{PRIORITY_META[t.priority].label}</span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">{t.openedLabel}</span>
                </div>
                <div className="line-clamp-1 text-sm font-medium">{t.subject}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t.target ?? "Geral"} · {t.owner}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <Empty className="p-4 md:p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum chamado</EmptyTitle>
            <EmptyDescription>Quando você abrir um chamado, ele aparece aqui com o andamento.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {pendingRemote > 0 && (
        <Link
          href={remoteHref}
          className="mt-3 flex items-center gap-3 rounded-xl border border-[#e96549]/30 bg-[#e96549]/8 p-3 text-sm transition hover:bg-[#e96549]/12"
        >
          <ShieldAlertIcon className="size-4 shrink-0 text-[#cf5539]" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block font-medium">
              {pendingRemote} {pendingRemote === 1 ? "pedido de acesso remoto aguarda" : "pedidos de acesso remoto aguardam"} sua aprovação
            </span>
            <span className="block text-xs text-muted-foreground">A Engemase só acessa o gateway depois do seu “aprovar”.</span>
          </span>
        </Link>
      )}
    </SectionCard>
  )
}
