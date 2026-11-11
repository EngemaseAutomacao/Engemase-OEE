"use client"

import { useEffect, useState } from "react"
import {
  ArrowUpFromLineIcon,
  BanIcon,
  ClockIcon,
  FileClockIcon,
  HourglassIcon,
  type LucideIcon,
  PowerOffIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon,
  SplitIcon,
  TimerIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
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
import { CopyBlock } from "./copy-block"
import type { RemoteAccessVM, RemoteSessionVM } from "./gateway-detail-data"
import { REMOTE_STATUS_LABEL, REMOTE_STATUS_STYLE, clockCountdown, minutesLabel } from "./labels"
import { RequestAccessDialog } from "./request-access-dialog"
import { Chip } from "./status-chip"

const GUARANTEES: { icon: LucideIcon; text: string }[] = [
  { icon: ArrowUpFromLineIcon, text: "Somente conexões de saída (TCP 443). Nenhuma porta aberta no firewall da fábrica." },
  { icon: SplitIcon, text: "O gateway não roteia: acesso a CLP é um único IP:porta, aprovado caso a caso." },
  { icon: TimerIcon, text: "Expira sozinha por prazo, inatividade ou teto local de 8 h, mesmo sem falar com a nuvem." },
  { icon: PowerOffIcon, text: "Kill switch local (oee-gateway remote-access off --lock) prevalece sobre a plataforma." },
  { icon: FileClockIcon, text: "Pedido, aprovação, conexões, bytes e encerramento ficam na auditoria do cliente." },
]

function PolicyRow({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "off" }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-right text-sm font-medium", tone === "ok" && "text-state-running", tone === "off" && "text-muted-foreground")}>{value}</dd>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{value}</dd>
    </div>
  )
}

