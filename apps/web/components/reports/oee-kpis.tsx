import { BoxesIcon, CheckCircle2Icon, GaugeIcon, TimerIcon, TimerOffIcon, ZapIcon } from "lucide-react"

import { num, pct } from "@/lib/format"
import { TONE_HEX, TONE_TEXT, oeeTone } from "@/lib/states"
import { KpiCard } from "@/components/oee/kpi-card"
import { Delta } from "./delta"
import type { OeeAgg } from "./oee-calc"
import { hours } from "./report-utils"

const TONE_LABEL = {
  good: "Classe mundial (≥ 85%)",
  warn: "Aceitável (60–85%)",
  bad: "Crítico (< 60%)",
  none: "Sem dados no período",
} as const

const pp = (abs: number) => `${(abs * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p.`
const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b)

function Bar({ value }: { value: number | null }) {
  if (value === null) return null
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, value * 100)}%`, background: TONE_HEX[oeeTone(value)] }} />
    </div>
  )
}

/** KPIs do período filtrado, com variação em relação ao período anterior de mesmo tamanho. */
export function OeeKpis({ current, previous, periodDays }: { current: OeeAgg; previous: OeeAgg | null; periodDays: number }) {
  const vs = `vs. ${periodDays} dias anteriores`
  const prev = previous && previous.rows > 0 ? previous : null
  const tone = oeeTone(current.oee)
  const stopMin = current.plannedMin - current.runMin
  const prevStopMin = prev ? prev.plannedMin - prev.runMin : null
  const rejectRate = current.total > 0 ? current.reject / current.total : null

  const metric = (key: "availability" | "performance" | "quality") => (
    <Delta value={diff(current[key], prev?.[key] ?? null)} better="up" format={pp} label={vs} epsilon={0.0005} />
  )

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        label="OEE do período"
        icon={GaugeIcon}
        value={pct(current.oee)}
        valueClassName={TONE_TEXT[tone]}
        className="ring-1 ring-primary/10"
        hint={
          <span className="flex flex-col gap-0.5">
            <span>{TONE_LABEL[tone]}</span>
            <Delta value={diff(current.oee, prev?.oee ?? null)} better="up" format={pp} label={vs} epsilon={0.0005} />
          </span>
        }
      >
        <Bar value={current.oee} />
      </KpiCard>
      <KpiCard
        label="Disponibilidade"
        icon={TimerIcon}
        value={pct(current.availability)}
        valueClassName={TONE_TEXT[oeeTone(current.availability)]}
        hint={metric("availability")}
      >
        <Bar value={current.availability} />
      </KpiCard>
      <KpiCard
        label="Performance"
        icon={ZapIcon}
        value={pct(current.performance)}
        valueClassName={TONE_TEXT[oeeTone(current.performance)]}
        hint={metric("performance")}
      >
        <Bar value={current.performance} />
      </KpiCard>
      <KpiCard
        label="Qualidade"
        icon={CheckCircle2Icon}
        value={pct(current.quality)}
        valueClassName={TONE_TEXT[oeeTone(current.quality)]}
        hint={metric("quality")}
      >
        <Bar value={current.quality} />
      </KpiCard>
      <KpiCard
        label="Peças boas"
        icon={BoxesIcon}
        value={num(current.good)}
        hint={
          rejectRate === null ? (
            "Nenhuma peça no período"
          ) : (
            <>
              de {num(current.total)} · refugo <span className="font-medium text-state-fault tabular-nums">{num(current.reject)}</span> ({pct(rejectRate)})
            </>
          )
        }
      />
      <KpiCard
        label="Tempo parado"
        icon={TimerOffIcon}
        value={hours(stopMin)}
        hint={
          <span className="flex flex-col gap-0.5">
            <span>{current.plannedMin > 0 ? `${pct(stopMin / current.plannedMin)} do tempo planejado` : "Sem tempo planejado"}</span>
            <Delta
              value={prevStopMin === null ? null : stopMin - prevStopMin}
              better="down"
              format={(abs) => hours(abs)}
              label={vs}
              epsilon={0.5}
            />
          </span>
        }
      />
    </div>
  )
}
