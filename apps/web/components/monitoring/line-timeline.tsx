"use client"

import type { StateEvent } from "@/lib/mock/types"
import { StateTimeline } from "@/components/oee/state-timeline"

/** Linha do tempo de uma máquina na tela da linha; recebe os nomes dos motivos já resolvidos (serializáveis). */
export function LineTimeline({
  events,
  start,
  end,
  reasons,
  className,
}: {
  events: StateEvent[]
  start: string
  end: string
  reasons: Record<string, string>
  className?: string
}) {
  return (
    <StateTimeline
      events={events}
      start={start}
      end={end}
      height={22}
      showAxis={false}
      reasonName={(id) => (id ? reasons[id] : undefined)}
      className={className}
    />
  )
}
