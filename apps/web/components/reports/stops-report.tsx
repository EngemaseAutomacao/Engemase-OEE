"use client"

import { useMemo, useState } from "react"
import { SearchXIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { CategoryDonut } from "./category-donut"
import { ExportMenu } from "./export-menu"
import { FilterBar, FilterSelect, SegmentedFilter } from "./filter-bar"
import type { MachineOption } from "./oee-calc"
import { ParetoChart, ParetoLegend } from "./pareto-chart"
import { ReasonsTable } from "./reasons-table"
import { CATEGORY_META, CATEGORY_ORDER, UNCLASSIFIED_ID, addDays, rangeLabel, type PeriodDays } from "./report-utils"
import { categoryTotals, paretoRows, summarize, type CategoryFilter } from "./stops-calc"
import type { StopRecord } from "./stops-data"
import { StopsKpis } from "./stops-kpis"

export interface StopsReportProps {
  clientSlug: string
  records: StopRecord[]
  machines: MachineOption[]
  units: { id: string; name: string }[]
  lines: { id: string; name: string; unitId: string }[]
  /** Último dia do período (ontem), "YYYY-MM-DD". */
  endDate: string
}

const DEFAULTS = { period: 7 as PeriodDays, unitId: "all", lineId: "all", machineId: "all", category: "all" as CategoryFilter }

/** Relatório de paradas: filtros em estado local + KPIs, Pareto, rosca por categoria e tabela de motivos. */
export function StopsReport({ clientSlug, records, machines, units, lines, endDate }: StopsReportProps) {
  const [period, setPeriod] = useState<PeriodDays>(DEFAULTS.period)
  const [unitId, setUnitId] = useState(DEFAULTS.unitId)
  const [lineId, setLineId] = useState(DEFAULTS.lineId)
  const [machineId, setMachineId] = useState(DEFAULTS.machineId)
  const [category, setCategory] = useState<CategoryFilter>(DEFAULTS.category)

  const lineOptions = lines.filter((l) => unitId === "all" || l.unitId === unitId)
  const scopeMachines = useMemo(
    () => machines.filter((m) => (unitId === "all" || m.unitId === unitId) && (lineId === "all" || m.lineId === lineId)),
    [machines, unitId, lineId],
  )
  const selected = machineId === "all" ? undefined : machines.find((m) => m.id === machineId)

  const data = useMemo(() => {
    const ids = new Set(selected ? [selected.id] : scopeMachines.map((m) => m.id))
    const weeks = period / 7
    const scoped = records.filter((r) => ids.has(r.machineId))
    const current = scoped.filter((r) => r.week < weeks)
    const previous = scoped.filter((r) => r.week >= weeks && r.week < 2 * weeks)
    const machineCount = new Set(current.map((r) => r.machineId)).size
    const inCategory = category === "all" ? current : current.filter((r) => r.category === category)
    return {
      machineCount,
      summary: summarize(current, category, machineCount, period),
      previousSummary: previous.length > 0 ? summarize(previous, category, new Set(previous.map((r) => r.machineId)).size, period) : null,
      pareto: paretoRows(inCategory),
      categories: categoryTotals(current),
      hasData: current.length > 0,
    }
  }, [records, scopeMachines, selected, period, category])

  const start = addDays(endDate, -(period - 1))
  const range = rangeLabel(start, endDate)
  const isDefault =
    period === DEFAULTS.period &&
    unitId === DEFAULTS.unitId &&
    lineId === DEFAULTS.lineId &&
    machineId === DEFAULTS.machineId &&
    category === DEFAULTS.category
  const reset = () => {
    setPeriod(DEFAULTS.period)
    setUnitId(DEFAULTS.unitId)
    setLineId(DEFAULTS.lineId)
    setMachineId(DEFAULTS.machineId)
    setCategory(DEFAULTS.category)
  }

  const categoryLabel = category === "all" ? null : CATEGORY_META[category].plural
  const scopeLabel = [
    selected ? selected.name : lineId !== "all" ? lines.find((l) => l.id === lineId)?.name : unitId !== "all" ? units.find((u) => u.id === unitId)?.name : "Todas as unidades",
    categoryLabel ?? "todas as categorias",
    range,
  ]
    .filter(Boolean)
    .join(" · ")
  const machineCount = selected ? 1 : scopeMachines.length
  const top = data.pareto[0]
  const vitalCount = data.pareto.findIndex((r) => r.cumulative >= 0.8) + 1

  return (
    <>
      <FilterBar
        canReset={!isDefault}
        onReset={reset}
        summary={
          <>
            {range} · {machineCount} {machineCount === 1 ? "máquina" : "máquinas"}
          </>
        }
      >
        <SegmentedFilter<"7" | "14">
          label="Período"
          value={period === 7 ? "7" : "14"}
          onChange={(v) => setPeriod(v === "7" ? 7 : 14)}
          options={[
            { value: "7", label: "7 dias" },
            { value: "14", label: "14 dias" },
          ]}
        />
        {units.length > 1 && (
          <FilterSelect
            label="Unidade"
            value={unitId}
            allLabel="Todas as unidades"
            allShort="Todas"
            options={units.map((u) => ({ value: u.id, label: u.name }))}
            onChange={(v) => {
              setUnitId(v)
              setLineId("all")
              setMachineId("all")
            }}
          />
        )}
        <FilterSelect
          label="Linha"
          value={lineId}
          allLabel="Todas as linhas"
          allShort="Todas"
          options={lineOptions.map((l) => ({ value: l.id, label: l.name }))}
          onChange={(v) => {
            setLineId(v)
            setMachineId("all")
          }}
        />
        <FilterSelect
          label="Máquina"
          value={machineId}
          allLabel="Todas as máquinas"
          allShort="Todas"
          options={scopeMachines.map((m) => ({ value: m.id, label: m.name, hint: m.code }))}
          onChange={setMachineId}
        />
        <FilterSelect
          label="Categoria"
          value={category}
          allLabel="Todas as categorias"
          allShort="Todas"
          options={CATEGORY_ORDER.map((k) => ({ value: k, label: CATEGORY_META[k].plural }))}
          onChange={(v) => setCategory(v as CategoryFilter)}
        />
      </FilterBar>

      {!data.hasData ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma parada encontrada</EmptyTitle>
            <EmptyDescription>Não há paradas registradas para a combinação de filtros escolhida. Amplie o período ou remova algum filtro.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={reset}>
              Limpar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <StopsKpis
            current={data.summary}
            previous={data.previousSummary}
            periodDays={period}
            machineCount={data.machineCount}
            categoryLabel={categoryLabel}
          />

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="gap-4 xl:col-span-2">
              <CardHeader>
                <CardTitle>Pareto de motivos</CardTitle>
                <CardDescription>
                  {top
                    ? `${vitalCount} de ${data.pareto.length} motivos somam 80% do tempo parado${categoryLabel ? ` (${categoryLabel.toLowerCase()})` : ""}. O maior é “${top.reasonName}”.`
                    : "Participação de cada motivo no tempo parado."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 px-3 sm:px-6">
                {data.pareto.length > 0 ? (
                  <>
                    <ParetoChart data={data.pareto} />
                    <ParetoLegend showUnclassified={data.pareto.some((r) => r.reasonId === UNCLASSIFIED_ID)} />
                  </>
                ) : (
                  <Empty className="border border-dashed">
                    <EmptyHeader>
                      <EmptyTitle>Sem paradas nesta categoria</EmptyTitle>
                      <EmptyDescription>Nenhuma parada {categoryLabel?.toLowerCase()} no período e nas máquinas filtradas.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
            <Card className="gap-4">
              <CardHeader>
                <CardTitle>Tempo parado por categoria</CardTitle>
                <CardDescription>Clique em uma categoria para filtrar o relatório.</CardDescription>
              </CardHeader>
              <CardContent>
                <CategoryDonut data={data.categories} selected={category} onSelect={setCategory} />
              </CardContent>
            </Card>
          </div>

          <Card className="gap-3 pb-0">
            <CardHeader>
              <CardTitle>Motivos de parada</CardTitle>
              <CardDescription>
                Ordenados pelo tempo parado. Paradas sem motivo devem ser classificadas pelo operador na tela da máquina.
              </CardDescription>
              <CardAction>
                <ExportMenu
                  baseName={`paradas_${clientSlug}_${start}_a_${endDate}`}
                  rowCount={data.pareto.length}
                  scopeLabel={scopeLabel}
                  disabled={data.pareto.length === 0}
                />
              </CardAction>
            </CardHeader>
            {data.pareto.length > 0 ? (
              <ReasonsTable rows={data.pareto} />
            ) : (
              <p className="px-6 pb-6 text-sm text-muted-foreground">Nenhum motivo para exibir com os filtros atuais.</p>
            )}
          </Card>
        </>
      )}
    </>
  )
}
