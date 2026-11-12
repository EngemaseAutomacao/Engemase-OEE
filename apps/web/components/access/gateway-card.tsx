import Link from "next/link"
import {
  ArrowRightIcon,
  ClockAlertIcon,
  CpuIcon,
  FactoryIcon,
  FileCogIcon,
  HardDriveIcon,
  HourglassIcon,
  InboxIcon,
  type LucideIcon,
  RouterIcon,
  UnplugIcon,
  WifiOffIcon,
} from "lucide-react"

import type { GatewayStatus } from "@/lib/mock/types"
import { cn } from "@/lib/utils"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { EditOnly } from "@/components/config/engemase-managed"
import { ActivationDialog } from "./activation-dialog"
import type { GatewayIssue, GatewayRow, IssueKind } from "./gateway-view"
import { LATEST_AGENT, isOlderVersion, plural } from "./labels"
import { GatewayStatusChip } from "./status-chip"

export const STATUS_TONE: Record<GatewayStatus, IconTone> = { online: "green", degraded: "amber", offline: "red", pending: "slate" }

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
          <li key={it.kind + it.text} className={cn("flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs", ISSUE_TONE[it.tone])}>
            <Icon className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0">{it.text}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** Barra fina de uso (CPU, disco). */
export function UsageBar({ value, tone }: { value: number; tone: "ok" | "warn" | "bad" }) {
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-background/80 dark:bg-white/10">
      <div
        className={cn("h-full rounded-full", tone === "ok" ? "bg-state-running" : tone === "warn" ? "bg-state-stopped" : "bg-state-fault")}
        style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
      />
    </div>
  )
}

function Metric({
  label,
  value,
  hint,
  alert,
  children,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  alert?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/50 px-3 py-2.5">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-sm font-semibold tabular-nums", alert && "text-amber-700 dark:text-state-stopped")}>{value}</dd>
      {hint && <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>}
      {children}
    </div>
  )
}

/** Card de gateway com status, saúde e pendências (padrão novo: cartão branco rounded-2xl). */
export function GatewayCard({ row, href, freshExpiresLabel }: { row: GatewayRow; href: string; freshExpiresLabel: string }) {
  const pending = row.status === "pending"
  const offline = row.status === "offline"
  const dim = offline || pending
  const older = !!row.agentVersion && isOlderVersion(row.agentVersion)

  return (
    <article className="@container flex min-w-0 flex-col rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <IconCircle icon={RouterIcon} tone={STATUS_TONE[row.status]} soft />
          <div className="min-w-0">
            {row.local ? (
              <span className="block truncate text-[15px] font-semibold">{row.name}</span>
            ) : (
              <Link href={href} className="block truncate text-[15px] font-semibold hover:text-primary focus-visible:underline focus-visible:outline-none">
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
      </header>

      {row.issues.length > 0 && <IssueList issues={row.issues} className="px-5 pb-3" />}

      <div className="flex-1 px-5 pb-4">
        {pending ? (
          <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4 @md:flex-row @md:items-center @md:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] text-muted-foreground">Código de ativação</div>
              <div className={cn("font-mono text-lg font-semibold tracking-[0.16em]", row.codeExpired && "text-muted-foreground line-through")}>
                {row.enrollmentCode ?? "—"}
              </div>
              <div className={cn("text-xs", row.codeExpired ? "font-medium text-state-fault" : "text-muted-foreground")}>
                {row.codeExpired ? `Expirou em ${row.codeExpiresLabel}` : `Válido até ${row.codeExpiresLabel}`}
              </div>
            </div>
            {row.enrollmentCode && (
              <EditOnly fallback={<span className="text-xs text-muted-foreground">A equipe Engemase instala e ativa este gateway.</span>}>
                <ActivationDialog
                  gatewayName={row.name}
                  code={row.enrollmentCode}
                  expired={row.codeExpired}
                  expiresLabel={row.codeExpiresLabel}
                  freshExpiresLabel={freshExpiresLabel}
                  triggerVariant="default"
                />
              </EditOnly>
            )}
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-2 @md:grid-cols-4">
            <Metric label="Último contato" value={row.lastSeenAgo} hint={row.lastSeenAt ?? undefined} alert={offline} />
            <Metric
              label="Agente"
              value={row.agentVersion ? `v${row.agentVersion}` : "—"}
              hint={!row.agentVersion ? undefined : older ? `Disponível: v${LATEST_AGENT}` : "Versão atual"}
              alert={older}
            />
            <Metric
              label="Config. aplicada"
              value={
                row.configApplied !== null ? (
                  <>
                    v{row.configApplied}
                    {row.configTone === "warn" && <span className="font-normal text-muted-foreground"> / v{row.configVersion}</span>}
                  </>
                ) : (
                  "—"
                )
              }
              hint={row.configTone === "warn" ? `v${row.configVersion} publicada, pendente` : row.configTone === "ok" ? "Igual à publicada" : "Não aplicada"}
              alert={row.configTone === "warn"}
            />
            <Metric
              label="Fila do buffer"
              value={plural(row.bufferPending, "leitura", "leituras")}
              hint={offline ? "Último valor reportado" : "Aguardando envio"}
              alert={row.bufferPending > 20}
            />
            <Metric label="CPU" value={dim || row.cpuPct === null ? "—" : `${row.cpuPct.toLocaleString("pt-BR")}%`}>
              {!dim && row.cpuPct !== null && <UsageBar value={row.cpuPct} tone={row.cpuPct > 80 ? "bad" : row.cpuPct > 50 ? "warn" : "ok"} />}
            </Metric>
            <Metric
              label="Memória"
              value={dim || row.memMb === null ? "—" : `${row.memMb.toLocaleString("pt-BR")} MB`}
              hint={!dim ? "Uso do agente" : undefined}
            />
            <Metric label="Disco livre" value={row.diskFreePct === null ? "—" : `${row.diskFreePct}%`} alert={row.diskFreePct !== null && row.diskFreePct < 20}>
              {row.diskFreePct !== null && <UsageBar value={row.diskFreePct} tone={row.diskFreePct < 10 ? "bad" : row.diskFreePct < 20 ? "warn" : "ok"} />}
            </Metric>
            <Metric
              label="Desvio do relógio"
              value={dim ? "—" : row.clockText}
              hint={row.clockAlert ? "Acima do limite de 2 s" : !dim ? "Em relação ao servidor" : undefined}
              alert={row.clockAlert}
            />
          </dl>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CpuIcon className="size-3.5" />
            {plural(row.devices, "CLP", "CLPs")}
            {row.devicesError > 0 && <span className="font-medium text-state-fault">({row.devicesError} com erro)</span>}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <FactoryIcon className="size-3.5" />
            {plural(row.machines, "máquina", "máquinas")}
          </span>
        </div>
        {row.local ? (
          <span className="shrink-0 text-xs text-muted-foreground">Criado agora</span>
        ) : (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline focus-visible:underline focus-visible:outline-none"
          >
            Ver detalhes
            <ArrowRightIcon className="size-3.5" />
          </Link>
        )}
      </footer>
    </article>
  )
}
