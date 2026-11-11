"use client"

import type { EChartsOption } from "echarts"

import { num, pct } from "@/lib/format"
import { EChart } from "@/components/charts/echart"
import { useChartTheme } from "./chart-theme"
import { CATEGORY_META, CATEGORY_ORDER, UNCLASSIFIED_HEX, UNCLASSIFIED_ID, hours, tooltipDot, tooltipHead, tooltipRow } from "./report-utils"
import type { ReasonRow } from "./stops-calc"

/**
 * Pareto de motivos de parada em dois painéis alinhados pelo mesmo eixo de motivos:
 * em cima, a linha de % acumulado (0–100%, referência em 80%); embaixo, as barras de minutos.
 * Assim cada medida tem a sua escala sem sobrepor dois eixos Y no mesmo gráfico.
 */
export function ParetoChart({ data, height = 380 }: { data: ReasonRow[]; height?: number }) {
  const c = useChartTheme()
  const colorOf = (r: ReasonRow) => (r.reasonId === UNCLASSIFIED_ID ? UNCLASSIFIED_HEX : CATEGORY_META[r.category].hex)
  const vital = data.findIndex((r) => r.cumulative >= 0.8)
  const names = data.map((r) => r.reasonName)
  const left = 64
  const right = 16
  const topHeight = 78
  const gap = 30
  const bottom = 92

  const option: EChartsOption = {
    legend: { show: false },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { left, right, top: 12, height: topHeight, containLabel: false },
      { left, right, top: 12 + topHeight + gap, bottom, containLabel: false },
    ],
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "shadow" },
      formatter: (raw: unknown) => {
        const i = (raw as { dataIndex: number }[])[0]?.dataIndex ?? 0
        const r = data[i]
        if (!r) return ""
        const cat = r.reasonId === UNCLASSIFIED_ID ? "Não planejada · aguardando classificação" : CATEGORY_META[r.category].label
        return (
          tooltipHead(`${i + 1}º · ${r.reasonName}`) +
          tooltipRow(tooltipDot(colorOf(r)), "Categoria", cat) +
          tooltipRow("", "Tempo parado", `${num(r.minutes)} min (${hours(r.minutes)})`) +
          tooltipRow("", "Ocorrências", num(r.occurrences)) +
          tooltipRow("", "% do total", pct(r.share)) +
          tooltipRow(tooltipDot(c.ink), "% acumulado", pct(r.cumulative))
        )
      },
    },
    xAxis: [
      { type: "category", gridIndex: 0, data: names, axisTick: { show: false }, axisLabel: { show: false } },
      {
        type: "category",
        gridIndex: 1,
        data: names,
        axisTick: { show: false },
        axisLabel: { interval: 0, rotate: 50, width: 112, overflow: "truncate", fontSize: 10 },
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        min: 0,
        max: 1,
        interval: 0.5,
        axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` },
      },
      {
        type: "value",
        gridIndex: 1,
        splitNumber: 4,
        axisLabel: { formatter: (v: number) => `${num(v)} min` },
      },
    ],
    series: [
      {
        name: "% acumulado",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: data.map((r) => r.cumulative),
        symbol: "circle",
        symbolSize: 7,
        lineStyle: { width: 2, color: c.ink },
        itemStyle: { color: c.ink, borderColor: c.surface, borderWidth: 2 },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: c.reference, type: "dashed", width: 1 },
          label: { formatter: "80%", position: "insideStartTop", color: c.reference, fontSize: 10 },
          data: [{ yAxis: 0.8 }],
        },
      },
      {
        name: "Tempo parado",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        barMaxWidth: 36,
        labelLayout: { hideOverlap: true },
        data: data.map((r, i) => ({
          value: r.minutes,
          itemStyle: {
            color: colorOf(r),
            borderRadius: [4, 4, 0, 0],
            opacity: vital >= 0 && i > vital ? 0.5 : 1,
          },
          label: {
            // rótulo seletivo: só os três maiores motivos
            show: i < 3,
            position: "top",
            color: c.ink,
            fontSize: 10,
            fontWeight: 600,
            formatter: () => num(r.minutes),
          },
        })),
      },
    ],
  }
  return <EChart option={option} height={height} />
}

/** Legenda em HTML (as barras têm cor por categoria; a linha é o % acumulado). */
export function ParetoLegend({ showUnclassified }: { showUnclassified: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {CATEGORY_ORDER.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: CATEGORY_META[k].hex }} />
          {CATEGORY_META[k].label}
        </span>
      ))}
      {showUnclassified && (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: UNCLASSIFIED_HEX }} />
          Sem motivo
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded-full bg-foreground/70" />% acumulado
      </span>
      <span>Barras esmaecidas: motivos além dos 80% acumulados</span>
    </div>
  )
}
