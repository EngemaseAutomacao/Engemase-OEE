"use client"

import type { EChartsOption } from "echarts"
import { ActivityIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { EChart } from "@/components/charts/echart"
import { SectionCard } from "@/components/dashboard/section-card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import type { HealthSeries } from "./gateway-data"
import { UsageBar } from "./gateway-card"

const fmt = (v: number, digits = 1) => v.toLocaleString("pt-BR", { maximumFractionDigits: digits })

/**
 * Série única de saúde (um eixo só; sem legenda — o título do cartão nomeia a série).
 * Trecho sem contato fica sombreado e sem linha.
 */
function MetricChart({
  labels,
  data,
  color,
  unit,
  kind = "line",
  lostAt,
  threshold,
  max,
  height = 170,
}: {
  labels: string[]
  data: (number | null)[]
  color: string
  unit: string
  kind?: "line" | "bar"
  lostAt: number | null
  threshold?: { value: number; label: string }
  max?: number
  height?: number
}) {
  const option: EChartsOption = {
    grid: { left: 4, right: 12, top: 16, bottom: 4, containLabel: true },
    legend: { show: false },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: kind === "bar" ? "shadow" : "line" },
      valueFormatter: (v) => (v === null || v === undefined || v === "-" ? "sem contato" : `${fmt(Number(v))} ${unit}`),
    },
    xAxis: { type: "category", data: labels, boundaryGap: kind === "bar", axisTick: { show: false }, axisLabel: { fontSize: 10, interval: 11 } },
    yAxis: { type: "value", splitNumber: 3, max, axisLabel: { fontSize: 10, formatter: (v: number) => `${fmt(v, 0)}${unit === "%" ? "%" : ""}` } },
    series: [
      {
        name: unit === "%" ? "CPU" : unit === "MB" ? "Memória" : "Fila",
        type: kind,
        data,
        smooth: kind === "line" ? 0.3 : undefined,
        showSymbol: false,
        symbolSize: 8,
        lineStyle: { width: 2, color },
        itemStyle: { color, borderRadius: kind === "bar" ? [3, 3, 0, 0] : undefined },
        barCategoryGap: "35%",
        areaStyle: kind === "line" ? { color: `${color}1f` } : undefined,
        markArea:
          lostAt !== null
            ? {
                silent: true,
                itemStyle: { color: "rgba(148,163,184,0.16)" },
                label: { show: true, position: "insideTop", fontSize: 10, color: "#94a3b8", formatter: "Sem contato" },
                data: [[{ xAxis: labels[lostAt] }, { xAxis: labels[labels.length - 1] }]],
              }
            : undefined,
        markLine: threshold
          ? {
              silent: true,
              symbol: "none",
              lineStyle: { type: "dashed", width: 1, color: "#94a3b8" },
              label: { formatter: threshold.label, fontSize: 10, color: "#94a3b8", position: "insideEndTop" },
              data: [{ yAxis: threshold.value }],
            }
          : undefined,
      },
    ] as EChartsOption["series"],
  }
  return <EChart option={option} height={height} />
}

function lastValue(xs: (number | null)[]): number | null {
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i] !== null) return xs[i]!
  return null
}

function Info({ label, value, mono, alert, children }: { label: string; value: React.ReactNode; mono?: boolean; alert?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 text-right text-sm font-medium", mono && "font-mono text-xs", alert && "text-amber-700 dark:text-state-stopped")}>
        {value}
        {children}
      </dd>
    </div>
  )
}

/** Aba "Saúde": CPU, memória e fila do buffer nas últimas 6 h + ficha do equipamento. */
export function HealthTab({
  health,
  info,
}: {
  health: HealthSeries | null
  info: {
    hardware: string
    hostname: string
    ipIt: string | null
    ipOt: string | null
    agentVersion: string | null
    agentOutdated: boolean
    latestAgent: string
    uptime: string | null
    clockText: string
    clockAlert: boolean
    diskFreePct: number | null
    offline: boolean
    lastSeenAgo: string
  }
}) {
  if (!health) {
    return (
      <Empty className="rounded-2xl border border-dashed bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ActivityIcon />
          </EmptyMedia>
          <EmptyTitle>Sem dados de saúde</EmptyTitle>
          <EmptyDescription>Os indicadores aparecem depois do primeiro sincronismo do gateway.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const cpu = lastValue(health.cpu)
  const mem = lastValue(health.memMb)
  const buf = lastValue(health.buffer)
  const note = info.offline ? `Último valor antes da perda de contato (${info.lastSeenAgo})` : "Agora"

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <div className="grid gap-4 sm:grid-cols-2 xl:col-span-8">
        <SectionCard title="CPU" description={`Últimas 6 h, a cada 5 min · ${note}: ${cpu !== null ? `${fmt(cpu)}%` : "—"}`}>
          <MetricChart labels={health.labels} data={health.cpu} color="#257bb4" unit="%" lostAt={health.lostAt} />
        </SectionCard>
        <SectionCard title="Memória do agente" description={`Últimas 6 h · ${note}: ${mem !== null ? `${fmt(mem, 0)} MB` : "—"}`}>
          <MetricChart labels={health.labels} data={health.memMb} color="#0e9384" unit="MB" lostAt={health.lostAt} />
        </SectionCard>
        <SectionCard
          title="Fila do buffer"
          description={`Leituras aguardando envio · ${note}: ${buf !== null ? fmt(buf, 0) : "—"}. Acima de 20 por vários minutos indica rede lenta ou instável.`}
          className="sm:col-span-2"
        >
          <MetricChart
            labels={health.labels}
            data={health.buffer}
            color="#2c4e73"
            unit="leituras"
            kind="bar"
            lostAt={health.lostAt}
            threshold={{ value: 20, label: "alerta: 20" }}
            height={190}
          />
        </SectionCard>
      </div>

      <SectionCard title="Equipamento" description="Ficha reportada pelo agente" className="xl:col-span-4">
        <dl className="divide-y">
          <Info label="Hardware" value={info.hardware} />
          <Info label="Hostname" value={info.hostname} mono />
          <Info label="Rede de TI (eth0)" value={info.ipIt ?? "—"} mono />
          <Info label="Rede OT (eth1)" value={info.ipOt ?? "—"} mono />
          <Info
            label="Agente"
            value={info.agentVersion ? `v${info.agentVersion}` : "—"}
            alert={info.agentOutdated}
          >
            {info.agentVersion && (
              <div className="text-[11px] font-normal text-muted-foreground">{info.agentOutdated ? `Disponível: v${info.latestAgent}` : "Versão atual"}</div>
            )}
          </Info>
          <Info label="Tempo ligado" value={info.offline ? "—" : (info.uptime ?? "—")} />
          <Info label="Desvio do relógio" value={info.offline ? "—" : info.clockText} alert={info.clockAlert}>
            {info.clockAlert && <div className="text-[11px] font-normal text-muted-foreground">Acima de 2 s: verificar NTP (chrony)</div>}
          </Info>
          <Info label="Disco livre" value={info.diskFreePct !== null ? `${info.diskFreePct}%` : "—"} alert={info.diskFreePct !== null && info.diskFreePct < 20}>
            {info.diskFreePct !== null && (
              <div className="ml-auto w-24">
                <UsageBar value={info.diskFreePct} tone={info.diskFreePct < 10 ? "bad" : info.diskFreePct < 20 ? "warn" : "ok"} />
              </div>
            )}
          </Info>
        </dl>
      </SectionCard>
    </div>
  )
}
