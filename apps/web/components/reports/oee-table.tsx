"use client"

import { Fragment, useState } from "react"
import { ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { num, pct } from "@/lib/format"
import { TONE_TEXT, oeeTone } from "@/lib/states"
import type { ShiftOeeRow } from "@/lib/mock"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { aggregate, type GroupBy, type MachineOption, type OeeAgg, type TableGroup } from "./oee-calc"
import { TONE_PILL, dayLabel, hours } from "./report-utils"

type KeyCol = "date" | "shift" | "machine"

const KEY_ORDER: Record<GroupBy, KeyCol[]> = {
  day: ["date", "shift", "machine"],
  shift: ["shift", "date", "machine"],
  machine: ["machine", "date", "shift"],
}
const KEY_HEAD: Record<KeyCol, string> = { date: "Data", shift: "Turno", machine: "Máquina" }
const GROUP_LABEL: Record<GroupBy, string> = { day: "dia", shift: "turno", machine: "máquina" }

function Rate({ value, strong = false }: { value: number | null; strong?: boolean }) {
  const tone = oeeTone(value)
  if (strong) {
    return (
      <span className={cn("inline-flex min-w-14 justify-center rounded-md px-1.5 py-0.5 font-semibold tabular-nums", TONE_PILL[tone])}>
        {pct(value)}
      </span>
    )
  }
  return <span className={cn("tabular-nums", TONE_TEXT[tone])}>{pct(value)}</span>
}

function MetricCells({ agg, bold = false }: { agg: OeeAgg; bold?: boolean }) {
  const cell = cn("text-right tabular-nums", bold && "font-medium")
  return (
    <>
      <TableCell className={cell}>{hours(agg.plannedMin)}</TableCell>
      <TableCell className={cell}>{hours(agg.runMin)}</TableCell>
      <TableCell className={cell}>{num(agg.total)}</TableCell>
      <TableCell className={cell}>{num(agg.good)}</TableCell>
      <TableCell className={cn(cell, agg.reject > 0 && "text-state-fault")}>{num(agg.reject)}</TableCell>
      <TableCell className="text-right">
        <Rate value={agg.availability} />
      </TableCell>
      <TableCell className="text-right">
        <Rate value={agg.performance} />
      </TableCell>
      <TableCell className="text-right">
        <Rate value={agg.quality} />
      </TableCell>
      <TableCell className="text-right">
        <Rate value={agg.oee} strong />
      </TableCell>
    </>
  )
}

/**
 * Tabela detalhada do relatório: um grupo por dia, turno ou máquina (com subtotal),
 * expansível até o nível de turno × máquina.
 */
export function OeeTable({
  groups,
  by,
  machines,
  total,
}: {
  groups: TableGroup[]
  by: GroupBy
  machines: MachineOption[]
  total: ShiftOeeRow[]
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const machineName = new Map(machines.map((m) => [m.id, m]))
  const cols = KEY_ORDER[by]
  const allOpen = groups.length > 0 && groups.every((g) => expanded.has(`${by}:${g.key}`))
  const totalAgg = aggregate(total)

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggleAll = () => setExpanded(allOpen ? new Set() : new Set(groups.map((g) => `${by}:${g.key}`)))

  const isKey = (col: KeyCol) => col === cols[0]
  const groupCell = (col: KeyCol, g: TableGroup) => {
    if (isKey(col)) {
      if (col === "date") return dayLabel(g.key)
      if (col === "shift") return g.key
      return machineName.get(g.key)?.name ?? g.key
    }
    if (col === "date") return g.days === 1 ? "1 dia" : `${g.days} dias`
    if (col === "shift") return g.shifts === 1 ? "1 turno" : `${g.shifts} turnos`
    return g.machines === 1 ? "1 máquina" : `${g.machines} máquinas`
  }
  const rowCell = (col: KeyCol, r: ShiftOeeRow) => {
    if (col === "date") return dayLabel(r.date)
    if (col === "shift") return r.shiftName
    const m = machineName.get(r.machineId)
    return m ? (
      <span>
        {m.name} <span className="text-xs text-muted-foreground">{m.code}</span>
      </span>
    ) : (
      r.machineId
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-6">
        <p className="text-xs text-muted-foreground">
          {groups.length} {groups.length === 1 ? "grupo" : "grupos"} por {GROUP_LABEL[by]} · {num(total.length)} registros de turno × máquina. Clique em um grupo para ver o detalhe.
        </p>
        <Button variant="ghost" size="sm" onClick={toggleAll} disabled={groups.length === 0}>
          {allOpen ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
          {allOpen ? "Recolher tudo" : "Expandir tudo"}
        </Button>
      </div>
      <Table className="min-w-[1040px]">
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {cols.map((col, i) => (
              <TableHead key={col} className={cn("text-xs text-muted-foreground", i === 0 && "pl-[34px]")}>
                {KEY_HEAD[col]}
              </TableHead>
            ))}
            <TableHead className="text-right text-xs text-muted-foreground">Tempo planejado</TableHead>
            <TableHead className="text-right text-xs text-muted-foreground">Operação</TableHead>
            <TableHead className="text-right text-xs text-muted-foreground">Total (pç)</TableHead>
            <TableHead className="text-right text-xs text-muted-foreground">Boas</TableHead>
            <TableHead className="text-right text-xs text-muted-foreground">Refugo</TableHead>
            <TableHead className="text-right text-xs text-muted-foreground">D</TableHead>
            <TableHead className="text-right text-xs text-muted-foreground">P</TableHead>
            <TableHead className="text-right text-xs text-muted-foreground">Q</TableHead>
            <TableHead className="pr-6 text-right text-xs text-muted-foreground">OEE</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => {
            const key = `${by}:${g.key}`
            const open = expanded.has(key)
            return (
              <Fragment key={key}>
                <TableRow className="cursor-pointer bg-muted/15 font-medium" onClick={() => toggle(key)}>
                  {cols.map((col, i) => (
                    <TableCell key={col} className={cn(i === 0 && "pl-3", !isKey(col) && "text-xs font-normal text-muted-foreground")}>
                      {i === 0 ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-expanded={open}
                          aria-label={`${open ? "Recolher" : "Expandir"} ${groupCell(col, g)}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggle(key)
                          }}
                        >
                          <ChevronRightIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
                          {groupCell(col, g)}
                        </button>
                      ) : (
                        groupCell(col, g)
                      )}
                    </TableCell>
                  ))}
                  <MetricCells agg={g.agg} bold />
                </TableRow>
                {open &&
                  g.rows.map((r) => (
                    <TableRow key={`${r.date}-${r.shiftName}-${r.machineId}`} className="text-muted-foreground">
                      {cols.map((col, i) => (
                        <TableCell key={col} className={cn(i === 0 && "pl-12", "text-foreground/80")}>
                          {i === 0 && isKey(col) ? <span className="text-xs text-muted-foreground">↳</span> : rowCell(col, r)}
                        </TableCell>
                      ))}
                      <MetricCells agg={aggregate([r])} />
                    </TableRow>
                  ))}
              </Fragment>
            )
          })}
        </TableBody>
        {total.length > 0 && (
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-[34px] font-semibold" colSpan={3}>
                Total do período
              </TableCell>
              <MetricCells agg={totalAgg} bold />
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  )
}
