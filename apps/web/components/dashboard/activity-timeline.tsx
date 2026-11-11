import type { LucideIcon } from "lucide-react"

import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"

export interface TimelineEvent {
  id: string
  icon: LucideIcon
  tone: IconTone
  title: string
  subtitle: string
  time: string
}

/** Linha do tempo horizontal (eventos em círculos ligados por uma linha). */
export function ActivityTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <ol className="relative flex min-w-[560px] justify-between gap-2">
        <span className="absolute top-[22px] right-8 left-8 border-t-2 border-dashed border-border" aria-hidden />
        {events.map((e) => (
          <li key={e.id} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
            <IconCircle icon={e.icon} tone={e.tone} className="ring-4 ring-card" />
            <span className="mt-2 line-clamp-1 text-xs font-semibold">{e.title}</span>
            <span className="line-clamp-1 text-[11px] text-muted-foreground">{e.subtitle}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">{e.time}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
