"use client"

import type { EChartsOption } from "echarts"

import { EChart } from "@/components/charts/echart"

/** Área de peças boas acumuladas no turno: real (cheio) + projeção (tracejada). */
export function ForecastChart({ labels, actual, projection, predicted }: { labels: string[]; actual: (number | null)[]; projection: (number | null)[]; predicted: number }) {
  return (
    <EChart
      height={190}
      option={{
        grid: { left: 4, right: 12, top: 30, bottom: 4, containLabel: true },
        legend: { show: false },
        tooltip: { trigger: "axis", valueFormatter: (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR")) },
        xAxis: { type: "category", data: labels, boundaryGap: false, axisTick: { show: false }, axisLabel: { fontSize: 10 } },
        yAxis: { type: "value", splitNumber: 3, axisLabel: { fontSize: 10, formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR")} mil` : String(v)) } },
        series: ([
          {
            name: "Real",
            type: "line",
            data: actual,
            smooth: true,
            symbol: "circle",
            symbolSize: 6,
            lineStyle: { width: 2.5, color: "#257bb4" },
            itemStyle: { color: "#257bb4" },
            areaStyle: {
              color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(37,123,180,0.35)" }, { offset: 1, color: "rgba(37,123,180,0.02)" }] },
            },
          },
          {
            name: "Previsto",
            type: "line",
            data: projection,
            smooth: true,
            symbol: "circle",
            symbolSize: 5,
            lineStyle: { width: 2, type: "dashed", color: "#0e9384" },
            itemStyle: { color: "#0e9384" },
            areaStyle: { color: "rgba(14,147,132,0.08)" },
            markPoint: {
              symbol: "roundRect",
              symbolSize: [96, 34],
              symbolOffset: [-40, -26],
              itemStyle: { color: "#0e9384" },
              label: { color: "#fff", fontSize: 11, fontWeight: "bold", formatter: `${predicted.toLocaleString("pt-BR")}\nprevisto`, lineHeight: 13 },
              data: [{ coord: [labels.length - 1, projection[projection.length - 1] ?? predicted] }],
            },
          },
        ] as unknown as EChartsOption["series"]),
      }}
    />
  )
}
