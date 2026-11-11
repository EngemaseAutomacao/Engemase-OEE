import { ClockIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { time } from "@/lib/format"
import type { ShiftInfo } from "@/components/monitoring/queries"

/** Selo do turno corrente: nome, janela, progresso e hora "agora" (ao vivo). */
export function ShiftStatus({ shift, className }: { shift: ShiftInfo; className?: string }) {
  return (
    <div className={cn("flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm shadow-xs sm:w-auto", className)}>
      <ClockIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 sm:w-52 sm:flex-none">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{shift.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {time(shift.start)}–{time(shift.end)}
          </span>
        </div>
        <div
          className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Andamento do turno"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(shift.progress * 100)}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${shift.progress * 100}%` }} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end border-l pl-3 leading-tight">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-state-running uppercase">
          <span className="relative inline-flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-state-running opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-state-running" />
          </span>
          Ao vivo
        </span>
        <span className="font-semibold tabular-nums">{time(shift.now)}</span>
      </div>
    </div>
  )
}
