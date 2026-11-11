import { cn } from "@/lib/utils"
import { pct } from "@/lib/format"
import { STATE_META, STATE_ORDER } from "@/lib/states"
import type { MachineState } from "@/lib/mock/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { StateDot } from "@/components/oee/state-badge"

/** Resumo de estados: barra de distribuição + contagem por estado. */
export function StateSummary({ counts, className }: { counts: Record<MachineState, number>; className?: string }) {
  const total = STATE_ORDER.reduce((s, k) => s + counts[k], 0)
  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle>Estados agora</CardTitle>
        <CardDescription>
          {total} {total === 1 ? "máquina monitorada" : "máquinas monitoradas"}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          {STATE_ORDER.filter((k) => counts[k] > 0).map((k) => (
            <div
              key={k}
              className={cn("h-full first:rounded-l-full last:rounded-r-full", STATE_META[k].bg, k === "NO_COMM" && "bg-stripes")}
              style={{ width: `${(counts[k] / Math.max(1, total)) * 100}%` }}
            />
          ))}
        </div>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {STATE_ORDER.map((k) => (
            <li key={k} className={cn("flex items-center gap-2 text-sm", counts[k] === 0 && "opacity-50")}>
              <StateDot state={k} pulse={k === "FAULT" && counts[k] > 0} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{STATE_META[k].label}</span>
              <span className="font-semibold tabular-nums">{counts[k]}</span>
            </li>
          ))}
        </ul>
        {total > 0 && (
          <p className="text-xs text-muted-foreground">
            {pct(counts.RUNNING / total, 0)} da frota produzindo
            {counts.FAULT + counts.STOPPED > 0 && ` · ${counts.FAULT + counts.STOPPED} em parada não planejada`}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
