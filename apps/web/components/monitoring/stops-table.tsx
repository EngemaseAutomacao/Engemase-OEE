"use client"

import { useState } from "react"
import { CircleCheckIcon, PencilIcon, TagIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { duration, time } from "@/lib/format"
import type { DowntimeReason } from "@/lib/mock/types"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StateBadge } from "@/components/oee/state-badge"
import { ClassifyStopDialog, type StopRow } from "@/components/monitoring/classify-stop-dialog"

/** Tabela de paradas do turno, com classificação de motivo (estado local + toast). */
export function StopsTable({
  rows,
  reasons,
  reasonPaths,
  machineName,
  microStopThresholdS,
}: {
  rows: StopRow[]
  reasons: DowntimeReason[]
  reasonPaths: Record<string, string>
  machineName: string
  microStopThresholdS: number
}) {
  const [assigned, setAssigned] = useState<Record<string, string>>({})
  const [showMicro, setShowMicro] = useState(false)
  const [target, setTarget] = useState<StopRow | null>(null)

  const withReason = rows.map((r) => ({ ...r, reasonId: assigned[r.key] ?? r.reasonId }))
  const relevant = withReason.filter((r) => !r.micro)
  const micro = withReason.filter((r) => r.micro)
  const pending = relevant.filter((r) => r.state === "STOPPED" && r.reasonId === null)
  const visible = showMicro ? withReason : relevant
  const stoppedS = relevant.filter((r) => r.state !== "PLANNED_STOP").reduce((s, r) => s + r.durationS, 0)

  const confirm = (reasonId: string, note: string) => {
    if (!target) return
    setAssigned((a) => ({ ...a, [target.key]: reasonId }))
    toast.success(`Parada das ${time(target.start)} classificada`, {
      description: `${reasonPaths[reasonId] ?? "Motivo registrado"}${note ? ` · "${note}"` : ""}. O OEE do turno será recalculado.`,
    })
    setTarget(null)
  }

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Paradas do turno</CardTitle>
        <CardDescription>
          {relevant.length} {relevant.length === 1 ? "parada" : "paradas"} · {duration(stoppedS)} sem produzir (exceto planejadas)
          {pending.length > 0 && (
            <>
              {" · "}
              <span className="font-medium text-amber-700 dark:text-state-stopped">
                {pending.length} aguardando motivo
              </span>
            </>
          )}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Switch id="show-micro" checked={showMicro} onCheckedChange={setShowMicro} disabled={micro.length === 0} />
          <Label htmlFor="show-micro" className="text-xs font-normal whitespace-nowrap text-muted-foreground">
            Micro-paradas ({micro.length})
          </Label>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {visible.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheckIcon />
              </EmptyMedia>
              <EmptyTitle className="text-base">Nenhuma parada no turno</EmptyTitle>
              <EmptyDescription>
                A máquina não registrou paradas acima de {duration(microStopThresholdS)} desde o início do turno.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Início</TableHead>
                <TableHead>Fim</TableHead>
                <TableHead className="text-right">Duração</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="pr-6 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => {
                const needsReason = r.state === "STOPPED" && !r.micro && r.reasonId === null
                const editable = !r.micro && r.state !== "NO_COMM"
                return (
                  <TableRow key={r.key} className={cn(needsReason && "bg-state-stopped/5", r.micro && "text-muted-foreground")}>
                    <TableCell className="pl-6 tabular-nums">{time(r.start)}</TableCell>
                    <TableCell className="tabular-nums">
                      {r.open ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                          <span className="size-1.5 animate-pulse rounded-full bg-foreground" />
                          em andamento
                        </span>
                      ) : (
                        time(r.end)
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{duration(r.durationS)}</TableCell>
                    <TableCell>
                      <StateBadge state={r.state} short />
                      {r.faultCode !== undefined && (
                        <div className="mt-1 max-w-56 truncate text-xs text-state-fault">
                          Alarme {r.faultCode}
                          {r.faultText ? ` · ${r.faultText}` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-72">
                      {r.micro ? (
                        <span className="text-xs">Micro-parada · conta na performance, sem motivo</span>
                      ) : r.state === "NO_COMM" ? (
                        <span className="text-xs text-muted-foreground">Sem comunicação (automático)</span>
                      ) : r.reasonId ? (
                        <span className="flex items-center gap-1.5">
                          <TagIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{reasonPaths[r.reasonId] ?? "Motivo removido"}</span>
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-amber-700 dark:text-state-stopped">Motivo não informado</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {needsReason ? (
                        <Button size="sm" onClick={() => setTarget(r)}>
                          Classificar
                        </Button>
                      ) : editable ? (
                        <Button variant="ghost" size="icon-sm" aria-label={`Reclassificar parada das ${time(r.start)}`} onClick={() => setTarget(r)}>
                          <PencilIcon />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ClassifyStopDialog
        key={target?.key ?? "none"}
        stop={target}
        machineName={machineName}
        reasons={reasons}
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        onConfirm={confirm}
      />
    </Card>
  )
}
