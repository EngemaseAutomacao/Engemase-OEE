"use client"

import { useMemo, useState } from "react"
import { SearchXIcon } from "lucide-react"

import type { ShiftOeeRow } from "@/lib/mock"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ExportMenu } from "./export-menu"
import { FilterBar, FilterSelect, SegmentedFilter } from "./filter-bar"
import { LossCascadeChart } from "./loss-cascade-chart"
import { MachineRankingChart } from "./machine-ranking-chart"
import { aggregate, dailyTrend, machineRanking, splitPeriods, tableGroups, type GroupBy, type MachineOption } from "./oee-calc"
import { OeeKpis } from "./oee-kpis"
import { OeeTable } from "./oee-table"
import { OeeTrendChart } from "./oee-trend-chart"
import { rangeLabel, type PeriodDays } from "./report-utils"

export interface OeeReportProps {
  clientSlug: string
  rows: ShiftOeeRow[]
  machines: MachineOption[]
  units: { id: string; name: string }[]
  lines: { id: string; name: string; unitId: string }[]
}

const DEFAULTS = { period: 14 as PeriodDays, unitId: "all", lineId: "all", machineId: "all", shift: "all", groupBy: "day" as GroupBy }

const GROUP_TITLE: Record<GroupBy, string> = { day: "por dia", shift: "por turno", machine: "por máquina" }

