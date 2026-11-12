import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ActivityIcon, GaugeIcon, PackageCheckIcon, TrendingDownIcon, MonitorIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { STATE_META, STATE_ORDER, TONE_HEX, oeeTone } from "@/lib/states"
import { duration, num, pct, time } from "@/lib/format"
import {
  aggregateOee,
  getAreas,
  getClientBySlug,
  getDowntimeReasons,
  getHourlyProduction,
  getLine,
  getMachinesWithLive,
  getPareto,
  getTimeline,
  getUnit,
  lineParams,
  nowMs,
} from "@/lib/mock"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Donut } from "@/components/dashboard/donut"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { StateBadge } from "@/components/oee/state-badge"
import { StateLegend } from "@/components/oee/state-timeline"
import { LineTimeline } from "@/components/monitoring/line-timeline"
import { HourlyProductionChart, type HourlyPoint } from "@/components/monitoring/production-charts"
import { currentShift, productionTotals, stateCounts, stateDurations } from "@/components/monitoring/queries"
import { PageTitle } from "@/components/refresh/page-title"
import { SoftLink } from "@/components/refresh/soft-action"

const HOUR_MS = 60 * 60 * 1000

export async function generateStaticParams({ params }: { params: { cliente: string } }) {
  return lineParams(params.cliente)
}

export async function generateMetadata({ params }: PageProps<"/[cliente]/linhas/[linhaId]">): Promise<Metadata> {
  const { linhaId } = await params
  return { title: getLine(linhaId)?.name ?? "Linha" }
}

