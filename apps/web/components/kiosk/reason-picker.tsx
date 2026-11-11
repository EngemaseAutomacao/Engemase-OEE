"use client"

import { useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  PackageIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { duration, time } from "@/lib/format"
import { STATE_META } from "@/lib/states"
import type { ReasonCategory } from "@/lib/mock"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { PendingStop, ReasonOption } from "@/components/kiosk/operator-types"
import { CATEGORY_BUTTON, CATEGORY_LABEL, CATEGORY_STATE, STATE_ON } from "@/components/kiosk/state-style"

/** Ícone do grupo de motivo pelo nome (fallback genérico para nomes personalizados). */
const GROUP_ICON: Record<string, LucideIcon> = {
  Mecânica: WrenchIcon,
  Elétrica: ZapIcon,
  Processo: SlidersHorizontalIcon,
  Logística: PackageIcon,
  Setup: RefreshCwIcon,
  "Paradas planejadas": CalendarClockIcon,
}

const CATEGORY_ORDER: Record<ReasonCategory, number> = { unplanned: 0, setup: 1, planned: 2 }

export interface PickedReason {
  reason: ReasonOption
  group: ReasonOption | null
}

/**
 * Seleção de motivo em 2 níveis (grupo → motivo) com botões grandes coloridos por categoria.
 * Um toque no motivo final já classifica (o toast oferece "Desfazer").
 */
export function ReasonPicker({
  stop,
  reasons,
  nowMs,
  timeZone,
  onOpenChange,
  onPick,
}: {
  stop: PendingStop | null
  reasons: ReasonOption[]
  nowMs: number
  timeZone: string
  onOpenChange: (open: boolean) => void
  onPick: (stop: PendingStop, picked: PickedReason) => void
}) {
  return (
    <Dialog open={stop !== null} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        {stop && (
          <ReasonPickerBody
            key={stop.id}
            stop={stop}
            reasons={reasons}
            nowMs={nowMs}
            timeZone={timeZone}
            onCancel={() => onOpenChange(false)}
            onPick={(picked) => onPick(stop, picked)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReasonPickerBody({
  stop,
  reasons,
  nowMs,
  timeZone,
  onCancel,
  onPick,
}: {
  stop: PendingStop
  reasons: ReasonOption[]
  nowMs: number
  timeZone: string
  onCancel: () => void
  onPick: (picked: PickedReason) => void
}) {
  const [groupId, setGroupId] = useState<string | null>(null)

  const groups = useMemo(
    () => reasons.filter((r) => r.parentId === null).sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]),
    [reasons],
  )
  const childrenOf = useMemo(() => {
    const map = new Map<string, ReasonOption[]>()
    for (const r of reasons) {
      if (!r.parentId) continue
      map.set(r.parentId, [...(map.get(r.parentId) ?? []), r])
    }
    return map
  }, [reasons])

  const group = groupId ? groups.find((g) => g.id === groupId) ?? null : null
  const endMs = stop.ongoing ? nowMs : Date.parse(stop.end)
  const dur = duration((endMs - Date.parse(stop.start)) / 1000)
  const meta = STATE_META[stop.state]

  return (
    <>
      <DialogHeader className="gap-3 border-b p-4 text-left sm:p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold", meta.bg, STATE_ON[stop.state])}>
            {stop.state === "FAULT" ? "Falha" : "Parada não planejada"}
          </span>
          <span className="font-medium tabular-nums">
            {time(stop.start, timeZone)} – {stop.ongoing ? "agora" : time(stop.end, timeZone)} · {dur}
          </span>
          {stop.faultCode !== undefined && (
            <span className="text-state-fault">
              F{stop.faultCode}
              {stop.faultText ? ` · ${stop.faultText}` : ""}
            </span>
          )}
        </div>
        <DialogTitle className="text-xl sm:text-2xl">{group ? `${group.name}: qual foi o problema?` : "Qual foi o motivo da parada?"}</DialogTitle>
        <DialogDescription>
          {group ? "Toque no motivo. Você pode desfazer logo depois." : "Escolha o grupo do motivo. As cores indicam a categoria da parada."}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {!group ? (
          <>
            <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {(Object.keys(CATEGORY_LABEL) as ReasonCategory[]).map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2.5 rounded-sm", STATE_META[CATEGORY_STATE[c]].bg)} />
                  {CATEGORY_LABEL[c]}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {groups.map((g) => {
                const Icon = GROUP_ICON[g.name] ?? CircleHelpIcon
                const kids = childrenOf.get(g.id) ?? []
                const state = CATEGORY_STATE[g.category]
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => (kids.length > 0 ? setGroupId(g.id) : onPick({ reason: g, group: null }))}
                    className={cn(
                      "flex min-h-28 touch-manipulation flex-col items-start justify-between gap-3 rounded-xl border-2 p-4 text-left transition-colors select-none",
                      "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]",
                      CATEGORY_BUTTON[g.category],
                    )}
                  >
                    <span className={cn("flex size-11 items-center justify-center rounded-lg", STATE_META[state].bg, STATE_ON[state])}>
                      <Icon className="size-6" />
                    </span>
                    <span className="flex w-full items-end justify-between gap-2">
                      <span>
                        <span className="block text-lg leading-tight font-semibold">{g.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {CATEGORY_LABEL[g.category]}
                          {kids.length > 0 ? ` · ${kids.length} motivos` : ""}
                        </span>
                      </span>
                      {kids.length > 0 && <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(childrenOf.get(group.id) ?? []).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onPick({ reason: r, group })}
                className={cn(
                  "flex min-h-20 touch-manipulation items-center justify-between gap-3 rounded-xl border-2 px-5 py-4 text-left text-lg leading-tight font-semibold transition-colors select-none",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]",
                  CATEGORY_BUTTON[r.category],
                )}
              >
                {r.name}
                <span className={cn("size-3 shrink-0 rounded-full", STATE_META[CATEGORY_STATE[r.category]].bg)} aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3 border-t p-4">
        {group ? (
          <Button variant="outline" className="h-12 flex-1 text-base sm:flex-none sm:px-6" onClick={() => setGroupId(null)}>
            <ArrowLeftIcon className="size-5" />
            Voltar
          </Button>
        ) : null}
        <Button variant="ghost" className="h-12 flex-1 text-base sm:ml-auto sm:flex-none sm:px-6" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </>
  )
}
