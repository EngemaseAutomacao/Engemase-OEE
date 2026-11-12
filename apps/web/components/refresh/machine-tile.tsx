import Link from "next/link"
import { AlertTriangleIcon, ArrowRightIcon, WifiOffIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { ago, num, pct, since } from "@/lib/format"
import { STATE_META } from "@/lib/states"
import type { MachineWithLive } from "@/lib/mock"
import { OeeRing } from "@/components/oee/oee-ring"
import { StateBadge } from "@/components/oee/state-badge"
import { STATE_ICON } from "@/components/kiosk/state-style"

/**
 * Cartão de máquina no padrão novo (rounded-2xl, ícone do estado em círculo suave):
 * estado ao vivo, produto, contagem × meta, D/P/Q e OEE do turno. Sem estado: servidor ou cliente.
 */
export function MachineTile({
  machine,
  href,
  lineName,
  unitName,
  className,
}: {
  machine: MachineWithLive
  href: string
  lineName: string
  unitName: string
  className?: string
}) {
  const live = machine.live
  const state = live?.state ?? "NO_COMM"
  const meta = STATE_META[state]
  const Icon = STATE_ICON[state]
  const stale = Boolean(live?.stale)
  const progress = live && live.targetShift > 0 ? Math.min(100, (live.countShift / live.targetShift) * 100) : 0
  const metric = (v: number | undefined) => pct(stale ? null : v, 0)

  return (
    <Link href={href} className={cn("group block rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", className)}>
      <article className="flex h-full flex-col gap-3 rounded-2xl border bg-card p-4 text-card-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-shadow group-hover:shadow-md">
        <header className="flex items-start gap-3">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", meta.soft, meta.text)} aria-hidden>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold group-hover:text-primary">{machine.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {machine.code} · {machine.type}
            </div>
          </div>
          <OeeRing value={stale ? null : live?.shift.oee} size={52} stroke={6} label="" />
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={state} pulse={state === "FAULT"} />
          {live && !stale && live.stateSince && <span className="text-xs text-muted-foreground tabular-nums">há {since(live.stateSince)}</span>}
        </div>

        {live?.faultText && (
          <div className="flex items-center gap-1.5 rounded-lg bg-state-fault/10 px-2.5 py-1.5 text-xs text-state-fault">
            <AlertTriangleIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              {live.faultCode} · {live.faultText}
            </span>
          </div>
        )}
        {stale && (
          <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
            <WifiOffIcon className="size-3.5 shrink-0" />
            <span className="truncate">{live!.countShift > 0 ? `Dados atrasados · último ${ago(live!.lastUpdate)}` : "Aguardando dados do gateway"}</span>
          </div>
        )}

        <div className="mt-auto grid gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground">{live?.productName ?? "Sem produto"}</span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold">{num(live?.countShift)}</span>
              <span className="text-muted-foreground"> / {num(live?.targetShift)}</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
          <dl className="grid grid-cols-3 gap-1.5 pt-1 text-center text-[11px]">
            {(
              [
                ["Disp.", live?.shift.availability],
                ["Perf.", live?.shift.performance],
                ["Qual.", live?.shift.quality],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="rounded-md bg-muted/60 px-1 py-1">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-semibold tabular-nums">{metric(v)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
          <span className="truncate">
            {lineName} · {unitName}
          </span>
          <ArrowRightIcon className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </footer>
      </article>
    </Link>
  )
}
