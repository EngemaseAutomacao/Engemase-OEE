"use client"

import { EChart } from "@/components/charts/echart"

/** Barras de OEE diário com linha da meta (tracejada). */
export function TargetChart({ days, target }: { days: { date: string; oee: number }[]; target: number }) {
  const labels = days.map((d) => `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`)
  return (
    <EChart
      height={150}
      option={{
        grid: { left: 4, right: 4, top: 14, bottom: 4, containLabel: true },
        legend: { show: false },
        tooltip: { trigger: "axis", valueFormatter: (v) => `${(Number(v) * 100).toFixed(1).replace(".", ",")}%` },
        xAxis: { type: "category", data: labels, axisTick: { show: false }, axisLabel: { fontSize: 10 } },
        yAxis: { type: "value", min: 0.4, max: 1, splitNumber: 3, axisLabel: { fontSize: 10, formatter: (v: number) => `${Math.round(v * 100)}%` } },
        series: [
          {
            type: "bar",
            data: days.map((d) => ({ value: d.oee, itemStyle: { color: d.oee >= target ? "#257bb4" : "#9cc3e6", borderRadius: [4, 4, 0, 0] } })),
            barWidth: "55%",
            markLine: {
              symbol: "none",
              label: { formatter: "Meta", position: "insideEndTop", fontSize: 10, color: "#257bb4" },
              lineStyle: { type: "dashed", color: "#257bb4", width: 1.5 },
              data: [{ yAxis: target }],
            },
          },
        ],
      }}
    />
  )
}