/** Tela da linha (RF05): estado das máquinas, OEE da linha pela soma das bases (docs/07) e a máquina que mais perde. */
export default async function Page({ params }: PageProps<"/[cliente]/linhas/[linhaId]">) {
  const { cliente, linhaId } = await params
  const client = getClientBySlug(cliente)
  const line = getLine(linhaId)
  if (!client || !line || line.clientId !== client.id) notFound()

  const slug = client.slug
  const unit = getUnit(line.unitId)
  const area = getAreas(line.unitId).find((a) => a.id === line.areaId)
  const machines = getMachinesWithLive(client.id, { lineId: line.id })
  const shift = currentShift()
  const agg = aggregateOee(machines)
  const hasData = agg.machinesWithData > 0
  const totals = productionTotals(machines)
  const counts = stateCounts(machines)
  const now = nowMs()

  // Por máquina: OEE do turno, tempo em cada estado e linha do tempo.
  const rows = machines.map((m) => {
    const events = getTimeline(m.id)
    const d = stateDurations(events)
    const lostS = d.STOPPED + d.FAULT + d.SETUP + d.NO_COMM
    const ok = !!m.live && !m.live.stale && m.live.countShift > 0
    return { m, events, lostS, ok, oee: ok ? m.live!.shift.oee : Number.NaN }
  })
  const withOee = rows.filter((r) => r.ok && Number.isFinite(r.oee))
  // Máquina que mais perde: menor OEE entre as que têm dado (em linha com máquinas em série, é o gargalo provável).
  const worst = withOee.reduce<(typeof rows)[number] | undefined>((w, r) => (!w || r.oee < w.oee ? r : w), undefined)

  // Rosca: tempo da linha por estado (soma das máquinas).
  const byState = Object.fromEntries(STATE_ORDER.map((s) => [s, 0])) as Record<(typeof STATE_ORDER)[number], number>
  for (const r of rows) for (const e of r.events) byState[e.state] += (Date.parse(e.end) - Date.parse(e.start)) / 1000
  const donut = STATE_ORDER.map((s) => ({ label: STATE_META[s].short, value: Math.round(byState[s] / 60), color: STATE_META[s].hex })).filter((x) => x.value > 0)
  const donutTotalMin = donut.reduce((s, x) => s + x.value, 0)

  // Produção por hora da linha = soma das máquinas.
  const series = machines.map((m) => getHourlyProduction(m.id))
  const hourly: HourlyPoint[] = (series[0] ?? []).map((h, i) => {
    const hs = Date.parse(h.hour)
    const future = hs >= now
    const total = series.reduce((s, sr) => s + (sr[i]?.total ?? 0), 0)
    const reject = series.reduce((s, sr) => s + (sr[i]?.reject ?? 0), 0)
    const target = series.reduce((s, sr) => s + (sr[i]?.target ?? 0), 0)
    return { label: time(h.hour), good: future ? null : total - reject, reject: future ? null : reject, target, partial: !future && hs + HOUR_MS > now }
  })

  const reasonNames = Object.fromEntries(getDowntimeReasons(client.id).map((r) => [r.id, r.name]))

  const pareto = getPareto(machines.map((m) => m.id)).slice(0, 5)
  const paretoMax = pareto[0]?.minutes ?? 1

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageTitle
        eyebrow={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={`/${slug}/maquinas`}>Máquinas</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>{unit?.name}</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{line.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {line.name}
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs font-medium text-muted-foreground">{line.code}</span>
          </span>
        }
        description={[area?.name, unit ? `${unit.name} (${unit.city}/${unit.state})` : undefined, `${shift.name} · ${time(shift.start)}–${time(shift.end)}`]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <SoftLink href={`/${slug}/andon/${line.id}`} tone="teal">
            <MonitorIcon />
            Andon da linha
          </SoftLink>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={GaugeIcon}
          label="OEE da linha"
          value={hasData ? pct(agg.oee) : "—"}
          hint={hasData ? `D ${pct(agg.availability, 0)} · P ${pct(agg.performance, 0)} · Q ${pct(agg.quality, 0)}` : "Sem dados no turno"}
        />
        <StatCard icon={PackageCheckIcon} tone="navy" label="Peças boas" value={num(totals.good)} hint={`${num(totals.reject)} refugadas · meta ${num(totals.target)}`} />
        <StatCard
          icon={ActivityIcon}
          tone="green"
          label="Máquinas produzindo"
          value={
            <>
              {counts.RUNNING}
              <span className="text-base font-semibold text-muted-foreground"> / {machines.length}</span>
            </>
          }
          hint={counts.FAULT > 0 ? `${counts.FAULT} em falha` : counts.STOPPED > 0 ? `${counts.STOPPED} parada(s)` : "nenhuma em falha"}
        />
        <StatCard
          icon={TrendingDownIcon}
          tone="orange"
          label="Máquina que mais perde"
          value={worst ? worst.m.name : "—"}
          hint={worst ? `OEE ${pct(worst.oee)} · ${duration(worst.lostS)} perdidos` : "Sem dados no turno"}
        />
      </div>

      <SectionCard title="Máquinas da linha" description="Estado ao vivo, OEE do turno e linha do tempo de estados" action={<StateLegend className="hidden lg:flex" />}>
        <ul className="grid gap-1 px-5 pb-5">
          {rows.map(({ m, events, oee, ok }) => {
            const state = m.live?.state ?? "NO_COMM"
            const progress = ok && m.live!.targetShift > 0 ? Math.min(1, (m.live!.countShift - m.live!.rejectShift) / m.live!.targetShift) : 0
            return (
              <li key={m.id} className="grid gap-x-4 gap-y-2 rounded-xl px-2 py-3 transition-colors hover:bg-muted/40 lg:grid-cols-[minmax(0,15rem)_6rem_minmax(0,1fr)] lg:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0">
                    <Link href={`/${slug}/maquinas/${m.id}`} className="block truncate font-medium hover:text-primary">
                      {m.name}
                    </Link>
                    <div className="mt-1">
                      <StateBadge state={state} pulse={state === "FAULT"} />
                    </div>
                  </div>
                </div>
                <div className="flex items-baseline gap-2 lg:block">
                  <div className="text-lg font-bold tabular-nums" style={{ color: TONE_HEX[oeeTone(ok ? oee : null)] }}>
                    {pct(oee)}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {ok ? `${num(m.live!.countShift - m.live!.rejectShift)} boas` : "sem dados"}
                  </div>
                  {ok && (
                    <div className="mt-1 hidden h-1 overflow-hidden rounded-full bg-muted lg:block" title={`${pct(progress, 0)} da meta`}>
                      <div className="h-full rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />
                    </div>
                  )}
                </div>
                <LineTimeline events={events} start={shift.start} end={shift.end} reasons={reasonNames} className={cn(events.length === 0 && "opacity-60")} />
              </li>
            )
          })}
          {rows.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Nenhuma máquina nesta linha.</li>}
        </ul>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <SectionCard title="Produção por hora" description="Peças boas e refugo da linha, contra a meta">
          <div className="px-3 pb-3">
            <HourlyProductionChart data={hourly} />
          </div>
        </SectionCard>
        <SectionCard title="Tempo da linha por estado" description="Soma das máquinas no turno">
          <div className="flex flex-wrap items-center justify-center gap-6 px-5 pb-5">
            <Donut
              segments={donut}
              center={<span className="text-2xl font-bold tabular-nums">{Math.round(donutTotalMin / 60)}h</span>}
              caption={<span className="text-xs text-muted-foreground">máquina-hora</span>}
            />
            <ul className="grid min-w-40 gap-1.5 text-sm">
              {donut.map((s) => (
                <li key={s.label} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="flex-1">{s.label}</span>
                  <span className="tabular-nums text-muted-foreground">{duration(s.value * 60)}</span>
                </li>
              ))}
            </ul>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Principais motivos de parada" description="Linha inteira, últimos 7 dias" href={`/${slug}/relatorios/paradas`} linkLabel="Relatório de paradas">
        <ul className="grid gap-3 px-5 pb-5">
          {pareto.map((p) => (
            <li key={p.reasonId} className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span className="truncate">{p.reasonName}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-[#cf5539]/80" style={{ width: `${(p.minutes / paretoMax) * 100}%` }} />
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {num(p.minutes)} min · {p.occurrences}×
              </span>
            </li>
          ))}
          {pareto.length === 0 && <li className="text-sm text-muted-foreground">Sem paradas registradas.</li>}
        </ul>
      </SectionCard>
    </div>
  )
}
