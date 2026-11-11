"use client"

import type { EChartsOption, LineSeriesOption } from "echarts"
import { useTheme } from "next-themes"

import { num, pct } from "@/lib/format"
import { STATE_META } from "@/lib/states"
import { EChart } from "@/components/charts/echart"

export interface HourlyPoint {
  /** Rótulo do eixo: "06:00" */
  label: string
  /** null = hora futura (ainda não produzida). */
  good: number | null
  reject: number | null
  target: number
  partial: boolean
}

export interface DailyPoint {
  label: string
  oee: number
  availability: number
  performance: number
  quality: number
}

/** Paleta categórica (validada para daltonismo) — passos próprios para claro e escuro. */
const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500"],
}

interface TooltipParam {
  seriesName: string
  value: number | null
  marker: string
  axisValueLabel?: string
  dataIndex: number
}

const row = (marker: string, name: string, value: string) =>
  `<div style="display:flex;justify-content:space-between;gap:16px"><span>${marker}${name}</span><b style="font-variant-numeric:tabular-nums">${value}</b></div>`

/** Produção por hora do turno: barras de peças boas + refugo sobre a meta (contorno tracejado). */
export function HourlyProductionChart({ data, height = 260 }: { data: HourlyPoint[]; height?: number }) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  const targetFill = dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.05)"
  const targetLine = dark ? "#71717a" : "#94a3b8"

  const option: EChartsOption = {
    grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "shadow" },
      formatter: (raw: unknown) => {
        const params = raw as TooltipParam[]
        const i = params[0]?.dataIndex ?? 0
        const p = data[i]
        if (!p) return ""
        const total = p.good === null ? null : (p.good ?? 0) + (p.reject ?? 0)
        const head = `<div style="margin-bottom:4px;font-weight:600">${p.label}${p.partial ? " · hora em andamento" : ""}</div>`
        if (total === null) return head + row("", "Meta", `${num(p.target)} pç`) + `<div style="opacity:.7">Hora ainda não iniciada</div>`
        return (
          head +
          params.map((x) => row(x.marker, x.seriesName, `${num(x.value)} pç`)).join("") +
          row("", "Atingimento", p.target > 0 ? pct(total / p.target, 0) : "—")
        )
      },
    },
    xAxis: { type: "category", data: data.map((d) => d.label), axisTick: { show: false } },
    yAxis: { type: "value", splitLine: { lineStyle: { type: "dashed" } }, axisLabel: { formatter: (v: number) => num(v) } },
    series: [
      {
        name: "Meta",
        type: "bar",
        data: data.map((d) => d.target),
        barWidth: "58%",
        barGap: "-100%",
        z: 1,
        itemStyle: { color: targetFill, borderColor: targetLine, borderWidth: 1, borderType: "dashed", borderRadius: [4, 4, 0, 0] },
        emphasis: { disabled: true },
      },
      {
        name: "Boas",
        type: "bar",
        stack: "real",
        data: data.map((d) => d.good),
        barWidth: "58%",
        barGap: "-100%",
        z: 2,
        itemStyle: { color: STATE_META.RUNNING.hex },
      },
      {
        name: "Refugo",
        type: "bar",
        stack: "real",
        data: data.map((d) => d.reject),
        barWidth: "58%",
        barGap: "-100%",
        z: 2,
        itemStyle: { color: STATE_META.FAULT.hex, borderRadius: [4, 4, 0, 0] },
      },
    ],
  }
  return <EChart option={option} height={height} />
}

/** Tendência diária de OEE e componentes (D, P, Q) nos últimos 30 dias. */
export function OeeTrendChart({ data, height = 260 }: { data: DailyPoint[]; height?: number }) {
  const { resolvedTheme } = useTheme()
  const colors = resolvedTheme === "dark" ? SERIES.dark : SERIES.light
  const ref = resolvedTheme === "dark" ? "#71717a" : "#94a3b8"
  const min = Math.min(...data.flatMap((d) => [d.oee, d.availability, d.performance, d.quality]))
  const yMin = Math.max(0, Math.floor((min - 0.05) * 10) / 10)

  const line = (name: string, key: keyof Omit<DailyPoint, "label">, color: string, width: number): LineSeriesOption => ({
    name,
    type: "line",
    data: data.map((d) => d[key]),
    showSymbol: false,
    symbolSize: 8,
    smooth: false,
    lineStyle: { width, color },
    itemStyle: { color },
    emphasis: { focus: "series" },
  })

  const option: EChartsOption = {
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter: (raw: unknown) => {
        const params = raw as TooltipParam[]
        const head = `<div style="margin-bottom:4px;font-weight:600">${params[0]?.axisValueLabel ?? ""}</div>`
        return head + params.map((x) => row(x.marker, x.seriesName, pct(x.value))).join("")
      },
    },
    xAxis: { type: "category", boundaryGap: false, data: data.map((d) => d.label), axisTick: { show: false } },
    yAxis: {
      type: "value",
      min: yMin,
      max: 1,
      splitLine: { lineStyle: { type: "dashed" } },
      axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` },
    },
    series: [
      {
        ...line("OEE", "oee", colors[0], 2.5),
        z: 3,
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: ref, type: "dashed", width: 1 },
          label: { formatter: "Classe mundial 85%", position: "insideEndTop", color: ref, fontSize: 10 },
          data: [{ yAxis: 0.85 }],
        },
      },
      line("Disponibilidade", "availability", colors[1], 1.5),
      line("Performance", "performance", colors[2], 1.5),
      line("Qualidade", "quality", colors[3], 1.5),
    ],
  }
  return <EChart option={option} height={height} />
}
