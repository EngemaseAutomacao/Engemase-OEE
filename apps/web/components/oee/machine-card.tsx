import Link from "next/link"
import { AlertTriangleIcon, WifiOffIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { ago, num, pct, since } from "@/lib/format"
import { STATE_META } from "@/lib/states"
import type { MachineWithLive } from "@/lib/mock"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { OeeRing } from "@/components/oee/oee-ring"
import { StateBadge } from "@/components/oee/state-badge"

/** Card de máquina para a visão geral: estado ao vivo, produto, contagem × meta e OEE do turno. */
export function MachineCard({ machine, clientSlug, className }: { machine: MachineWithLive; clientSlug: string; className?: string }) {
  const live = machine.live
  const state = live?.state ?? "NO_COMM"
  const meta = STATE_META[state]
  const progress = live && live.targetShift > 0 ? Math.min(100, (live.countShift / live.targetShift) * 100) : 0

  return (
    <Link href={`/${clientSlug}/maquinas/${machine.id}`} className="group block focus-visible:outline-none">
      <Card
        className={cn(
          "relative gap-3 overflow-hidden border-t-4 py-4 transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring",
          meta.border,
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 px-4">
          <div className="min-w-0">
            <div className="truncate font-semibold">{machine.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {machine.code} · {machine.type}
            </div>
          </div>
          <OeeRing value={live?.stale ? null : live?.shift.oee} size={56} stroke={6} label="" />
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4">
          <StateBadge state={state} pulse={state === "FAULT"} />
          {live && !live.stale && live.stateSince && <span className="text-xs text-muted-foreground">há {since(live.stateSince)}</span>}
        </div>

        {live?.faultText && (
          <div className="mx-4 flex items-center gap-1.5 rounded-md bg-state-fault/10 px-2 py-1 text-xs text-state-fault">
            <AlertTriangleIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              {live.faultCode} · {live.faultText}
            </span>
          </div>
        )}
        {live?.stale && (
          <div className="mx-4 flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            <WifiOffIcon className="size-3.5 shrink-0" />
            <span className="truncate">{live.countShift > 0 ? `Dados atrasados · último ${ago(live.lastUpdate)}` : "Aguardando dados do gateway"}</span>
          </div>
        )}

        <div className="grid gap-1.5 px-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="truncate text-muted-foreground">{live?.productName ?? "Sem produto"}</span>
            <span className="tabular-nums">
              <span className="font-medium">{num(live?.countShift)}</span>
              <span className="text-muted-foreground"> / {num(live?.targetShift)}</span>
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
          <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>D {pct(live?.stale ? null : live?.shift.availability, 0)}</span>
            <span>P {pct(live?.stale ? null : live?.shift.performance, 0)}</span>
            <span>Q {pct(live?.stale ? null : live?.shift.quality, 0)}</span>
          </div>
        </div>
      </Card>
    </Link>
  )
}
