import { cn } from "@/lib/utils"
import { dec, duration, num, pct, time } from "@/lib/format"
import { STATE_META, STATE_ORDER, TONE_TEXT, oeeTone } from "@/lib/states"
import type { MachineLive, MachineState } from "@/lib/mock/types"
import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { OeeBreakdown } from "@/components/oee/oee-breakdown"
import { OeeRing } from "@/components/oee/oee-ring"
import { StateDot } from "@/components/oee/state-badge"
import { OEE_TONE_LABEL } from "@/components/monitoring/overview-kpis"

function PartialBadge({ lastUpdate }: { lastUpdate: string }) {
  return (
    <Badge variant="outline" className="text-amber-700 dark:text-state-stopped">
      Parcial · até {time(lastUpdate)}
    </Badge>
  )
}

/** Três cards de KPI do detalhe da máquina: OEE, produção e tempos do turno. */
export function MachineKpis({
  live,
  shiftLabel,
  durations,
  plannedElapsedS,
  idealCycleS,
  stops,
  pending,
  micro,
}: {
  live: MachineLive
  shiftLabel: string
  durations: Record<MachineState, number>
  plannedElapsedS: number
  idealCycleS: number
  stops: number
  pending: number
  micro: number
}) {
  const tone = oeeTone(live.shift.oee)
  const good = live.countShift - live.rejectShift
  const progress = live.targetShift > 0 ? live.countShift / live.targetShift : 0
  const realRate = plannedElapsedS > 0 ? live.countShift / (plannedElapsedS / 3600) : 0
  const idealRate = idealCycleS > 0 ? 3600 / idealCycleS : 0
  const totalS = STATE_ORDER.reduce((s, k) => s + durations[k], 0)

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Card className="gap-4">
        <CardHeader>
          <CardTitle>OEE do turno</CardTitle>
          <CardDescription>{shiftLabel}</CardDescription>
          {live.stale && (
            <CardAction>
              <PartialBadge lastUpdate={live.lastUpdate} />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          <OeeRing value={live.shift.oee} size={128} stroke={12} />
          <div className="grid w-full flex-1 gap-3">
            <OeeBreakdown values={live.shift} />
            <p className={cn("text-xs font-medium", TONE_TEXT[tone])}>{OEE_TONE_LABEL[tone]}</p>
            <p className="text-xs text-muted-foreground">
              OEE = D × P × Q = {pct(live.shift.availability, 0)} × {pct(live.shift.performance, 0)} × {pct(live.shift.quality, 0)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>Produção</CardTitle>
          <CardDescription>
            {live.productName} · {live.productCode}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-3xl font-semibold tabular-nums">{num(live.countShift)}</span>
              <span className="text-sm text-muted-foreground tabular-nums">meta {num(live.targetShift)}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{pct(progress, 0)} da meta do turno</div>
          </div>
          <dl className="grid grid-cols-3 gap-3 border-t pt-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Boas</dt>
              <dd className="font-semibold tabular-nums">{num(good)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Refugo</dt>
              <dd className="font-semibold text-state-fault tabular-nums">
                {num(live.rejectShift)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {live.countShift > 0 ? pct(live.rejectShift / live.countShift) : "—"}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ritmo (pç/h)</dt>
              <dd className="font-semibold tabular-nums">
                {num(realRate)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">/ {num(idealRate)}</span>
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Ciclo ideal {dec(idealCycleS)} s · ritmo real considera o tempo planejado decorrido
          </p>
        </CardContent>
      </Card>

      <Card className="gap-4 md:col-span-2 xl:col-span-1">
        <CardHeader>
          <CardTitle>Tempos do turno</CardTitle>
          <CardDescription>{duration(totalS)} decorridos desde o início do turno</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            {STATE_ORDER.filter((k) => durations[k] > 0).map((k) => (
              <div
                key={k}
                className={cn("h-full", STATE_META[k].bg, k === "NO_COMM" && "bg-stripes")}
                style={{ width: `${(durations[k] / Math.max(1, totalS)) * 100}%` }}
              />
            ))}
          </div>
          <ul className="grid gap-1.5 text-sm md:grid-cols-2 xl:grid-cols-1">
            {STATE_ORDER.filter((k) => durations[k] > 0).map((k) => (
              <li key={k} className="flex items-center gap-2">
                <StateDot state={k} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{STATE_META[k].label}</span>
                <span className="font-medium tabular-nums">{duration(durations[k])}</span>
                <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{pct(durations[k] / Math.max(1, totalS), 0)}</span>
              </li>
            ))}
          </ul>
          <p className="border-t pt-3 text-xs text-muted-foreground">
            {stops} {stops === 1 ? "parada" : "paradas"}
            {pending > 0 && (
              <>
                {" · "}
                <span className="font-medium text-amber-700 dark:text-state-stopped">{pending} sem motivo</span>
              </>
            )}
            {" · "}
            {micro} {micro === 1 ? "micro-parada" : "micro-paradas"} (performance)
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
