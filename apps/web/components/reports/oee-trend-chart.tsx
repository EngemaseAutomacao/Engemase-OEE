"use client"

import type { EChartsOption, LineSeriesOption } from "echarts"

import { pct } from "@/lib/format"
import { EChart } from "@/components/charts/echart"
import { useChartTheme } from "./chart-theme"
import type { TrendPoint } from "./oee-calc"
import { dayLabel, tooltipHead, tooltipRow } from "./report-utils"

interface AxisParam {
  seriesName: string
  value: number | null
  marker: string
  dataIndex: number
}

const TARGET = 0.85

/** Tendência diária do OEE e de D, P e Q, com a faixa-meta (≥ 85%) destacada. */
export function OeeTrendChart({ data, height = 300 }: { data: TrendPoint[]; height?: number }) {
  const c = useChartTheme()
  const values = data.flatMap((d) => [d.oee, d.availability, d.performance, d.quality]).filter((v): v is number => v !== null)
  const min = values.length ? Math.min(...values) : 0.5
  const yMin = Math.max(0, Math.floor((Math.min(min, TARGET) - 0.05) * 10) / 10)
  const many = data.length > 10

  const line = (name: string, key: keyof Omit<TrendPoint, "date">, color: string, main = false): LineSeriesOption => ({
    name,
    type: "line",
    data: data.map((d) => d[key]),
    showSymbol: main,
    symbol: "circle",
    symbolSize: main ? 8 : 6,
    connectNulls: false,
    lineStyle: { width: main ? 2.5 : 1.5, color },
    itemStyle: { color, borderColor: c.surface, borderWidth: main ? 2 : 0 },
    emphasis: { focus: "series" },
    z: main ? 4 : 3,
  })

  const option: EChartsOption = {
    grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter: (raw: unknown) => {
        const params = raw as AxisParam[]
        const p = data[params[0]?.dataIndex ?? 0]
        if (!p) return ""
        return tooltipHead(dayLabel(p.date)) + params.map((x) => tooltipRow(x.marker, x.seriesName, pct(x.value))).join("")
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: data.map((d) => (many ? dayLabel(d.date).slice(4) : dayLabel(d.date))),
      axisTick: { show: false },
      axisLabel: { hideOverlap: true },
    },
    yAxis: {
      type: "value",
      min: yMin,
      max: 1,
      interval: 0.1,
      axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` },
    },
    series: [
      {
        ...line("OEE", "oee", c.series.oee, true),
        markArea: {
          silent: true,
          itemStyle: { color: c.targetBand },
          label: { show: true, position: "insideTopRight", color: c.reference, fontSize: 10, formatter: "Faixa-meta ≥ 85%" },
          data: [[{ yAxis: TARGET }, { yAxis: 1 }]],
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: c.reference, type: "dashed", width: 1 },
          label: { show: false },
          data: [{ yAxis: TARGET }],
        },
      },
      line("Disponibilidade", "availability", c.series.availability),
      line("Performance", "performance", c.series.performance),
      line("Qualidade", "quality", c.series.quality),
    ],
  }
  return <EChart option={option} height={height} />
}
