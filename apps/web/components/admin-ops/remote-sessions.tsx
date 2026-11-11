"use client"

import { useState } from "react"
import { toast } from "sonner"
import { BellRingIcon, CableIcon, CopyIcon, InboxIcon, NetworkIcon, PowerIcon, TerminalIcon, TicketIcon, XIcon } from "lucide-react"

import { duration, time } from "@/lib/format"
import { cn } from "@/lib/utils"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { PersonAvatar, SoftBadge } from "./bits"
import { useRemote } from "./remote-context"
import type { SessionRow } from "./remote-data"
import { countdown, useOpsClock } from "./use-ops-clock"

function ScopeBadges({ s }: { s: SessionRow }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {s.ssh && (
        <SoftBadge tone="navy" icon={TerminalIcon}>
          SSH
        </SoftBadge>
      )}
      {s.plc && (
        <SoftBadge tone="orange" icon={CableIcon} title={s.plc.deviceName}>
          CLP {s.plc.target}
        </SoftBadge>
      )}
    </div>
  )
}

/** Sessões de VPN em andamento, com contagem regressiva e "Encerrar". */
export function ActiveSessions({ className }: { className?: string }) {
  const { sessions, endSession, me } = useRemote()
  const { now } = useOpsClock(1000)
  const [target, setTarget] = useState<SessionRow | null>(null)
  const active = sessions.filter((s) => s.status === "active" || s.status === "approved")

  const copySsh = (s: SessionRow) => {
    const cmd = `ssh suporte@${s.hostname}`
    void navigator.clipboard?.writeText(cmd).catch(() => undefined)
    toast.success("Comando copiado", { description: `${cmd} · certificado SSH válido até ${s.expiresAt ? time(s.expiresAt) : "o fim da sessão"}` })
  }

  const confirmEnd = () => {
    if (!target) return
    endSession(target.id, `Encerrada pela Engemase (${me.name})`)
    toast.success("Sessão encerrada", {
      description: `${target.gatewayName} recebe vpn.disable no próximo /sync; ${target.requestedBy} foi desconectado. Resumo enviado ao admin do cliente.`,
    })
    setTarget(null)
  }

  return (
    <SectionCard title="Sessões ativas" description="VPN aberta agora · expira sozinha no prazo ou por inatividade" className={className}>
      {active.length === 0 ? (
        <Empty className="border border-dashed p-6 md:p-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NetworkIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma sessão ativa</EmptyTitle>
            <EmptyDescription>Fora de uma sessão aprovada, nenhum gateway aparece na VPN.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-3">
          {active.map((s) => {
            const start = Date.parse(s.startedAt ?? s.requestedAt)
            const end = s.expiresAt ? Date.parse(s.expiresAt) : start + s.durationMin * 60_000
            const left = end - now
            const frac = Math.max(0, Math.min(1, left / (end - start)))
            const low = left < 10 * 60_000
            return (
              <li key={s.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <IconCircle icon={TerminalIcon} tone="teal" soft />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-sm font-semibold">{s.gatewayName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {s.clientName} · {s.unitName} · <span className="font-mono">{s.hostname}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn("font-mono text-xl leading-none font-bold tabular-nums", left <= 0 ? "text-muted-foreground" : low ? "text-state-fault" : "text-foreground")}>
                      {left > 0 ? countdown(left) : "0:00"}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{left > 0 ? `expira às ${time(new Date(end).toISOString())}` : "expirada · aguardando o gateway"}</div>
                  </div>
                </div>
                <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full transition-[width]", low ? "bg-state-fault" : "bg-[#0e9384]")} style={{ width: `${frac * 100}%` }} />
                </span>
                <p className="mt-3 text-sm">{s.reason}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <PersonAvatar name={s.requestedBy} tone="navy" size="sm" />
                    <span>
                      <span className="font-medium text-foreground">{s.requestedBy}</span> · {s.requestedByRole}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <TicketIcon className="size-3.5" aria-hidden />
                    {s.ticket}
                  </span>
                  {s.approvedLabel && <span>{s.approvedLabel}</span>}
                  {s.connection && <span>{s.connection === "relay" ? "via relay (TCP 443)" : "conexão direta"}</span>}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <ScopeBadges s={s} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => copySsh(s)} disabled={s.hostname === "—"}>
                      <CopyIcon />
                      Copiar SSH
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => setTarget(s)}>
                      <PowerIcon />
                      Encerrar
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <AlertDialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar a sessão no {target?.gatewayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {target?.requestedBy} é desconectado e o certificado SSH perde a validade. O gateway fecha encaminhamentos e envia o resumo da sessão (comandos e bytes) para a
              auditoria do cliente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter aberta</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmEnd}>
              Encerrar agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  )
}

/** Pedidos aguardando o admin do cliente (a Engemase pede, o cliente aprova). */
export function PendingRequests({ className }: { className?: string }) {
  const { sessions, cancelRequest } = useRemote()
  const { now } = useOpsClock(15_000)
  const pending = sessions.filter((s) => s.status === "requested")

  return (
    <SectionCard title="Pedidos pendentes" description="Quem pede nunca aprova: a decisão é do admin do cliente, com MFA" className={className}>
      {pending.length === 0 ? (
        <Empty className="border border-dashed p-6 md:p-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum pedido aguardando</EmptyTitle>
            <EmptyDescription>Use “Solicitar acesso” para pedir uma sessão de manutenção a um cliente.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-3">
          {pending.map((s) => (
            <li key={s.id} className="rounded-xl border p-4">
              <div className="flex items-start gap-3">
                <PersonAvatar name={s.requestedBy} tone="orange" />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm font-semibold">
                    {s.requestedBy} <span className="font-normal text-muted-foreground">→ {s.gatewayName}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.clientName} · {s.unitName}
                  </div>
                </div>
                <SoftBadge tone="amber" dot>
                  há {duration(Math.max(0, now - Date.parse(s.requestedAt)) / 1000)}
                </SoftBadge>
              </div>
              <p className="mt-3 text-sm">{s.reason}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <TicketIcon className="size-3.5" aria-hidden />
                  {s.ticket}
                </span>
                <span>{s.durationMin >= 60 ? `${s.durationMin / 60} h` : `${s.durationMin} min`}</span>
                {s.onsiteContact && <span>Contato na planta: {s.onsiteContact}</span>}
                <ScopeBadges s={s} />
              </div>
              <div className="mt-3 flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Aguardando <span className="font-medium">{s.approvers.length > 0 ? s.approvers.join(" ou ") : "admin do cliente"}</span>
                </span>
                <div className="flex gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      toast.success("Aviso reenviado", {
                        description: `${s.approvers.join(", ") || "O admin do cliente"} recebeu de novo o pedido no app, por push e por e-mail.`,
                      })
                    }
                  >
                    <BellRingIcon />
                    Lembrar
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-state-fault hover:text-state-fault"
                    onClick={() => {
                      cancelRequest(s.id)
                      toast("Pedido cancelado", { description: `${s.ticket} · ${s.gatewayName}. O cliente vê o cancelamento no histórico.` })
                    }}
                  >
                    <XIcon />
                    Cancelar
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
