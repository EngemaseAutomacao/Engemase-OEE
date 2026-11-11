import Link from "next/link"
import {
  ArrowRightIcon,
  ClockAlertIcon,
  CpuIcon,
  FileCogIcon,
  HardDriveIcon,
  HourglassIcon,
  InboxIcon,
  type LucideIcon,
  RouterIcon,
  UnplugIcon,
  WifiOffIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { num } from "@/lib/format"
import { Card } from "@/components/ui/card"
import { ActivationDialog } from "./activation-dialog"
import type { GatewayIssue, GatewayRow, IssueKind } from "./gateway-view"
import { GATEWAY_STATUS_STYLE, LATEST_AGENT, isOlderVersion, plural } from "./labels"
import { GatewayStatusChip } from "./status-chip"

const ISSUE_ICON: Record<IssueKind, LucideIcon> = {
  offline: WifiOffIcon,
  pending: HourglassIcon,
  clock: ClockAlertIcon,
  config: FileCogIcon,
  device: UnplugIcon,
  buffer: InboxIcon,
  disk: HardDriveIcon,
}

const ISSUE_TONE: Record<GatewayIssue["tone"], string> = {
  bad: "bg-state-fault/10 text-state-fault",
  warn: "bg-state-stopped/12 text-amber-800 dark:text-state-stopped",
  info: "bg-muted text-muted-foreground",
}

/** Lista de pendências do gateway (alertas curtos com ícone). */
export function IssueList({ issues, className }: { issues: GatewayIssue[]; className?: string }) {
  if (issues.length === 0) return null
  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {issues.map((it) => {
        const Icon = ISSUE_ICON[it.kind]
        return (
          <li key={it.kind + it.text} className={cn("flex items-start gap-2 rounded-md px-2.5 py-1.5 text-xs", ISSUE_TONE[it.tone])}>
            <Icon className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0">{it.text}</span>
          </li>
        )
      })}
    </ul>
  )
}

function Bar({ value, tone }: { value: number; tone: "ok" | "warn" | "bad" }) {
  return (
    <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full", tone === "ok" ? "bg-state-running" : tone === "warn" ? "bg-state-stopped" : "bg-state-fault")}
        style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
      />
    </div>
  )
}

function Metric({ label, value, hint, alert, children }: { label: string; value: React.ReactNode; hint?: React.ReactNode; alert?: boolean; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-2.5">
      <dt className="truncate text-[11px] font-medium text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("truncate text-sm font-medium tabular-nums", alert && "text-amber-700 dark:text-state-stopped")}>{value}</dd>
      {hint && <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>}
      {children}
    </div>
  )
}

/** Card de gateway com status, saúde e pendências. */
export function GatewayCard({ row, href, expiresLabel }: { row: GatewayRow; href: string; expiresLabel: string }) {
  const style = GATEWAY_STATUS_STYLE[row.status]
  const pending = row.status === "pending"
  const offline = row.status === "offline"
  const dim = offline || pending

  return (
    <Card className={cn("@container gap-0 overflow-hidden border-t-4 py-0", style.border)}>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <RouterIcon className="size-4.5" />
          </span>
          <div className="min-w-0">
            {row.local ? (
              <span className="block truncate font-semibold">{row.name}</span>
            ) : (
              <Link href={href} className="block truncate font-semibold hover:underline focus-visible:underline focus-visible:outline-none">
                {row.name}
              </Link>
            )}
            <div className="truncate text-xs text-muted-foreground">
              {row.hostname !== "—" && <span className="font-mono">{row.hostname} · </span>}
              {row.unitName}
            </div>
          </div>
        </div>
        <GatewayStatusChip status={row.status} />
      </div>

      {row.issues.length > 0 && <IssueList issues={row.issues} className="px-4 pb-3" />}

      {pending ? (
        <div className="flex flex-col gap-3 border-t bg-muted/20 px-4 py-4 @md:flex-row @md:items-center @md:justify-between">
          <div>
            <div className="text-[11px] font-medium text-muted-foreground uppercase">Código de ativação</div>
            <div className="font-mono text-lg font-semibold tracking-[0.16em]">{row.enrollmentCode ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{row.hardware}</div>
          </div>
          {row.enrollmentCode && <ActivationDialog gatewayName={row.name} code={row.enrollmentCode} expiresLabel={expiresLabel} triggerVariant="default" />}
        </div>
      ) : (
        <dl className="grid grid-cols-2 border-t @md:grid-cols-4 [&>div]:border-b [&>div:nth-last-child(-n+2)]:border-b-0 @md:[&>div:nth-last-child(-n+4)]:border-b-0">
          <Metric label="Último contato" value={row.lastSeenAgo} hint={row.lastSeenAt ?? undefined} alert={offline} />
          <Metric label="Agente" value={row.agentVersion ? `v${row.agentVersion}` : "—"} hint={!row.agentVersion ? undefined : isOlderVersion(row.agentVersion) ? `Disponível: v${LATEST_AGENT}` : "Versão atual"}
            alert={!!row.agentVersion && isOlderVersion(row.agentVersion)} />
          <Metric
            label="Configuração"
            value={row.configApplied !== null ? `v${row.configApplied}` : "—"}
            hint={row.configTone === "warn" ? `v${row.configVersion} publicada` : row.configTone === "ok" ? "Sincronizada" : "Não aplicada"}
            alert={row.configTone === "warn"}
          />
          <Metric label="Fila pendente" value={plural(row.bufferPending, "leitura", "leituras")} hint={offline ? "Último valor reportado" : "Aguardando envio"} alert={row.bufferPending > 20} />
          <Metric label="CPU" value={dim || row.cpuPct === null ? "—" : `${row.cpuPct.toLocaleString("pt-BR")}%`}>
            {!dim && row.cpuPct !== null && <Bar value={row.cpuPct} tone={row.cpuPct > 80 ? "bad" : row.cpuPct > 50 ? "warn" : "ok"} />}
          </Metric>
          <Metric label="Memória" value={dim || row.memMb === null ? "—" : `${num(row.memMb)} MB`} hint={!dim ? "Uso do agente" : undefined} />
          <Metric label="Disco livre" value={row.diskFreePct === null ? "—" : `${row.diskFreePct}%`} alert={row.diskFreePct !== null && row.diskFreePct < 20}>
            {row.diskFreePct !== null && <Bar value={row.diskFreePct} tone={row.diskFreePct < 10 ? "bad" : row.diskFreePct < 20 ? "warn" : "ok"} />}
          </Metric>
          <Metric label="Relógio" value={dim ? "—" : row.clockText} hint={row.clockAlert ? "Acima de 2 s" : !dim ? "Desvio do servidor" : undefined} alert={row.clockAlert} />
        </dl>
      )}

      <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CpuIcon className="size-3.5" />
            {plural(row.devices, "CLP", "CLPs")}
            {row.devicesError > 0 && <span className="font-medium text-state-fault">({row.devicesError} com erro)</span>}
          </span>
          <span>{plural(row.machines, "máquina", "máquinas")}</span>
        </div>
        {row.local ? (
          <span className="shrink-0 text-xs text-muted-foreground">Criado agora</span>
        ) : (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
          >
            Detalhes
            <ArrowRightIcon className="size-3.5" />
          </Link>
        )}
      </div>
    </Card>
  )
}
