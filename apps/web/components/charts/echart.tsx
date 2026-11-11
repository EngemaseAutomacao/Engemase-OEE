"use client"

import dynamic from "next/dynamic"
import type { EChartsOption } from "echarts"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse rounded-md bg-muted" />,
})

/**
 * Wrapper do Apache ECharts com tema claro/escuro.
 * Use cores explícitas (hex) nas séries — veja STATE_META.hex e TONE_HEX em lib/states.ts.
 */
export function EChart({ option, height = 280, className }: { option: EChartsOption; height?: number; className?: string }) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  const text = dark ? "#a1a1aa" : "#64748b"
  const grid = dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"
  const base: EChartsOption = {
    backgroundColor: "transparent",
    textStyle: { fontFamily: "var(--font-geist-sans), system-ui, sans-serif", color: text },
    grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", confine: true },
    legend: { textStyle: { color: text }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
  }
  const merged: EChartsOption = {
    ...base,
    ...option,
    xAxis: styleAxis(option.xAxis, text, grid),
    yAxis: styleAxis(option.yAxis, text, grid),
  }
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ReactECharts option={merged} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate theme={dark ? "dark" : undefined} opts={{ renderer: "svg" }} />
    </div>
  )
}

function styleAxis<T>(axis: T, text: string, grid: string): T {
  if (!axis) return axis
  const style = (a: Record<string, unknown>) => ({
    ...a,
    axisLabel: { color: text, ...(a.axisLabel as object) },
    axisLine: { lineStyle: { color: grid }, ...(a.axisLine as object) },
    splitLine: { lineStyle: { color: grid }, ...(a.splitLine as object) },
  })
  return (Array.isArray(axis) ? axis.map((a) => style(a as Record<string, unknown>)) : style(axis as Record<string, unknown>)) as T
}
