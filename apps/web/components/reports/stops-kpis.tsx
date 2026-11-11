import { ActivityIcon, HelpCircleIcon, HourglassIcon, ListOrderedIcon, WrenchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { duration, num, pct } from "@/lib/format"
import { TONE_TEXT } from "@/lib/states"
import { KpiCard } from "@/components/oee/kpi-card"
import { Delta } from "./delta"
import { hours } from "./report-utils"
import type { StopSummary } from "./stops-calc"

const diff = (a: number | null, b: number | null | undefined) => (a === null || b === null || b === undefined ? null : a - b)
const pp = (abs: number) => `${(abs * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p.`
const minutes = (abs: number) => duration(abs * 60)

/** Faixas para % de paradas sem motivo: até 5% ok, até 10% atenção, acima disso crítico. */
function unclassifiedTone(rate: number | null) {
  if (rate === null) return "none" as const
  if (rate <= 0.05) return "good" as const
  if (rate <= 0.1) return "warn" as const
  return "bad" as const
}

export function StopsKpis({
  current,
  previous,
  periodDays,
  machineCount,
  categoryLabel,
}: {
  current: StopSummary
  previous: StopSummary | null
  periodDays: number
  machineCount: number
  categoryLabel: string | null
}) {
  const vs = `vs. ${periodDays} dias anteriores`
  const perMachineDay = machineCount > 0 ? current.occurrences / (machineCount * periodDays) : null
  const tone = unclassifiedTone(current.unclassifiedRate)

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <KpiCard
        label="Tempo total parado"
        icon={HourglassIcon}
        value={hours(current.totalMin)}
        className="col-span-2 ring-1 ring-primary/10 sm:col-span-1"
        hint={
          <span className="flex flex-col gap-0.5">
            <span>
              {categoryLabel ? `${categoryLabel} · ` : ""}
              {current.plannedMin > 0 ? `≈ ${pct(current.totalMin / current.plannedMin)} das horas de turno` : "Sem turnos no período"}
            </span>
            <Delta value={diff(current.totalMin, previous?.totalMin)} better="down" format={(abs) => hours(abs)} label={vs} epsilon={0.5} />
          </span>
        }
      />
      <KpiCard
        label="Ocorrências"
        icon={ListOrderedIcon}
        value={num(current.occurrences)}
        hint={
          <span className="flex flex-col gap-0.5">
            <span>{perMachineDay === null ? "—" : `${perMachineDay.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por máquina por dia`}</span>
            <Delta value={diff(current.occurrences, previous?.occurrences)} better="down" format={(abs) => num(abs)} label={vs} />
          </span>
        }
      />
      <KpiCard
        label="MTBF estimado"
        icon={ActivityIcon}
        value={current.mtbfMin === null ? "—" : duration(current.mtbfMin * 60)}
        hint={
          <span className="flex flex-col gap-0.5">
            <span>Tempo médio entre paradas não planejadas</span>
            <Delta value={diff(current.mtbfMin, previous?.mtbfMin)} better="up" format={minutes} label={vs} epsilon={0.5} />
          </span>
        }
      />
      <KpiCard
        label="MTTR estimado"
        icon={WrenchIcon}
        value={current.mttrMin === null ? "—" : duration(current.mttrMin * 60)}
        hint={
          <span className="flex flex-col gap-0.5">
            <span>Duração média das paradas não planejadas</span>
            <Delta value={diff(current.mttrMin, previous?.mttrMin)} better="down" format={minutes} label={vs} epsilon={0.05} />
          </span>
        }
      />
      <KpiCard
        label="Paradas sem motivo"
        icon={HelpCircleIcon}
        value={pct(current.unclassifiedRate)}
        valueClassName={cn(TONE_TEXT[tone])}
        hint={
          <span className="flex flex-col gap-0.5">
            <span>
              {num(current.unclassifiedOcc)} ocorrências · {hours(current.unclassifiedMin)} sem classificação
            </span>
            <Delta value={diff(current.unclassifiedRate, previous?.unclassifiedRate)} better="down" format={pp} label={vs} epsilon={0.0005} />
          </span>
        }
      />
    </div>
  )
}
