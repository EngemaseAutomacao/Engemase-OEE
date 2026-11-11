"use client"

import type { EChartsOption } from "echarts"

import { cn } from "@/lib/utils"
import { num, pct } from "@/lib/format"
import type { ReasonCategory } from "@/lib/mock/types"
import { EChart } from "@/components/charts/echart"
import { useChartTheme } from "./chart-theme"
import { CATEGORY_META, hours, tooltipDot, tooltipHead, tooltipRow } from "./report-utils"
import type { CategoryFilter, CategoryTotal } from "./stops-calc"

/**
 * Rosca do tempo parado por categoria (não planejada, setup, planejada).
 * Mostra sempre as três categorias; a filtrada fica em destaque. A legenda também filtra.
 */
export function CategoryDonut({
  data,
  selected,
  onSelect,
  height = 220,
}: {
  data: CategoryTotal[]
  selected: CategoryFilter
  onSelect: (category: CategoryFilter) => void
  height?: number
}) {
  const c = useChartTheme()
  const total = data.reduce((s, d) => s + d.minutes, 0)
  const share = (m: number) => (total > 0 ? m / total : 0)
  const dim = (k: ReasonCategory) => selected !== "all" && selected !== k

  const option: EChartsOption = {
    legend: { show: false },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (raw: unknown) => {
        const i = (raw as { dataIndex: number }).dataIndex
        const d = data[i]
        if (!d) return ""
        return (
          tooltipHead(CATEGORY_META[d.category].plural) +
          tooltipRow(tooltipDot(CATEGORY_META[d.category].hex), "Tempo parado", hours(d.minutes)) +
          tooltipRow("", "% do total", pct(share(d.minutes))) +
          tooltipRow("", "Ocorrências", num(d.occurrences))
        )
      },
    },
    series: [
      {
        name: "Categoria",
        type: "pie",
        radius: ["62%", "88%"],
        center: ["50%", "50%"],
        avoidLabelOverlap: false,
        label: { show: false },
        labelLine: { show: false },
        padAngle: 1.5,
        itemStyle: { borderColor: c.surface, borderWidth: 2, borderRadius: 4 },
        emphasis: { scale: true, scaleSize: 4 },
        data: data.map((d) => ({
          name: CATEGORY_META[d.category].plural,
          value: d.minutes,
          itemStyle: { color: CATEGORY_META[d.category].hex, opacity: dim(d.category) ? 0.25 : 1 },
        })),
      },
    ],
  }

  const focus = selected === "all" ? null : data.find((d) => d.category === selected)

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <EChart option={option} height={height} />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xl font-semibold">{hours(focus ? focus.minutes : total)}</span>
          <span className="max-w-28 text-[11px] leading-tight text-muted-foreground">
            {focus ? `${pct(share(focus.minutes), 0)} do tempo parado` : "tempo parado total"}
          </span>
        </div>
      </div>
      <ul className="grid gap-1" aria-label="Categorias (clique para filtrar)">
        {data.map((d) => {
          const meta = CATEGORY_META[d.category]
          const active = selected === d.category
          return (
            <li key={d.category}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(active ? "all" : d.category)}
                className={cn(
                  "grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                  active && "bg-muted",
                  dim(d.category) && "opacity-60",
                )}
              >
                <span className={cn("size-2.5 rounded-sm", meta.dot)} />
                <span className="truncate">{meta.plural}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{num(d.occurrences)} oc.</span>
                <span className="w-24 text-right font-medium tabular-nums">
                  {hours(d.minutes)} <span className="text-xs font-normal text-muted-foreground">· {pct(share(d.minutes), 0)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
