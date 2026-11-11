"use client"

import type { EChartsOption } from "echarts"

import { pct } from "@/lib/format"
import { TONE_HEX, oeeTone } from "@/lib/states"
import { EChart } from "@/components/charts/echart"
import { useChartTheme } from "./chart-theme"
import type { RankingItem } from "./oee-calc"
import { tooltipDot, tooltipHead, tooltipRow } from "./report-utils"

/**
 * Ranking de máquinas por OEE (barras horizontais coloridas pela faixa).
 * Quando uma máquina está selecionada no filtro, ela fica em destaque e as demais esmaecem.
 */
export function MachineRankingChart({ data, highlightId }: { data: RankingItem[]; highlightId?: string }) {
  const c = useChartTheme()
  const height = Math.max(160, 36 + data.length * 34)
  const dimmed = (id: string) => Boolean(highlightId && highlightId !== id)

  const option: EChartsOption = {
    grid: { left: 8, right: 52, top: 22, bottom: 4, containLabel: true },
    legend: { show: false },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "shadow" },
      formatter: (raw: unknown) => {
        const i = (raw as { dataIndex: number }[])[0]?.dataIndex ?? 0
        const m = data[i]
        if (!m) return ""
        return (
          tooltipHead(`${m.name} · ${m.code}`) +
          tooltipRow(tooltipDot(TONE_HEX[oeeTone(m.oee)]), "OEE", pct(m.oee)) +
          tooltipRow(tooltipDot(c.series.availability), "Disponibilidade", pct(m.availability)) +
          tooltipRow(tooltipDot(c.series.performance), "Performance", pct(m.performance)) +
          tooltipRow(tooltipDot(c.series.quality), "Qualidade", pct(m.quality))
        )
      },
    },
    xAxis: {
      type: "value",
      min: 0,
      max: 1,
      interval: 0.25,
      axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: data.map((m) => m.name),
      axisTick: { show: false },
      axisLabel: { fontWeight: 500 },
    },
    series: [
      {
        name: "OEE",
        type: "bar",
        barWidth: 18,
        data: data.map((m) => ({
          value: m.oee,
          itemStyle: {
            color: TONE_HEX[oeeTone(m.oee)],
            opacity: dimmed(m.machineId) ? 0.3 : 1,
            borderRadius: [0, 4, 4, 0],
          },
          label: {
            show: true,
            position: "right",
            color: c.ink,
            opacity: dimmed(m.machineId) ? 0.5 : 1,
            fontWeight: 600,
            fontSize: 11,
            formatter: () => pct(m.oee),
          },
        })),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: c.reference, type: "dashed", width: 1 },
          label: { formatter: "Meta 85%", position: "start", color: c.reference, fontSize: 10 },
          data: [{ xAxis: 0.85 }],
        },
      },
    ],
  }
  return <EChart option={option} height={height} />
}
