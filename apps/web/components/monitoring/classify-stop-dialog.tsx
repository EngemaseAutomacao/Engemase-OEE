"use client"

import { useMemo, useState } from "react"
import { CheckIcon, OctagonAlertIcon, SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { duration, time } from "@/lib/format"
import { STATE_META } from "@/lib/states"
import type { DowntimeReason, MachineState, ReasonCategory } from "@/lib/mock/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { StateBadge } from "@/components/oee/state-badge"
import { REASON_CATEGORY_LABEL } from "@/components/monitoring/labels"

export interface StopRow {
  key: string
  state: MachineState
  start: string
  end: string
  open: boolean
  durationS: number
  faultCode?: number
  faultText?: string
  reasonId: string | null
  micro: boolean
}

const CATEGORY_CHIP: Record<ReasonCategory, string> = {
  unplanned: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
  setup: STATE_META.SETUP.soft + " " + STATE_META.SETUP.text,
  planned: STATE_META.PLANNED_STOP.soft + " " + STATE_META.PLANNED_STOP.text,
}

/** Ordem dos grupos conforme o estado bruto da parada (o mais provável primeiro). */
function categoryOrder(state: MachineState): ReasonCategory[] {
  if (state === "SETUP") return ["setup", "unplanned", "planned"]
  if (state === "PLANNED_STOP") return ["planned", "setup", "unplanned"]
  return ["unplanned", "setup", "planned"]
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()

/** Diálogo de classificação de parada com a árvore de motivos (2 níveis). */
export function ClassifyStopDialog({
  stop,
  machineName,
  reasons,
  open,
  onOpenChange,
  onConfirm,
}: {
  stop: StopRow | null
  machineName: string
  reasons: DowntimeReason[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reasonId: string, note: string) => void
}) {
  const [selected, setSelected] = useState<string | null>(stop?.reasonId ?? null)
  const [note, setNote] = useState("")
  const [query, setQuery] = useState("")

  const groups = useMemo(() => {
    if (!stop) return []
    const q = norm(query.trim())
    const parents = reasons.filter((r) => r.parentId === null)
    const order = categoryOrder(stop.state)
    return parents
      .map((p) => ({
        parent: p,
        children: reasons.filter((r) => r.parentId === p.id && (!q || norm(r.name).includes(q) || norm(p.name).includes(q))),
      }))
      .filter((g) => g.children.length > 0)
      .sort((a, b) => order.indexOf(a.parent.category) - order.indexOf(b.parent.category))
  }, [reasons, stop, query])

  if (!stop) return null
  const meta = STATE_META[stop.state]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[90dvh] grid-rows-[auto_auto_minmax(0,1fr)_auto] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{stop.reasonId ? "Reclassificar parada" : "Classificar parada"}</DialogTitle>
          <DialogDescription>
            {machineName} · {time(stop.start)}–{stop.open ? "agora" : time(stop.end)} · {duration(stop.durationS)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <StateBadge state={stop.state} />
            <span className="text-muted-foreground">Estado informado pelo CLP: {meta.label.toLowerCase()}</span>
            {stop.faultCode !== undefined && (
              <span className="inline-flex items-center gap-1 text-xs text-state-fault">
                <OctagonAlertIcon className="size-3.5" />
                Alarme {stop.faultCode}
                {stop.faultText ? ` · ${stop.faultText}` : ""}
              </span>
            )}
          </div>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar motivo" aria-label="Buscar motivo" />
          </InputGroup>
        </div>

        <div className="-mx-6 overflow-y-auto px-6" role="radiogroup" aria-label="Motivo da parada">
          {groups.length === 0 ? (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyTitle className="text-base">Nenhum motivo encontrado</EmptyTitle>
                <EmptyDescription>Tente outro termo ou peça ao supervisor para cadastrar o motivo em Configurações › Motivos de parada.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-4 pb-1">
              {groups.map(({ parent, children }) => (
                <div key={parent.id}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-medium">{parent.name}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", CATEGORY_CHIP[parent.category])}>
                      {REASON_CATEGORY_LABEL[parent.category]}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {children.map((r) => {
                      const active = selected === r.id
                      return (
                        <button
                          key={r.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setSelected(r.id)}
                          className={cn(
                            "flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            active && "border-primary bg-primary/5 ring-1 ring-primary hover:bg-primary/10",
                          )}
                        >
                          <span>{r.name}</span>
                          {active && <CheckIcon className="size-4 shrink-0 text-primary" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="stop-note">Observação (opcional)</Label>
            <Textarea
              id="stop-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: aguardando empilhadeira com resina do almoxarifado"
              className="min-h-16"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button disabled={!selected} onClick={() => selected && onConfirm(selected, note)}>
              Salvar classificação
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
