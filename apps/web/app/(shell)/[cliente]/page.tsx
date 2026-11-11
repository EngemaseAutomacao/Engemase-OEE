import Link from "next/link"
import { notFound } from "next/navigation"
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  ClipboardCheckIcon,
  ClockIcon,
  CoffeeIcon,
  EyeIcon,
  FactoryIcon,
  GaugeIcon,
  PackageCheckIcon,
  PauseIcon,
  PlayIcon,
  TargetIcon,
  WifiOffIcon,
  WrenchIcon,
} from "lucide-react"

import { getClientBySlug, getCurrentUser, getUnits } from "@/lib/mock"
import { num, pct } from "@/lib/format"
import { STATE_META, TONE_HEX, oeeTone } from "@/lib/states"
import { cn } from "@/lib/utils"
import { ActivityTimeline, type TimelineEvent } from "@/components/dashboard/activity-timeline"
import { Donut } from "@/components/dashboard/donut"
import { Gauge } from "@/components/dashboard/gauge"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { Ring } from "@/components/dashboard/ring"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { StatePipeline } from "@/components/dashboard/state-pipeline"
import { ForecastChart } from "@/components/overview/forecast-chart"
import { buildOverview } from "@/components/overview/overview-data"
import { TargetChart } from "@/components/overview/target-chart"
import { UnitSelector } from "@/components/shell/unit-selector"

const TIMELINE_ICON = {
  start: { icon: PlayIcon, tone: "teal" },
  fault: { icon: AlertTriangleIcon, tone: "red" },
  setup: { icon: WrenchIcon, tone: "violet" },
  break: { icon: CoffeeIcon, tone: "navy" },
  gateway: { icon: WifiOffIcon, tone: "orange" },
  now: { icon: ClockIcon, tone: "blue" },
} as const

