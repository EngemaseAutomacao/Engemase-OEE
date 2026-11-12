import { BoxesIcon, CheckCircle2Icon, GaugeIcon, TimerIcon, TimerOffIcon, ZapIcon } from "lucide-react"

import { num, pct } from "@/lib/format"
import { TONE_HEX, TONE_TEXT, oeeTone } from "@/lib/states"
import { Ring } from "@/components/dashboard/ring"
import { StatCard } from "@/components/dashboard/stat-card"
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

/** Dica de duas linhas dentro do StatCard (o cartão trunca uma linha só). */
function Hint({ children }: { children: React.ReactNode }) {
  return <span className="flex flex-col gap-0.5 whitespace-normal">{children}</span>
}

function ToneRing({ value }: { value: number | null }) {
  return <Ring value={value ?? 0} size={48} stroke={5} color={TONE_HEX[oeeTone(value)]} />
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
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <StatCard
        icon={GaugeIcon}
        tone="blue"
        label="OEE do período"
        value={<span className={TONE_TEXT[tone]}>{pct(current.oee)}</span>}
        className="ring-1 ring-primary/10"
        hint={
          <Hint>
            <span>{TONE_LABEL[tone]}</span>
            <Delta value={diff(current.oee, prev?.oee ?? null)} better="up" format={pp} label={vs} epsilon={0.0005} />
          </Hint>
        }
        aside={<ToneRing value={current.oee} />}
      />
      <StatCard
        icon={TimerIcon}
        tone="teal"
        label="Disponibilidade"
        value={<span className={TONE_TEXT[oeeTone(current.availability)]}>{pct(current.availability)}</span>}
        hint={metric("availability")}
      />
      <StatCard
        icon={ZapIcon}
        tone="navy"
        label="Performance"
        value={<span className={TONE_TEXT[oeeTone(current.performance)]}>{pct(current.performance)}</span>}
        hint={metric("performance")}
      />
      <StatCard
        icon={CheckCircle2Icon}
        tone="orange"
        label="Qualidade"
        value={<span className={TONE_TEXT[oeeTone(current.quality)]}>{pct(current.quality)}</span>}
        hint={metric("quality")}
      />
      <StatCard
        icon={BoxesIcon}
        tone="green"
        label="Peças boas"
        value={num(current.good)}
        hint={
          rejectRate === null ? (
            "Nenhuma peça no período"
          ) : (
            <Hint>
              <span>de {num(current.total)} produzidas</span>
              <span>
                refugo <span className="font-medium text-state-fault tabular-nums">{num(current.reject)}</span> ({pct(rejectRate)})
              </span>
            </Hint>
          )
        }
      />
      <StatCard
        icon={TimerOffIcon}
        tone="red"
        label="Tempo parado"
        value={hours(stopMin)}
        hint={
          <Hint>
            <span>{current.plannedMin > 0 ? `${pct(stopMin / current.plannedMin)} do tempo planejado` : "Sem tempo planejado"}</span>
            <Delta value={prevStopMin === null ? null : stopMin - prevStopMin} better="down" format={(abs) => hours(abs)} label={vs} epsilon={0.5} />
          </Hint>
        }
      />
    </div>
  )
}
