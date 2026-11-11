"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon, ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, WifiOffIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { ago, num, pct, since, time } from "@/lib/format"
import { TONE_TEXT, oeeTone } from "@/lib/states"
import type { MachineState, MachineWithLive } from "@/lib/mock"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { StateBadge } from "@/components/oee/state-badge"

export interface MachineRow extends MachineWithLive {
  lineName: string
  lineCode: string
  unitName: string
}

type SortKey = "name" | "state" | "since" | "count" | "oee"
type SortDir = "asc" | "desc"

/** Ordem "atenção primeiro" para ordenar por estado. */
const STATE_RANK: Record<MachineState, number> = { FAULT: 0, STOPPED: 1, NO_COMM: 2, SETUP: 3, PLANNED_STOP: 4, RUNNING: 5 }

const hasData = (m: MachineWithLive) => Boolean(m.live && m.live.countShift > 0)

function sortValue(m: MachineRow, key: SortKey): number | string {
  const live = m.live
  switch (key) {
    case "name":
      return m.name
    case "state":
      return STATE_RANK[live?.state ?? "NO_COMM"]
    case "since":
      return live && hasData(m) ? Date.parse(live.stateSince) : Number.POSITIVE_INFINITY
    case "count":
      return live && live.targetShift > 0 ? live.countShift / live.targetShift : -1
    case "oee":
      return hasData(m) ? live!.shift.oee : -1
  }
}

function SortHead({
  label,
  k,
  sort,
  onSort,
  className,
}: {
  label: string
  k: SortKey
  sort: { key: SortKey; dir: SortDir }
  onSort: (k: SortKey) => void
  className?: string
}) {
  const active = sort.key === k
  const Icon = !active ? ArrowUpDownIcon : sort.dir === "asc" ? ArrowUpIcon : ArrowDownIcon
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn("-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground", active ? "text-foreground" : "text-muted-foreground")}
      >
        {label}
        <Icon className={cn("size-3.5", !active && "opacity-50")} />
      </button>
    </TableHead>
  )
}

/** Tabela densa de máquinas com ordenação local. Clique na linha abre o detalhe. */
export function MachineTable({ rows, clientSlug }: { rows: MachineRow[]; clientSlug: string }) {
  const router = useRouter()
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "state", dir: "asc" })

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "oee" || key === "count" ? "desc" : "asc" }))

  const sorted = [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key)
    const vb = sortValue(b, sort.key)
    const r = typeof va === "string" ? va.localeCompare(vb as string, "pt-BR") : (va as number) - (vb as number)
    return (sort.dir === "asc" ? r : -r) || a.name.localeCompare(b.name, "pt-BR")
  })

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <Table className="min-w-[1080px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHead label="Máquina" k="name" sort={sort} onSort={onSort} className="pl-4" />
            <TableHead>Linha</TableHead>
            <SortHead label="Estado" k="state" sort={sort} onSort={onSort} />
            <SortHead label="Há" k="since" sort={sort} onSort={onSort} />
            <TableHead>Produto</TableHead>
            <SortHead label="Contagem / meta" k="count" sort={sort} onSort={onSort} />
            <SortHead label="OEE" k="oee" sort={sort} onSort={onSort} className="text-right" />
            <TableHead className="text-right">D</TableHead>
            <TableHead className="text-right">P</TableHead>
            <TableHead className="text-right">Q</TableHead>
            <TableHead className="pr-4">Último dado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((m) => {
            const live = m.live
            const state = live?.state ?? "NO_COMM"
            const href = `/${clientSlug}/maquinas/${m.id}`
            const data = hasData(m)
            const partial = Boolean(live?.stale && data)
            const progress = live && live.targetShift > 0 ? Math.min(1, live.countShift / live.targetShift) : 0
            const metric = (v: number | undefined, digits: number) => (
              <span className={cn("tabular-nums", partial && "text-muted-foreground")}>{data ? pct(v, digits) : "—"}</span>
            )
            return (
              <TableRow key={m.id} className="cursor-pointer" onClick={() => router.push(href)}>
                <TableCell className="pl-4">
                  <Link href={href} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                    {m.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {m.code} · {m.type}
                  </div>
                </TableCell>
                <TableCell>
                  <div>{m.lineName}</div>
                  <div className="text-xs text-muted-foreground">{m.unitName}</div>
                </TableCell>
                <TableCell>
                  <StateBadge state={state} short pulse={state === "FAULT"} />
                  {live?.faultText && (
                    <div className="mt-1 flex max-w-48 items-center gap-1 text-xs text-state-fault">
                      <AlertTriangleIcon className="size-3 shrink-0" />
                      <span className="truncate">
                        {live.faultCode} · {live.faultText}
                      </span>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{live && data ? since(live.stateSince) : "—"}</TableCell>
                <TableCell>
                  <div className="max-w-44 truncate">{live?.productName ?? "Sem produto"}</div>
                  <div className="text-xs text-muted-foreground">{live?.productCode ?? "—"}</div>
                </TableCell>
                <TableCell>
                  <div className="tabular-nums">
                    <span className="font-medium">{num(live?.countShift)}</span>
                    <span className="text-muted-foreground"> / {num(live?.targetShift)}</span>
                  </div>
                  <div className="mt-1 h-1 w-28 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {partial ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help font-semibold text-muted-foreground tabular-nums underline decoration-dotted underline-offset-4">
                          {pct(live!.shift.oee)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Parcial: dados até {time(live!.lastUpdate)}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className={cn("font-semibold tabular-nums", TONE_TEXT[data ? oeeTone(live?.shift.oee) : "none"])}>
                      {data ? pct(live?.shift.oee) : "—"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">{metric(live?.shift.availability, 0)}</TableCell>
                <TableCell className="text-right">{metric(live?.shift.performance, 0)}</TableCell>
                <TableCell className="text-right">{metric(live?.shift.quality, 0)}</TableCell>
                <TableCell className="pr-4">
                  {!live || !data ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <WifiOffIcon className="size-3.5" />
                      Sem dados
                    </span>
                  ) : live.stale ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-state-stopped">
                      <WifiOffIcon className="size-3.5" />
                      Atrasado · {ago(live.lastUpdate)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground tabular-nums">{ago(live.lastUpdate)}</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
