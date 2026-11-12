import { AlertTriangleIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { duration, num, pct } from "@/lib/format"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CATEGORY_META, UNCLASSIFIED_HEX, UNCLASSIFIED_ID, hours } from "./report-utils"
import type { ReasonRow } from "./stops-calc"

/** Tabela de motivos (gêmea do Pareto): tempo, ocorrências, duração média e participação. */
export function ReasonsTable({ rows }: { rows: ReasonRow[] }) {
  const totalMin = rows.reduce((s, r) => s + r.minutes, 0)
  const totalOcc = rows.reduce((s, r) => s + r.occurrences, 0)
  const head = "text-xs text-muted-foreground"
  // "poucos vitais": motivos até o que cruza 80% do tempo acumulado (mesmo critério do gráfico)
  const vital = rows.findIndex((r) => r.cumulative >= 0.8)
  return (
    <Table className="min-w-[860px]">
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className={cn(head, "w-10 pl-5 text-right")}>#</TableHead>
          <TableHead className={head}>Motivo</TableHead>
          <TableHead className={head}>Categoria</TableHead>
          <TableHead className={cn(head, "text-right")}>Minutos</TableHead>
          <TableHead className={cn(head, "text-right")}>Ocorrências</TableHead>
          <TableHead className={cn(head, "text-right")}>Duração média</TableHead>
          <TableHead className={cn(head, "w-44")}>% do total</TableHead>
          <TableHead className={cn(head, "pr-5 text-right")}>% acumulado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          const none = r.reasonId === UNCLASSIFIED_ID
          const meta = CATEGORY_META[r.category]
          const color = none ? UNCLASSIFIED_HEX : meta.hex
          return (
            <TableRow key={r.reasonId} className={cn(none && "bg-state-stopped/5")}>
              <TableCell className="pl-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
              <TableCell className="font-medium">
                {none ? (
                  <span className="inline-flex items-center gap-1.5">
                    <AlertTriangleIcon className="size-3.5 text-amber-600 dark:text-state-stopped" aria-hidden />
                    {r.reasonName}
                  </span>
                ) : (
                  r.reasonName
                )}
              </TableCell>
              <TableCell>
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", meta.soft, meta.text)}>
                  <span className={cn("size-1.5 rounded-full", meta.dot)} />
                  {meta.label}
                </span>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">{num(r.minutes)}</TableCell>
              <TableCell className="text-right tabular-nums">{num(r.occurrences)}</TableCell>
              <TableCell className="text-right tabular-nums">{r.occurrences > 0 ? duration((r.minutes * 60) / r.occurrences) : "—"}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.share * 100)}%`, background: color }} />
                  </div>
                  <span className="w-12 text-right text-xs tabular-nums">{pct(r.share)}</span>
                </div>
              </TableCell>
              <TableCell className={cn("pr-5 text-right tabular-nums", vital < 0 || i <= vital ? "font-medium" : "text-muted-foreground")}>
                {pct(r.cumulative)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
      <TableFooter>
        <TableRow className="hover:bg-transparent">
          <TableCell className="pl-5" />
          <TableCell className="font-semibold" colSpan={2}>
            Total · {rows.length} {rows.length === 1 ? "motivo" : "motivos"}
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums">{num(totalMin)}</TableCell>
          <TableCell className="text-right font-semibold tabular-nums">{num(totalOcc)}</TableCell>
          <TableCell className="text-right font-semibold tabular-nums">{totalOcc > 0 ? duration((totalMin * 60) / totalOcc) : "—"}</TableCell>
          <TableCell className="text-xs text-muted-foreground">{hours(totalMin)} parados</TableCell>
          <TableCell className="pr-5 text-right font-semibold tabular-nums">{pct(totalMin > 0 ? 1 : null)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}
