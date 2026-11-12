"use client"

import { useState } from "react"
import Link from "next/link"
import {
  AlertTriangleIcon,
  BanIcon,
  CheckIcon,
  ClockIcon,
  InboxIcon,
  PowerOffIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  SlidersHorizontalIcon,
  TimerIcon,
} from "lucide-react"

import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { ApproveDialog, type ApproveMode } from "./remote-approve-dialog"
import { CONNECTION_LABEL, STATUS_META, agoLabel, countdown, dateTimeOf, minutesLabel, timeOf, windowLabel } from "./remote-labels"
import { useRemote } from "./remote-provider"
import { RejectDialog } from "./remote-reject-dialog"
import type { RemoteSessionVM } from "./remote-types"

export function StatusChip({ status, className }: { status: RemoteSessionVM["status"]; className?: string }) {
  const m = STATUS_META[status]
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", m.className, className)}>{m.label}</span>
}

function Detail({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm leading-snug font-medium">{children}</dd>
    </div>
  )
}

function Requester({ s, now }: { s: RemoteSessionVM; now: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#2c4e73] text-xs font-bold text-white">{initials(s.requestedBy)}</span>
      <div className="min-w-0 leading-tight">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold">{s.requestedBy}</span>
          <span className="text-xs text-muted-foreground">{s.requestedByRole}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Pediu {agoLabel(s.requestedMs, now)} · {dateTimeOf(s.requestedMs)}
        </div>
      </div>
    </div>
  )
}