export default async function Page({ params }: PageProps<"/[cliente]">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const me = getCurrentUser()
  const firstName = me.name.split(" ")[0]
  const units = getUnits(client.id)
  const d = buildOverview(client.id, client.slug)
  const b = `/${client.slug}`

  const goalFraction = d.target.target > 0 ? d.target.monthOee / d.target.target : 0
  const gap = (d.target.target - d.target.monthOee) * 100

  const timeline: TimelineEvent[] = d.timeline.map((e) => ({ ...e, ...TIMELINE_ICON[e.kind] }))

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      {/* Saudação + período */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bom dia, {firstName} 👋</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Veja o que está acontecendo em {client.name} neste turno.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium shadow-xs">
            <CalendarClockIcon className="size-4 text-muted-foreground" />
            1º turno · 11/11 · 06:00–14:00
          </span>
          <UnitSelector units={units.map((u) => ({ id: u.id, name: u.name }))} />
        </div>
      </div>

      {/* Indicadores */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={GaugeIcon} tone="blue" label="OEE do turno" value={pct(d.kpis.oee)} delta={d.kpis.oeeDelta} deltaLabel="vs ontem" />
        <StatCard icon={PackageCheckIcon} tone="navy" label="Peças boas" value={num(d.kpis.good)} delta={d.kpis.goodDelta} deltaLabel="vs ontem" />
        <StatCard
          icon={FactoryIcon}
          tone="orange"
          label="Máquinas produzindo"
          value={
            <>
              {d.kpis.running}
              <span className="text-base font-semibold text-muted-foreground"> / {d.kpis.total}</span>
            </>
          }
          hint={`${num(d.kpis.reject)} refugadas no turno`}
        />
        <StatCard
          icon={TargetIcon}
          tone="teal"
          label="Meta de OEE"
          value={pct(d.target.target, 0)}
          hint={`${pct(d.kpis.oee / d.target.target, 0)} da meta`}
          aside={<Ring value={d.kpis.oee / d.target.target} size={58} stroke={7} color="#0e9384" />}
        />
      </div>

      {/* Estados + meta */}
      <div className="grid gap-4 xl:grid-cols-12">
        <SectionCard title="Máquinas por estado" description="Situação agora · toque para abrir a máquina" href={`${b}/maquinas`} className="xl:col-span-8">
          <StatePipeline stages={d.stages} maxItems={4} />
        </SectionCard>

        <SectionCard title="Meta de OEE do mês" href={`${b}/relatorios/oee`} linkLabel="Ver relatório" className="xl:col-span-4">
          <div className="grid grid-cols-[auto_1fr] items-end gap-4">
            <dl className="grid gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Meta</dt>
                <dd className="text-lg font-bold tabular-nums">{pct(d.target.target, 0)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Acumulado</dt>
                <dd className="text-base font-bold text-primary tabular-nums">{pct(d.target.monthOee)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Faltam</dt>
                <dd className="text-base font-bold text-[#cf5539] tabular-nums">{gap > 0 ? `${gap.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.` : "Meta atingida"}</dd>
              </div>
            </dl>
            <Gauge value={goalFraction} width={190} stroke={20} color="#0e9384" center={pct(goalFraction, 0)} caption="da meta do mês" />
          </div>
          <TargetChart days={d.target.last12} target={d.target.target} />
        </SectionCard>
      </div>

      {/* Tempo do turno · ranking · paradas */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <SectionCard title="Tempo do turno" description="Soma das máquinas, por estado" href={`${b}/relatorios/paradas`}>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <Donut segments={d.donut} size={140} stroke={22} center={`${Math.round(d.donutTotal / 60)}h`} caption="máquina-hora" />
            <ul className="grid w-full gap-2 text-xs">
              {d.donut.map((s) => (
                <li key={s.label} className="flex items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-[4.5rem] flex-1 truncate text-muted-foreground">{s.label}</span>
                  <span className="font-semibold tabular-nums">{(s.value / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h</span>
                  <span className="w-9 text-right text-muted-foreground tabular-nums">{pct(s.value / (d.donutTotal || 1), 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        </SectionCard>

        <SectionCard title="Desempenho das máquinas" description="OEE do turno até agora" href={`${b}/relatorios/oee`} linkLabel="Ranking completo">
          <ul className="grid gap-3">
            {d.ranking.slice(0, 5).map((m) => (
              <li key={m.id}>
                <Link href={m.href} className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1">
                  <span
                    className="row-span-2 flex size-9 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{ background: `color-mix(in oklab, ${STATE_META[m.state].hex} 15%, transparent)`, color: STATE_META[m.state].hex }}
                  >
                    {m.name.match(/\d+/)?.[0] ?? m.name.slice(0, 2)}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium group-hover:text-primary">
                    {m.name} <span className="text-xs font-normal text-muted-foreground">· {m.line}</span>
                  </span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: TONE_HEX[oeeTone(m.oee)] }}>
                    {pct(m.oee)}
                  </span>
                  <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, m.oee * 100)}%` }} />
                  </span>
                </Link>
              </li>
            ))}
            {d.ranking.length === 0 && <li className="text-sm text-muted-foreground">Sem dados no turno.</li>}
          </ul>
        </SectionCard>

        <SectionCard
          title="Paradas para classificar"
          description={`${d.pending.length} sem motivo no turno`}
          href={d.pending[0]?.href ?? `${b}/maquinas`}
          linkLabel="Classificar"
          className="lg:col-span-2 xl:col-span-1"
        >
          <ul className="divide-y">
            {d.pending.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className={cn("w-11 shrink-0 text-xs font-semibold tabular-nums", p.state === "FAULT" ? "text-state-fault" : "text-amber-600 dark:text-state-stopped")}>
                  {p.time}
                </span>
                <IconCircle icon={p.state === "FAULT" ? AlertTriangleIcon : PauseIcon} tone={p.state === "FAULT" ? "red" : "amber"} soft size="sm" />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm font-medium">{p.machine}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {STATE_META[p.state].short} · {p.duration}
                    {p.open && " · agora"}
                  </span>
                </span>
                <Link
                  href={p.href}
                  aria-label={`Classificar parada da ${p.machine}`}
                  className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition hover:bg-primary/20"
                >
                  <ClipboardCheckIcon className="size-4" />
                </Link>
                <Link
                  href={p.detail}
                  aria-label={`Ver ${p.machine}`}
                  className="flex size-8 items-center justify-center rounded-lg bg-[#0e9384]/10 text-[#0e9384] transition hover:bg-[#0e9384]/20"
                >
                  <EyeIcon className="size-4" />
                </Link>
              </li>
            ))}
            {d.pending.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Nenhuma parada pendente. 👏</li>}
          </ul>
        </SectionCard>
      </div>

      {/* Linha do tempo + previsão */}
      <div className="grid gap-4 xl:grid-cols-12">
        <SectionCard title="Linha do tempo do turno" description="Principais acontecimentos de hoje" href={`${b}/config/auditoria`} className="xl:col-span-7">
          <div className="flex h-full flex-col justify-between gap-5 pt-2">
            <ActivityTimeline events={timeline} />
            <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/60 p-3 sm:grid-cols-4">
              {[
                { label: "Paradas no turno", value: num(d.stopSummary.count) },
                { label: "Tempo parado", value: `${num(d.stopSummary.minutes)} min` },
                { label: "Micro-paradas", value: num(d.stopSummary.micro) },
                { label: "Maior parada", value: d.stopSummary.longest },
              ].map((x) => (
                <div key={x.label} className="min-w-0">
                  <dt className="truncate text-[11px] text-muted-foreground">{x.label}</dt>
                  <dd className="truncate text-sm font-semibold tabular-nums">{x.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </SectionCard>

        <SectionCard title="Previsão de produção" description="Peças boas acumuladas no turno" href={`${b}/relatorios/oee`} linkLabel="Ver detalhes" className="xl:col-span-5">
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <dl className="grid content-start gap-2.5 text-xs">
              <div>
                <dt className="text-muted-foreground">Previsto até 14:00</dt>
                <dd className="text-xl font-bold tabular-nums">{num(d.forecast.predicted)}</dd>
                {d.forecast.delta !== null && (
                  <dd className={cn("font-semibold", d.forecast.delta >= 0 ? "text-state-running" : "text-state-fault")}>
                    {d.forecast.delta >= 0 ? "↑" : "↓"} {Math.abs(d.forecast.delta).toLocaleString("pt-BR")}% vs ontem
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-muted-foreground">Melhor cenário</dt>
                <dd className="text-sm font-bold text-[#0e9384] tabular-nums">{num(d.forecast.best)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Meta do turno</dt>
                <dd className="text-sm font-bold tabular-nums">{num(d.forecast.target)}</dd>
              </div>
            </dl>
            <ForecastChart labels={d.forecast.labels} actual={d.forecast.actual} projection={d.forecast.projection} predicted={d.forecast.predicted} />
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
