"use client"

import { cn } from "@/lib/utils"
import { duration, time } from "@/lib/format"
import { STATE_META } from "@/lib/states"
import type { StateEvent } from "@/lib/mock/types"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Linha do tempo de estados (tipo Gantt) entre `start` e `end`.
 * Os segmentos usam as cores de estado; o trecho futuro fica vazio.
 */
export function StateTimeline({
  events,
  start,
  end,
  reasonName,
  height = 28,
  showAxis = true,
  className,
}: {
  events: StateEvent[]
  start: string
  end: string
  reasonName?: (reasonId: string | null) => string | undefined
  height?: number
  showAxis?: boolean
  className?: string
}) {
  const s = Date.parse(start)
  const e = Date.parse(end)
  const span = e - s
  const ticks: number[] = []
  for (let t = s; t <= e; t += 60 * 60 * 1000) ticks.push(t)

  return (
    <div className={cn("w-full", className)}>
      <div className="relative w-full overflow-hidden rounded-md bg-muted" style={{ height }}>
        {events.map((ev, i) => {
          const a = Math.max(s, Date.parse(ev.start))
          const b = Math.min(e, Date.parse(ev.end))
          if (b <= a) return null
          const meta = STATE_META[ev.state]
          const reason = reasonName?.(ev.reasonId)
          return (
            <Tooltip key={`${ev.start}-${i}`}>
              <TooltipTrigger asChild>
                <div
                  className={cn("absolute top-0 h-full", meta.bg, ev.state === "NO_COMM" && "bg-stripes")}
                  style={{ left: `${((a - s) / span) * 100}%`, width: `${Math.max(0.15, ((b - a) / span) * 100)}%` }}
                />
              </TooltipTrigger>
              <TooltipContent>
                <div className="font-medium">{meta.label}</div>
                <div className="tabular-nums">
                  {time(ev.start)}–{time(ev.end)} · {duration((Date.parse(ev.end) - Date.parse(ev.start)) / 1000)}
                </div>
                {ev.faultCode !== undefined && <div>Código de falha: {ev.faultCode}</div>}
                {ev.state !== "RUNNING" && <div>{reason ?? "Motivo não informado"}</div>}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      {showAxis && (
        <div className="relative mt-1 h-4 text-[10px] text-muted-foreground tabular-nums">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${((t - s) / span) * 100}%` }}>
              {time(new Date(t).toISOString())}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Legenda de cores dos estados. */
export function StateLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {(Object.keys(STATE_META) as (keyof typeof STATE_META)[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-sm", STATE_META[k].bg, k === "NO_COMM" && "bg-stripes")} />
          {STATE_META[k].label}
        </span>
      ))}
    </div>
  )
}
