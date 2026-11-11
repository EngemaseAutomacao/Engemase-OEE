"use client"

import { useState } from "react"
import Link from "next/link"
import {
  BellOffIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  CloudOffIcon,
  HourglassIcon,
  OctagonAlertIcon,
  PauseCircleIcon,
  RouterIcon,
  UnplugIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { ago } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import type { AlertKind, AlertSeverity, MonitoringAlert } from "@/components/monitoring/queries"

const KIND_ICON: Record<AlertKind, LucideIcon> = {
  fault: OctagonAlertIcon,
  no_comm: UnplugIcon,
  stopped_no_reason: PauseCircleIcon,
  pending_reasons: ClipboardListIcon,
  gateway_offline: CloudOffIcon,
  gateway_degraded: RouterIcon,
  gateway_pending: HourglassIcon,
}

const SEVERITY_STYLE: Record<AlertSeverity, { icon: string; label: string; chip: string }> = {
  critical: { icon: "bg-state-fault/12 text-state-fault", label: "Crítico", chip: "bg-state-fault/12 text-state-fault" },
  warning: {
    icon: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
    label: "Atenção",
    chip: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
  },
  info: { icon: "bg-muted text-muted-foreground", label: "Pendência", chip: "bg-muted text-muted-foreground" },
}

const INITIAL = 5

/** Lista de alertas ativos (falhas, paradas sem motivo, comunicação e gateways). */
export function AlertsPanel({ alerts, className }: { alerts: MonitoringAlert[]; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? alerts : alerts.slice(0, INITIAL)
  const counts = (["critical", "warning", "info"] as const).map((s) => ({ s, n: alerts.filter((a) => a.severity === s).length }))

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle>Alertas ativos</CardTitle>
        <CardDescription>Falhas, paradas sem motivo e comunicação com gateways e CLPs</CardDescription>
        {alerts.length > 0 && (
          <CardAction className="flex flex-wrap justify-end gap-1">
            {counts
              .filter((c) => c.n > 0)
              .map((c) => (
                <span key={c.s} className={cn("rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", SEVERITY_STYLE[c.s].chip)}>
                  {c.n} {SEVERITY_STYLE[c.s].label.toLowerCase()}
                </span>
              ))}
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-2 sm:px-3">
        {alerts.length === 0 ? (
          <Empty className="py-8 md:py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellOffIcon />
              </EmptyMedia>
              <EmptyTitle className="text-base">Nenhum alerta ativo</EmptyTitle>
              <EmptyDescription>Todas as máquinas e gateways estão comunicando e não há paradas aguardando motivo.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <ul className="divide-y">
              {visible.map((a) => {
                const Icon = KIND_ICON[a.kind]
                return (
                  <li key={a.id}>
                    <Link
                      href={a.href}
                      className="group flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md", SEVERITY_STYLE[a.severity].icon)}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-medium">{a.title}</span>
                          {a.context && <span className="text-xs text-muted-foreground">{a.context}</span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {a.description}
                          {a.since && <span className="sm:hidden"> · {ago(a.since)}</span>}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-muted-foreground tabular-nums">
                        {a.since && <span className="hidden sm:inline">{ago(a.since)}</span>}
                        <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
            {alerts.length > INITIAL && (
              <div className="mt-2 px-2">
                <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "Mostrar menos" : `Mostrar todos os ${alerts.length} alertas`}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
