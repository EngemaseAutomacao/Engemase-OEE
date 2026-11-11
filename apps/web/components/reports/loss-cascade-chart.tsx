"use client"

import type { EChartsOption } from "echarts"

import { num, pct } from "@/lib/format"
import { EChart } from "@/components/charts/echart"
import { useChartTheme } from "./chart-theme"
import type { OeeAgg } from "./oee-calc"
import { hours, tooltipDot, tooltipHead, tooltipRow } from "./report-utils"

interface Step {
  label: string
  description: string
  /** Início da barra (offset transparente). */
  base: number
  value: number
  color: string
  kind: "total" | "loss"
}

/**
 * Cascata de perdas (waterfall horizontal), em horas-máquina:
 * tempo planejado → perdas de disponibilidade → de performance → de qualidade → tempo efetivo.
 */
export function LossCascadeChart({ agg, height = 280 }: { agg: OeeAgg; height?: number }) {
  const c = useChartTheme()
  const planned = agg.plannedMin / 60
  const run = agg.runMin / 60
  const ideal = agg.idealMin / 60
  const effective = agg.effectiveMin / 60

  const steps: Step[] = [
    { label: "Tempo planejado", description: "Turnos menos paradas planejadas", base: 0, value: planned, color: c.neutral, kind: "total" },
    { label: "Disponibilidade", description: "Paradas não planejadas e setups", base: run, value: planned - run, color: c.series.availability, kind: "loss" },
    { label: "Performance", description: "Ritmo abaixo do ideal e micro-paradas", base: ideal, value: run - ideal, color: c.series.performance, kind: "loss" },
    { label: "Qualidade", description: "Tempo gasto produzindo refugo", base: effective, value: ideal - effective, color: c.series.quality, kind: "loss" },
    { label: "Tempo efetivo", description: "Peças boas × ciclo ideal", base: 0, value: effective, color: c.series.oee, kind: "total" },
  ]
  const share = (h: number) => (planned > 0 ? h / planned : null)

  const option: EChartsOption = {
    grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
    legend: { show: false },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "shadow" },
      formatter: (raw: unknown) => {
        const i = (raw as { dataIndex: number }[])[0]?.dataIndex ?? 0
        const s = steps[i]
        if (!s) return ""
        return (
          tooltipHead(s.kind === "loss" ? `Perda de ${s.label.toLowerCase()}` : s.label) +
          tooltipRow(tooltipDot(s.color), "Horas-máquina", hours(s.value * 60)) +
          tooltipRow("", "% do tempo planejado", pct(share(s.value))) +
          `<div style="margin-top:4px;opacity:.7">${s.description}</div>`
        )
      },
    },
    xAxis: {
      type: "value",
      max: planned > 0 ? planned : undefined,
      splitNumber: 4,
      axisLabel: { formatter: (v: number) => `${num(v)} h`, hideOverlap: true, showMaxLabel: false },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: steps.map((s) => (s.kind === "loss" ? `− ${s.label}` : s.label)),
      axisTick: { show: false },
      axisLabel: { fontWeight: 500 },
    },
    series: [
      {
        name: "base",
        type: "bar",
        stack: "cascade",
        silent: true,
        data: steps.map((s) => s.base),
        itemStyle: { color: "transparent" },
        emphasis: { disabled: true },
        barWidth: "56%",
      },
      {
        name: "Horas",
        type: "bar",
        stack: "cascade",
        barWidth: "56%",
        data: steps.map((s, i) => ({
          value: s.value,
          itemStyle: { color: s.color, borderRadius: s.kind === "total" ? [0, 4, 4, 0] : 4 },
          label: {
            show: true,
            position: s.kind === "total" ? "insideRight" : "left",
            color: s.kind === "loss" ? c.ink : i === 0 ? c.neutralText : "#ffffff",
            fontSize: 11,
            fontWeight: 600,
            formatter: () => `${s.kind === "loss" ? "−" : ""}${hours(s.value * 60)} · ${pct(share(s.value), 0)}`,
          },
        })),
      },
    ],
  }
  return <EChart option={option} height={height} />
}