function Scope({ s }: { s: RemoteSessionVM }) {
  return (
    <>
      SSH no gateway
      {s.plc && (
        <span className="block text-xs font-normal text-muted-foreground">
          + {s.plc.deviceName} · <span className="font-mono">{s.plc.target}</span>
        </span>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Pedidos aguardando aprovação
// ---------------------------------------------------------------------------

function RequestCard({ s, onAction }: { s: RemoteSessionVM; onAction: (kind: ApproveMode | "reject") => void }) {
  const { now, policy, me, approvers } = useRemote()
  const overMax = s.requestedDurationMin > policy.maxDurationMin
  const plcBlocked = Boolean(s.plc) && !policy.allowPlcForward
  const selfRequest = s.requestedBy === me.name
  const offline = s.gatewayStatus === "offline"

  return (
    <article className="rounded-xl border border-state-stopped/35 bg-state-stopped/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <Requester s={s} now={now} />
        <StatusChip status={s.status} className="hidden sm:inline-flex" />
      </div>

      <p className="mt-3 rounded-lg border bg-card px-3 py-2 text-sm leading-relaxed">“{s.reason}”</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
        <Detail label="Gateway" className="col-span-2 md:col-span-1">
          {s.gatewayName}
          <span className="block text-xs font-normal text-muted-foreground">
            <span className="font-mono">{s.hostname}</span> · {s.unitName}
          </span>
        </Detail>
        <Detail label="Chamado">{s.ticket}</Detail>
        <Detail label="Duração">
          <span className={cn(overMax && "text-amber-700 dark:text-state-stopped")}>{minutesLabel(s.requestedDurationMin)}</span>
          <span className="block text-xs font-normal text-muted-foreground">máx. da política: {minutesLabel(policy.maxDurationMin)}</span>
        </Detail>
        <Detail label="Escopo" className="col-span-2 md:col-span-1">
          <Scope s={s} />
        </Detail>
      </dl>

      <div className="mt-3 text-xs text-muted-foreground">Histórico do técnico: {s.requesterHistory}.</div>

      {(overMax || plcBlocked || offline) && (
        <ul className="mt-3 grid gap-1.5 rounded-lg bg-state-stopped/10 px-3 py-2 text-xs text-amber-800 dark:text-state-stopped">
          {overMax && (
            <li className="flex gap-2">
              <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
              Duração acima da sua política: a aprovação fica limitada a {minutesLabel(policy.maxDurationMin)}.
            </li>
          )}
          {plcBlocked && (
            <li className="flex gap-2">
              <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
              Sua política não permite acesso a CLP: ele será removido do escopo.
            </li>
          )}
          {offline && (
            <li className="flex gap-2">
              <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
              Gateway offline agora: a VPN só liga quando ele voltar a se conectar.
            </li>
          )}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button onClick={() => onAction("approve")} disabled={selfRequest}>
          <ShieldCheckIcon />
          Aprovar
        </Button>
        <Button variant="outline" onClick={() => onAction("modify")} disabled={selfRequest}>
          <SlidersHorizontalIcon />
          Aprovar com alterações
        </Button>
        <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onAction("reject")}>
          <BanIcon />
          Recusar
        </Button>
        <span className="text-[11px] text-muted-foreground sm:ml-auto">
          {selfRequest ? "Quem pede nunca aprova." : `Aprovadores: ${approvers.length ? approvers.join(", ") : "admins do cliente"}`}
        </span>
      </div>
    </article>
  )
}

export function PendingRequests({ className }: { className?: string }) {
  const { sessions, policy } = useRemote()
  const pending = sessions.filter((s) => s.status === "requested")
  const [dialog, setDialog] = useState<{ kind: ApproveMode | "reject"; id: string } | null>(null)
  const [open, setOpen] = useState(false)
  const current = dialog ? (sessions.find((s) => s.id === dialog.id) ?? null) : null

  return (
    <SectionCard
      title="Pedidos aguardando sua aprovação"
      description={pending.length ? `${pending.length} ${pending.length === 1 ? "pedido" : "pedidos"} · aprovação com MFA` : "Nada pendente agora"}
      className={className}
    >
      <div className="grid gap-3">
        {policy.mode === "disabled" && (
          <div className="flex gap-2.5 rounded-xl border bg-muted/50 p-3 text-xs text-muted-foreground">
            <ShieldOffIcon className="mt-px size-4 shrink-0" />
            Acesso remoto desativado pela sua política: a Engemase não consegue pedir acesso aos gateways. Altere em “Política de acesso remoto”.
          </div>
        )}
        {policy.mode === "preapproved_window" && (
          <div className="flex gap-2.5 rounded-xl border border-[#0e9384]/25 bg-[#0e9384]/6 p-3 text-xs text-muted-foreground">
            <ClockIcon className="mt-px size-4 shrink-0 text-[#0e9384]" />
            <span>
              Janela pré-aprovada: {policy.windows.length ? policy.windows.map(windowLabel).join(" · ") : "nenhuma janela definida"}. Pedidos dentro dela são liberados sozinhos;
              fora dela, aparecem aqui.
            </span>
          </div>
        )}

        {pending.length > 0 ? (
          pending.map((s) => (
            <RequestCard
              key={s.id}
              s={s}
              onAction={(kind) => {
                setDialog({ kind, id: s.id })
                setOpen(true)
              }}
            />
          ))
        ) : (
          <Empty className="border p-6 md:p-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhum pedido aguardando</EmptyTitle>
              <EmptyDescription>Quando a Engemase pedir acesso a um gateway, o pedido aparece aqui e você recebe um aviso no sino, por push e por e-mail.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>

      <ApproveDialog session={current} mode={dialog?.kind === "modify" ? "modify" : "approve"} open={open && dialog?.kind !== "reject"} onOpenChange={setOpen} />
      <RejectDialog session={current} open={open && dialog?.kind === "reject"} onOpenChange={setOpen} />
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Sessão ativa
// ---------------------------------------------------------------------------

function Activating({ s }: { s: RemoteSessionVM }) {
  const offline = s.gatewayStatus === "offline" || s.gatewayStatus === "pending"
  const steps = [
    { label: `Aprovação assinada por ${s.decidedBy ?? "você"}`, done: true },
    { label: offline ? `Aguardando o ${s.gatewayName} voltar a se conectar` : `Comando entregue ao ${s.gatewayName}; VPN ligando (saída 443)`, done: false },
    { label: `${s.requestedBy} recebe certificado SSH válido por ${minutesLabel(s.durationMin)}`, done: false },
  ]
  return (
    <ol className="grid gap-2.5 rounded-xl border border-[#257bb4]/25 bg-[#257bb4]/5 p-4">
      {steps.map((st, i) => (
        <li key={st.label} className="flex items-center gap-2.5 text-sm">
          {st.done ? (
            <span className="flex size-5 items-center justify-center rounded-full bg-state-running text-white">
              <CheckIcon className="size-3" />
            </span>
          ) : i === 1 ? (
            <Spinner className="size-5 text-[#257bb4]" />
          ) : (
            <span className="size-5 rounded-full border-2 border-dashed border-muted-foreground/40" />
          )}
          <span className={cn(!st.done && i > 1 && "text-muted-foreground")}>{st.label}</span>
        </li>
      ))}
    </ol>
  )
}

function LiveSession({ s }: { s: RemoteSessionVM }) {
  const { now, policy, clientSlug, endNow } = useRemote()
  const active = s.status === "active" && s.startedMs !== null && s.expiresMs !== null
  const total = s.durationMin * 60_000
  const left = active ? Math.max(0, s.expiresMs! - now) : total
  const frac = total > 0 ? Math.min(1, left / total) : 0
  const ending = left < 10 * 60_000

  return (
    <article className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <Requester s={s} now={now} />
        <StatusChip status={s.status} />
      </div>

      {active ? (
        <div className={cn("rounded-xl border p-4", ending ? "border-state-stopped/40 bg-state-stopped/8" : "border-state-running/30 bg-state-running/6")}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[11px] text-muted-foreground">Tempo restante</div>
              <div className="font-mono text-3xl leading-tight font-bold tracking-tight tabular-nums" aria-live="off">
                {countdown(left)}
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <div>
                Encerra às <span className="font-semibold text-foreground">{timeOf(s.expiresMs!)}</span>
              </div>
              <div>{minutesLabel(s.durationMin)} aprovadas · cai após {policy.idleTimeoutMin} min sem uso</div>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-background">
            <div
              className={cn("h-full rounded-full transition-[width] duration-1000 ease-linear", ending ? "bg-state-stopped" : "bg-state-running")}
              style={{ width: `${frac * 100}%` }}
            />
          </div>
        </div>
      ) : (
        <Activating s={s} />
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Detail label="Gateway">
          {s.gatewayName}
          <span className="block font-mono text-xs font-normal text-muted-foreground">{s.hostname}</span>
        </Detail>
        <Detail label="Chamado">
          {s.ticket}
          <span className="block line-clamp-2 text-xs font-normal text-muted-foreground">{s.reason}</span>
        </Detail>
        <Detail label="Conexão">{s.connection ? CONNECTION_LABEL[s.connection] : "Estabelecendo…"}</Detail>
        <Detail label="Início">{s.startedMs ? timeOf(s.startedMs) : "—"}</Detail>
        <Detail label="Aprovada por">
          {s.decidedBy ?? "—"}
          {s.decidedMs && <span className="block text-xs font-normal text-muted-foreground">às {timeOf(s.decidedMs)} · com MFA</span>}
        </Detail>
        <Detail label="Escopo">
          <Scope s={s} />
        </Detail>
        {s.onsiteContact && <Detail label="Contato na planta">{s.onsiteContact}</Detail>}
        {s.changes.length > 0 && (
          <Detail label="Alterações na aprovação" className="col-span-2">
            <ul className="text-xs font-normal text-muted-foreground">
              {s.changes.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
          </Detail>
        )}
      </dl>

      <div className="flex flex-col gap-2 sm:flex-row">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="sm:flex-1">
              <PowerOffIcon />
              Encerrar agora
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Encerrar a sessão agora?</AlertDialogTitle>
              <AlertDialogDescription>
                {s.requestedBy} será desconectado do {s.gatewayName} imediatamente. O gateway desliga a VPN, fecha encaminhamentos e apaga as credenciais da sessão. A coleta de
                OEE não é afetada.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Manter sessão</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => endNow(s.id)}>
                Encerrar agora
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button variant="outline" asChild className="sm:flex-1">
          <Link href={`/${clientSlug}/config/gateways/${s.gatewayId}`}>Ver gateway</Link>
        </Button>
      </div>
    </article>
  )
}

export function ActiveSessions({ className }: { className?: string }) {
  const { sessions } = useRemote()
  const live = sessions.filter((s) => s.status === "active" || s.status === "approved")

  return (
    <SectionCard
      title={live.length > 1 ? "Sessões ativas" : "Sessão ativa"}
      description={live.length ? "VPN ligada · encerra sozinha no prazo" : "VPN desligada em todos os gateways"}
      action={
        live.length > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-state-running/12 px-2.5 py-1 text-[11px] font-semibold text-state-running">
            <span className="size-1.5 animate-pulse rounded-full bg-state-running" />
            Ao vivo
          </span>
        ) : undefined
      }
      className={className}
    >
      {live.length > 0 ? (
        <div className="flex flex-col divide-y [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
          {live.map((s) => (
            <LiveSession key={s.id} s={s} />
          ))}
        </div>
      ) : (
        <Empty className="h-full border p-6 md:p-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TimerIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma sessão ativa</EmptyTitle>
            <EmptyDescription>A VPN fica desligada por padrão. Fora de uma sessão aprovada, nenhum gateway aparece em rede alguma.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </SectionCard>
  )
}
