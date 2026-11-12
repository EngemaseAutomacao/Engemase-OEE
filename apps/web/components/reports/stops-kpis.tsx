import { ActivityIcon, HelpCircleIcon, HourglassIcon, ListOrderedIcon, WrenchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { duration, num, pct } from "@/lib/format"
import { TONE_HEX, TONE_TEXT } from "@/lib/states"
import { Ring } from "@/components/dashboard/ring"
import { StatCard } from "@/components/dashboard/stat-card"
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

/** Dica de duas linhas dentro do StatCard (o cartão trunca uma linha só). */
function Hint({ children }: { children: React.ReactNode }) {
  return <span className="flex flex-col gap-0.5 whitespace-normal">{children}</span>
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
  const share = current.plannedMin > 0 ? current.totalMin / current.plannedMin : null

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
      <StatCard
        icon={HourglassIcon}
        tone="orange"
        label="Tempo total parado"
        value={hours(current.totalMin)}
        className="ring-1 ring-primary/10 xl:col-span-3"
        hint={
          <Hint>
            <span>
              {categoryLabel ? `${categoryLabel} · ` : ""}
              {share !== null ? `≈ ${pct(share)} das horas de turno` : "Sem turnos no período"}
            </span>
            <Delta value={diff(current.totalMin, previous?.totalMin)} better="down" format={(abs) => hours(abs)} label={vs} epsilon={0.5} />
          </Hint>
        }
        aside={share !== null ? <Ring value={share} size={52} stroke={6} color="#e96549" /> : undefined}
      />
      <StatCard
        icon={ListOrderedIcon}
        tone="navy"
        label="Ocorrências"
        value={num(current.occurrences)}
        className="xl:col-span-3"
        hint={
          <Hint>
            <span>{perMachineDay === null ? "—" : `${perMachineDay.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por máquina por dia`}</span>
            <Delta value={diff(current.occurrences, previous?.occurrences)} better="down" format={(abs) => num(abs)} label={vs} />
          </Hint>
        }
      />
      <StatCard
        icon={ActivityIcon}
        tone="teal"
        label="MTBF estimado"
        value={current.mtbfMin === null ? "—" : duration(current.mtbfMin * 60)}
        className="xl:col-span-2"
        hint={
          <Hint>
            <span>Tempo médio entre paradas não planejadas</span>
            <Delta value={diff(current.mtbfMin, previous?.mtbfMin)} better="up" format={minutes} label={vs} epsilon={0.5} />
          </Hint>
        }
      />
      <StatCard
        icon={WrenchIcon}
        tone="blue"
        label="MTTR estimado"
        value={current.mttrMin === null ? "—" : duration(current.mttrMin * 60)}
        className="xl:col-span-2"
        hint={
          <Hint>
            <span>Duração média das paradas não planejadas</span>
            <Delta value={diff(current.mttrMin, previous?.mttrMin)} better="down" format={minutes} label={vs} epsilon={0.05} />
          </Hint>
        }
      />
      <StatCard
        icon={HelpCircleIcon}
        tone="amber"
        label="Paradas sem motivo"
        value={<span className={cn(TONE_TEXT[tone])}>{pct(current.unclassifiedRate)}</span>}
        className="sm:col-span-2 xl:col-span-2"
        hint={
          <Hint>
            <span>
              {num(current.unclassifiedOcc)} ocorrências · {hours(current.unclassifiedMin)} sem classificação
            </span>
            <Delta value={diff(current.unclassifiedRate, previous?.unclassifiedRate)} better="down" format={pp} label={vs} epsilon={0.0005} />
          </Hint>
        }
        aside={current.unclassifiedRate !== null ? <Ring value={current.unclassifiedRate} size={48} stroke={5} color={TONE_HEX[tone]} /> : undefined}
      />
    </div>
  )
}
