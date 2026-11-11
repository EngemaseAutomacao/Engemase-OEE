import { BoxesIcon, CheckCircle2Icon, FactoryIcon, GaugeIcon, TimerIcon, ZapIcon } from "lucide-react"

import { num, pct } from "@/lib/format"
import { TONE_HEX, TONE_TEXT, oeeTone } from "@/lib/states"
import type { OeeValues } from "@/lib/mock/types"
import { KpiCard } from "@/components/oee/kpi-card"

export const OEE_TONE_LABEL = {
  good: "Classe mundial (≥ 85%)",
  warn: "Aceitável (60–85%)",
  bad: "Crítico (< 60%)",
  none: "Sem dados no turno",
} as const

function Bar({ value }: { value: number }) {
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, value * 100)}%`, background: TONE_HEX[oeeTone(value)] }} />
    </div>
  )
}

/** Linha de KPIs do turno corrente (visão geral do cliente). */
export function OverviewKpis({
  oee,
  machinesWithData,
  machinesTotal,
  running,
  production,
}: {
  oee: OeeValues
  machinesWithData: number
  machinesTotal: number
  running: number
  production: { total: number; good: number; reject: number; target: number }
}) {
  const hasData = machinesWithData > 0
  const tone = hasData ? oeeTone(oee.oee) : "none"
  const v = (x: number) => (hasData ? x : null)
  const rejectRate = production.total > 0 ? production.reject / production.total : null

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        label="OEE do turno"
        icon={GaugeIcon}
        value={pct(v(oee.oee))}
        valueClassName={TONE_TEXT[tone]}
        hint={hasData ? `${OEE_TONE_LABEL[tone]} · ${machinesWithData} de ${machinesTotal} máquinas` : OEE_TONE_LABEL.none}
        className="ring-1 ring-primary/10"
      >
        {hasData && <Bar value={oee.oee} />}
      </KpiCard>
      <KpiCard
        label="Disponibilidade"
        icon={TimerIcon}
        value={pct(v(oee.availability))}
        valueClassName={TONE_TEXT[hasData ? oeeTone(oee.availability) : "none"]}
        hint="Tempo produzindo ÷ planejado"
      >
        {hasData && <Bar value={oee.availability} />}
      </KpiCard>
      <KpiCard
        label="Performance"
        icon={ZapIcon}
        value={pct(v(oee.performance))}
        valueClassName={TONE_TEXT[hasData ? oeeTone(oee.performance) : "none"]}
        hint="Ritmo real ÷ ciclo ideal"
      >
        {hasData && <Bar value={oee.performance} />}
      </KpiCard>
      <KpiCard
        label="Qualidade"
        icon={CheckCircle2Icon}
        value={pct(v(oee.quality))}
        valueClassName={TONE_TEXT[hasData ? oeeTone(oee.quality) : "none"]}
        hint="Peças boas ÷ total"
      >
        {hasData && <Bar value={oee.quality} />}
      </KpiCard>
      <KpiCard
        label="Produzindo"
        icon={FactoryIcon}
        value={
          <>
            {running}
            <span className="text-base font-normal text-muted-foreground"> / {machinesTotal}</span>
          </>
        }
        hint={machinesTotal > 0 ? `${pct(running / machinesTotal, 0)} das máquinas agora` : "Nenhuma máquina"}
      />
      <KpiCard
        label="Peças boas"
        icon={BoxesIcon}
        value={num(production.good)}
        hint={
          rejectRate === null ? (
            "Nenhuma peça no turno"
          ) : (
            <>
              Refugo <span className="font-medium text-state-fault tabular-nums">{num(production.reject)}</span> ({pct(rejectRate)})
            </>
          )
        }
      />
    </div>
  )
}
