"use client"

import { cn } from "@/lib/utils"
import { WEEKDAYS, minToHm } from "@/components/config/labels"
import {
  WEEK_MIN,
  addDays,
  breakIntervals,
  clipToRows,
  dm,
  shiftIntervals,
  weekMinutes,
  type PlannedStop,
  type ShiftRow,
} from "@/components/config/shift-utils"

const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]
const pctOf = (min: number) => `${(min / 1440) * 100}%`

const STRIPES = "bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.7)_0_3px,transparent_3px_7px)]"

/**
 * Régua de 24 h da semana atual: uma linha por dia (seg → dom), com os turnos,
 * as pausas (listradas), as paradas planejadas da semana e o "agora".
 */
export function ShiftRuler({
  shifts,
  colors,
  stops,
  weekStart,
  today,
  nowMin,
}: {
  shifts: ShiftRow[]
  colors: Record<string, string>
  stops: PlannedStop[]
  weekStart: string
  today: string
  nowMin: number
}) {
  type Seg = { key: string; row: number; from: number; to: number; label: string; title: string; className: string; kind: "shift" | "break" | "stop" }
  const segs: Seg[] = []

  for (const s of shifts) {
    shiftIntervals(s).forEach((iv, i) =>
      clipToRows(iv).forEach((c, j) =>
        segs.push({
          key: `${s.id}-${i}-${j}`,
          ...c,
          label: s.name,
          title: `${s.name} · ${s.start}–${s.end}`,
          className: colors[s.id],
          kind: "shift",
        }),
      ),
    )
    breakIntervals(s).forEach((iv, i) =>
      clipToRows(iv).forEach((c, j) =>
        segs.push({
          key: `${s.id}-b${i}-${j}`,
          ...c,
          label: "",
          title: `${iv.name} · ${minToHm(iv.from)}–${minToHm(iv.to)} (${s.name})`,
          className: cn("bg-white/30", STRIPES),
          kind: "break",
        }),
      ),
    )
  }

  for (const p of stops) {
    const from = Math.max(0, weekMinutes(weekStart, p.startDate, p.startTime))
    const to = Math.min(WEEK_MIN, weekMinutes(weekStart, p.endDate, p.endTime))
    if (to <= from) continue
    clipToRows({ from, to }).forEach((c, j) =>
      segs.push({
        key: `${p.id}-${j}`,
        ...c,
        label: "",
        title: `${p.title} · parada planejada${p.scope === "unit" ? " (unidade inteira)" : ` (${p.scope.length} máquina(s))`}`,
        className: cn(p.scope === "unit" ? "bg-state-planned/85" : "bg-state-planned/45", STRIPES),
        kind: "stop",
      }),
    )
  }

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="min-w-[620px]">
        {/* Escala de horas */}
        <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2">
          <span />
          <div className="relative h-5">
            {TICKS.map((h) => (
              <span
                key={h}
                className={cn("absolute top-0 text-[10px] text-muted-foreground tabular-nums", h === 0 ? "" : h === 24 ? "-translate-x-full" : "-translate-x-1/2")}
                style={{ left: pctOf(h * 60) }}
              >
                {String(h).padStart(2, "0")}h
              </span>
            ))}
          </div>
        </div>

        <ol className="flex flex-col gap-1.5">
          {WEEKDAYS.map((w, row) => {
            const date = addDays(weekStart, row)
            const isToday = date === today
            return (
              <li key={w.d} className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-2">
                <span className={cn("flex items-baseline gap-1.5 text-xs", isToday ? "font-semibold text-primary" : "text-muted-foreground")}>
                  <span className={cn(isToday && "rounded-md bg-primary px-1.5 py-0.5 text-primary-foreground")}>{w.label}</span>
                  <span className="text-[10px] tabular-nums">{dm(date)}</span>
                </span>
                <div className={cn("relative h-7 overflow-hidden rounded-lg bg-muted/70", isToday && "ring-1 ring-primary/30")}>
                  {TICKS.slice(1, -1).map((h) => (
                    <span key={h} className="absolute inset-y-0 border-l border-dashed border-foreground/10" style={{ left: pctOf(h * 60) }} />
                  ))}
                  {segs
                    .filter((s) => s.row === row)
                    .map((s) => (
                      <span
                        key={s.key}
                        title={s.title}
                        className={cn(
                          "absolute flex items-center overflow-hidden px-1.5 text-[10px] font-semibold whitespace-nowrap text-white",
                          s.kind === "shift" ? "inset-y-0.5 rounded-md" : s.kind === "break" ? "inset-y-0.5" : "inset-y-0 z-10",
                          s.className,
                        )}
                        style={{ left: pctOf(s.from), width: pctOf(s.to - s.from) }}
                      >
                        {s.kind === "shift" && s.to - s.from >= 150 ? s.label : null}
                      </span>
                    ))}
                  {isToday && (
                    <span className="absolute inset-y-0 z-20 w-0.5 bg-state-fault" style={{ left: pctOf(nowMin) }} title={`Agora · ${minToHm(nowMin)}`}>
                      <span className="absolute -top-0.5 -left-[3px] size-2 rounded-full bg-state-fault" />
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