/** Contagem regressiva da sessão ativa (decrementa a cada segundo a partir do valor do servidor). */
function useCountdown(initial: number | null, onZero: () => void) {
  const [left, setLeft] = useState(initial)
  useEffect(() => {
    if (left === null) return
    if (left <= 0) {
      onZero()
      return
    }
    const id = window.setTimeout(() => setLeft((l) => (l === null ? null : l - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [left, onZero])
  return left
}

function ActiveSession({ s, hostname, onEnd, onExpire }: { s: RemoteSessionVM; hostname: string; onEnd: () => void; onExpire: () => void }) {
  const left = useCountdown(s.remainingS, onExpire) ?? 0
  const total = s.durationMin * 60
  const pctLeft = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-state-running/30 bg-state-running/5 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[11px] text-muted-foreground">Tempo restante</div>
          <div className="font-mono text-3xl font-bold tracking-tight tabular-nums" aria-live="off">
            {clockCountdown(left)}
          </div>
          <div className="text-xs text-muted-foreground">
            Encerra às {s.expiresLabel} · {minutesLabel(s.durationMin)} aprovadas
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.success("Pedido de extensão enviado", {
                description: `Mais ${minutesLabel(Math.min(60, s.durationMin))} · precisa de nova aprovação do admin do cliente.`,
              })
            }
          >
            <ClockIcon />
            Estender
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <PowerOffIcon />
                Encerrar agora
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Encerrar a sessão agora?</AlertDialogTitle>
                <AlertDialogDescription>
                  O gateway fecha o SSH e os encaminhamentos, desliga a VPN e envia o resumo da sessão. O técnico {s.requestedBy} perde o acesso imediatamente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction onClick={onEnd} className="bg-destructive text-white hover:bg-destructive/90">
                  Encerrar sessão
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-background dark:bg-white/10">
        <div className="h-full rounded-full bg-state-running transition-[width]" style={{ width: `${pctLeft * 100}%` }} />
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Detail label="Técnico" value={s.requestedBy} />
        <Detail label="Chamado" value={s.ticket} />
        <Detail label="Aprovado por" value={s.approvedBy ?? "—"} />
        <Detail label="Conexão" value={s.connection ?? "—"} />
      </dl>
      <p className="text-sm">
        <span className="text-muted-foreground">Motivo: </span>
        {s.reason}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Chip className="bg-primary/10 text-primary">SSH no gateway</Chip>
        {s.plc && <Chip className="bg-state-stopped/15 text-amber-700 dark:text-state-stopped">CLP: {s.plc}</Chip>}
      </div>
      <CopyBlock code={`ssh suporte@${hostname}`} />
    </div>
  )
}

/** Aba "Acesso remoto": VPN de manutenção sob demanda (docs/12). */
export function RemoteAccessTab({
  remote,
  gatewayName,
  hostname,
  offline,
  nowLabel,
}: {
  remote: RemoteAccessVM
  gatewayName: string
  hostname: string
  offline: boolean
  nowLabel: string
}) {
  const [sessions, setSessions] = useState(remote.sessions)
  const active = sessions.find((s) => s.status === "active")
  const requested = sessions.filter((s) => s.status === "requested")
  const { policy } = remote
  const approvers = remote.approvers.map((a) => `${a.name}${a.invited ? " (convite pendente)" : ""}`)

  const update = (id: string, patch: Partial<RemoteSessionVM>) => setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const endActive = () => {
    if (!active) return
    update(active.id, { status: "ended", endedLabel: nowLabel, endedReason: `Encerrada por ${remote.me.name} (Engemase)`, remainingS: null })
    toast.success("Sessão encerrada", { description: "O gateway desligou a VPN e o nó foi apagado. O resumo vai para a auditoria do cliente." })
  }
  const expireActive = () => {
    if (!active) return
    update(active.id, { status: "ended", endedLabel: nowLabel, endedReason: "Prazo encerrado", remainingS: null })
    toast.info("Sessão encerrada pelo prazo", { description: "A VPN foi desligada automaticamente pelo gateway." })
  }

  const vpn: { label: string; text: string; icon: LucideIcon; tone: IconTone } = active
    ? { label: "Ligada", text: `Sessão ativa de ${active.requestedBy} (chamado ${active.ticket}).`, icon: ShieldCheckIcon, tone: "green" }
    : requested.length > 0
      ? {
          label: "Desligada · pedido aguardando aprovação",
          text: `Aprovação de ${approvers.join(" ou ") || "admin do cliente"} pendente.`,
          icon: HourglassIcon,
          tone: "amber",
        }
      : policy.mode === "disabled"
        ? { label: "Desativada pela política", text: "O cliente desativou o acesso remoto. Pedidos não podem ser feitos.", icon: ShieldOffIcon, tone: "slate" }
        : {
            label: "Desligada",
            text: "A VPN só existe durante uma sessão aprovada. Fora disso, o gateway não aparece em nenhuma rede.",
            icon: ShieldIcon,
            tone: "slate",
          }

  const requestDisabled = policy.mode === "disabled" || !remote.me.canRequest

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
        <SectionCard
          title="VPN de manutenção"
          description="Sob demanda, aprovada pelo cliente e com prazo"
          action={
            <RequestAccessDialog
              gatewayName={gatewayName}
              hostname={hostname}
              remote={remote}
              offline={offline}
              nowLabel={nowLabel}
              disabled={requestDisabled}
              onRequested={(s) => setSessions((ss) => [s, ...ss])}
            />
          }
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <IconCircle icon={vpn.icon} tone={vpn.tone} soft />
              <div className="min-w-0">
                <div className="text-base font-semibold">{vpn.label}</div>
                <p className="text-xs text-muted-foreground">{vpn.text}</p>
              </div>
            </div>

            {active && <ActiveSession key={active.id} s={active} hostname={hostname} onEnd={endActive} onExpire={expireActive} />}

            {requested.map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-3 rounded-xl border border-state-stopped/40 bg-state-stopped/8 p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip className={REMOTE_STATUS_STYLE.requested}>{REMOTE_STATUS_LABEL.requested}</Chip>
                    <span className="text-sm font-medium">
                      {r.requestedBy} · chamado {r.ticket} · {minutesLabel(r.durationMin)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm">{r.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pedido em {r.requestedLabel} · SSH{r.plc ? ` + CLP ${r.plc}` : ""} · aprovação de {approvers.join(" ou ") || "admin do cliente"} (MFA). Quem
                    pede nunca aprova.
                  </p>
                </div>
                {r.requestedBy === remote.me.name && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => {
                      update(r.id, { status: "cancelled", endedLabel: nowLabel, endedReason: "Pedido cancelado por quem pediu" })
                      toast.success("Pedido cancelado", { description: `Chamado ${r.ticket}. O admin do cliente foi avisado.` })
                    }}
                  >
                    <XIcon />
                    Cancelar pedido
                  </Button>
                )}
              </div>
            ))}

            {requestDisabled && remote.me.canRequest && (
              <p className="flex items-center gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
                <BanIcon className="size-4 shrink-0" />
                Acesso remoto desativado pelo cliente. Só o admin do cliente pode mudar a política.
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Histórico de sessões"
          description="Pedidos, aprovações e encerramentos deste gateway"
          href={remote.historyHref}
          linkLabel="Ver todos"
        >
          {sessions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum acesso remoto a este gateway até agora.</p>
          ) : (
            <ul className="divide-y">
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Chip className={REMOTE_STATUS_STYLE[s.status]}>{REMOTE_STATUS_LABEL[s.status]}</Chip>
                      <span className="text-sm font-medium">{s.requestedBy}</span>
                      <span className="text-xs text-muted-foreground">
                        · {s.ticket} · {minutesLabel(s.durationMin)}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">{s.requestedLabel}</span>
                  </div>
                  <p className="text-sm">{s.reason}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <span>Escopo: SSH{s.plc ? ` + CLP ${s.plc}` : ""}</span>
                    {s.approvedBy && (
                      <span>
                        {s.status === "rejected" ? "Recusado" : "Aprovado"} por {s.approvedBy}
                        {s.approvedLabel ? ` em ${s.approvedLabel}` : ""}
                      </span>
                    )}
                    {s.startedLabel && (
                      <span>
                        Sessão {s.startedLabel}
                        {s.endedLabel ? ` → ${s.endedLabel.split(" ")[1] ?? s.endedLabel}` : " → em andamento"}
                      </span>
                    )}
                    {s.connection && <span>{s.connection}</span>}
                    {s.bytes && <span>{s.bytes} trafegados</span>}
                    {s.endedReason && <span>{s.endedReason}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
        <SectionCard title="Política do cliente" description="Definida pelo admin do cliente">
          <dl className="divide-y">
            <PolicyRow label="Modo" value={policy.modeLabel} tone={policy.mode === "disabled" ? "off" : undefined} />
            <PolicyRow label="Quem aprova" value={approvers.length ? approvers.join(", ") : "Admin do cliente"} />
            <PolicyRow label="Duração máxima" value={minutesLabel(policy.maxDurationMin)} />
            <PolicyRow label="Inatividade" value={`Encerra após ${minutesLabel(policy.idleTimeoutMin)}`} />
            <PolicyRow
              label="Acesso a CLP"
              value={policy.allowPlcForward ? "Permitido (IP:porta)" : "Bloqueado"}
              tone={policy.allowPlcForward ? "ok" : "off"}
            />
            <PolicyRow label="Contato na planta" value={policy.requireOnsiteContact ? "Obrigatório" : "Opcional"} />
            {policy.windows.length > 0 && <PolicyRow label="Janela pré-aprovada" value={policy.windows.join(" · ")} />}
          </dl>
        </SectionCard>

        <SectionCard title="Garantias de segurança">
          <ul className="flex flex-col gap-3">
            {GUARANTEES.map((g) => (
              <li key={g.text} className="flex items-start gap-3 text-xs">
                <IconCircle icon={g.icon} tone="teal" soft size="sm" />
                <span className="pt-1.5 text-muted-foreground">{g.text}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  )
}