/** Relatório de OEE: filtros em estado local + KPIs, gráficos e tabela detalhada. */
export function OeeReport({ clientSlug, rows, machines, units, lines }: OeeReportProps) {
  const [period, setPeriod] = useState<PeriodDays>(DEFAULTS.period)
  const [unitId, setUnitId] = useState(DEFAULTS.unitId)
  const [lineId, setLineId] = useState(DEFAULTS.lineId)
  const [machineId, setMachineId] = useState(DEFAULTS.machineId)
  const [shift, setShift] = useState(DEFAULTS.shift)
  const [by, setBy] = useState<GroupBy>(DEFAULTS.groupBy)

  const machineOrder = useMemo(() => new Map(machines.map((m, i) => [m.id, i])), [machines])
  const shiftNames = useMemo(() => [...new Set(rows.map((r) => r.shiftName))].sort(), [rows])
  const periods = useMemo(() => splitPeriods(rows.map((r) => r.date), period), [rows, period])

  const lineOptions = lines.filter((l) => unitId === "all" || l.unitId === unitId)
  const scopeMachines = useMemo(
    () => machines.filter((m) => (unitId === "all" || m.unitId === unitId) && (lineId === "all" || m.lineId === lineId)),
    [machines, unitId, lineId],
  )
  const selected = machineId === "all" ? undefined : machines.find((m) => m.id === machineId)

  const data = useMemo(() => {
    const scopeIds = new Set(scopeMachines.map((m) => m.id))
    const cur = new Set(periods.dates)
    const prev = new Set(periods.previousDates)
    const scoped = rows.filter((r) => scopeIds.has(r.machineId) && (shift === "all" || r.shiftName === shift))
    const picked = machineId === "all" ? scoped : scoped.filter((r) => r.machineId === machineId)
    const current = picked.filter((r) => cur.has(r.date))
    const previous = picked.filter((r) => prev.has(r.date))
    return {
      current,
      currentAgg: aggregate(current),
      previousAgg: periods.previousDates.length === periods.dates.length ? aggregate(previous) : null,
      trend: dailyTrend(current, periods.dates),
      // o ranking ignora o filtro de máquina (a selecionada fica em destaque)
      ranking: machineRanking(
        scoped.filter((r) => cur.has(r.date)),
        scopeMachines,
      ),
      groups: tableGroups(current, by, machineOrder),
    }
  }, [rows, periods, scopeMachines, machineId, shift, by, machineOrder])

  const start = periods.dates[0]
  const end = periods.dates[periods.dates.length - 1]
  const range = start && end ? rangeLabel(start, end) : "—"
  const isDefault =
    period === DEFAULTS.period &&
    unitId === DEFAULTS.unitId &&
    lineId === DEFAULTS.lineId &&
    machineId === DEFAULTS.machineId &&
    shift === DEFAULTS.shift &&
    by === DEFAULTS.groupBy

  const reset = () => {
    setPeriod(DEFAULTS.period)
    setUnitId(DEFAULTS.unitId)
    setLineId(DEFAULTS.lineId)
    setMachineId(DEFAULTS.machineId)
    setShift(DEFAULTS.shift)
    setBy(DEFAULTS.groupBy)
  }

  const scopeLabel = [
    selected ? selected.name : lineId !== "all" ? lines.find((l) => l.id === lineId)?.name : unitId !== "all" ? units.find((u) => u.id === unitId)?.name : "Todas as unidades",
    shift === "all" ? "todos os turnos" : shift,
    range,
  ]
    .filter(Boolean)
    .join(" · ")
  const machineCount = selected ? 1 : scopeMachines.length
  const hasData = data.current.length > 0

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
          onChange={(v) => setPeriod(Number(v) as PeriodDays)}
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
          label="Turno"
          value={shift}
          allLabel="Todos os turnos"
          allShort="Todos"
          options={shiftNames.map((s) => ({ value: s, label: s }))}
          onChange={setShift}
          triggerClassName="sm:w-[150px]"
        />
        <SegmentedFilter<GroupBy>
          label="Agrupar por"
          value={by}
          onChange={setBy}
          className="col-span-2 sm:col-span-1"
          options={[
            { value: "day", label: "Dia" },
            { value: "shift", label: "Turno" },
            { value: "machine", label: "Máquina" },
          ]}
        />
      </FilterBar>

      {!hasData ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum turno encontrado</EmptyTitle>
            <EmptyDescription>Não há registros de produção para a combinação de filtros escolhida. Amplie o período ou remova algum filtro.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={reset}>
              Limpar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <OeeKpis current={data.currentAgg} previous={data.previousAgg} periodDays={period} />

          <div className="grid gap-4 xl:grid-cols-5">
            <Card className="gap-4 xl:col-span-3">
              <CardHeader>
                <CardTitle>Tendência do OEE</CardTitle>
                <CardDescription>OEE diário e seus componentes (D × P × Q). A faixa verde marca a meta de classe mundial.</CardDescription>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                <OeeTrendChart data={data.trend} />
              </CardContent>
            </Card>
            <Card className="gap-4 xl:col-span-2">
              <CardHeader>
                <CardTitle>Cascata de perdas</CardTitle>
                <CardDescription>Para onde foi o tempo planejado, em horas-máquina.</CardDescription>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                <LossCascadeChart agg={data.currentAgg} />
              </CardContent>
            </Card>
          </div>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Ranking de máquinas por OEE</CardTitle>
              <CardDescription>
                {selected ? `${selected.name} em destaque entre as máquinas do filtro.` : "Da melhor para a pior no período."} Cores pela faixa: verde ≥ 85%, âmbar 60–85%, vermelho &lt; 60%.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 sm:px-6">
              <MachineRankingChart data={data.ranking} highlightId={selected?.id} />
            </CardContent>
          </Card>

          <Card className="gap-3 pb-0">
            <CardHeader>
              <CardTitle>Detalhamento {GROUP_TITLE[by]}</CardTitle>
              <CardDescription>Tempos em horas-máquina. Cores de D, P, Q e OEE pela faixa de desempenho.</CardDescription>
              <CardAction>
                <ExportMenu
                  baseName={`oee_${clientSlug}_${start ?? ""}_a_${end ?? ""}`}
                  rowCount={data.current.length}
                  scopeLabel={scopeLabel}
                />
              </CardAction>
            </CardHeader>
            <OeeTable groups={data.groups} by={by} machines={machines} total={data.current} />
          </Card>
        </>
      )}
    </>
  )
}
