"use client"

import { time } from "@/lib/format"
import type { StateEvent } from "@/lib/mock/types"
import { StateTimeline } from "@/components/oee/state-timeline"

const BAR_HEIGHT = 36

/**
 * Timeline de estados do turno com marcador de "agora".
 * Recebe o mapa id → caminho do motivo (serializável) e monta a função que o StateTimeline espera.
 */
export function MachineTimeline({
  events,
  start,
  end,
  now,
  reasonPaths,
}: {
  events: StateEvent[]
  start: string
  end: string
  now: string
  reasonPaths: Record<string, string>
}) {
  const s = Date.parse(start)
  const e = Date.parse(end)
  const nowPct = Math.min(100, Math.max(0, ((Date.parse(now) - s) / (e - s)) * 100))

  return (
    <div className="relative pt-5">
      <div
        className="pointer-events-none absolute top-0 z-10 flex -translate-x-1/2 flex-col items-center"
        style={{ left: `${nowPct}%`, height: BAR_HEIGHT + 20 }}
        aria-hidden
      >
        <span className="rounded bg-foreground px-1.5 py-px text-[10px] leading-4 font-medium text-background tabular-nums">
          {time(now)}
        </span>
        <span className="w-px flex-1 bg-foreground" />
      </div>
      <StateTimeline
        events={events}
        start={start}
        end={end}
        height={BAR_HEIGHT}
        reasonName={(id) => (id ? reasonPaths[id] : undefined)}
      />
    </div>
  )
}
