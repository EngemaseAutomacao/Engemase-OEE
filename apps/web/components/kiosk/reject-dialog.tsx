"use client"

import { useState } from "react"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { num } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NumericKeypad } from "@/components/kiosk/numeric-keypad"

/** Tipos de defeito mais comuns (motivo de refugo do lançamento manual). */
const DEFECTS = ["Rebarba", "Peça incompleta", "Dimensional fora", "Mancha / risco", "Trinca / quebra", "Outro"] as const

const MAX_DIGITS = 5

export function RejectDialog({
  open,
  onOpenChange,
  machineName,
  maxQty,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  machineName: string
  /** Peças boas no turno: não dá para refugar mais do que isso. */
  maxQty: number
  onConfirm: (qty: number, defect: string | null) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        {open && <RejectBody machineName={machineName} maxQty={maxQty} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} />}
      </DialogContent>
    </Dialog>
  )
}

function RejectBody({
  machineName,
  maxQty,
  onCancel,
  onConfirm,
}: {
  machineName: string
  maxQty: number
  onCancel: () => void
  onConfirm: (qty: number, defect: string | null) => void
}) {
  const [value, setValue] = useState("")
  const [defect, setDefect] = useState<string | null>(null)
  const qty = Number(value || "0")
  const tooMany = qty > maxQty
  const valid = qty > 0 && !tooMany

  const add = (n: number) => setValue((v) => String(Math.min(10 ** MAX_DIGITS - 1, Number(v || "0") + n)))

  return (
    <>
      <DialogHeader className="border-b p-4 text-left sm:p-5">
        <DialogTitle className="text-xl sm:text-2xl">Lançar refugo</DialogTitle>
        <DialogDescription>
          Peças descartadas na {machineName} que o CLP não contou como refugo. O valor entra no cálculo de qualidade do turno.
        </DialogDescription>
      </DialogHeader>

      <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-4 sm:p-5 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div
            className={cn(
              "flex items-baseline justify-between gap-3 rounded-xl border-2 bg-muted/40 px-5 py-3",
              tooMany ? "border-destructive" : "border-input",
            )}
          >
            <output aria-live="polite" className="text-6xl leading-none font-bold tabular-nums">
              {num(qty)}
            </output>
            <span className="text-lg text-muted-foreground">{qty === 1 ? "peça" : "peças"}</span>
          </div>
          {tooMany ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              Maior que as peças boas do turno ({num(maxQty)}). Confira a quantidade.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {[1, 5, 10, 50].map((n) => (
                <Button key={n} type="button" variant="secondary" className="h-12 text-base font-semibold tabular-nums" onClick={() => add(n)}>
                  +{n}
                </Button>
              ))}
            </div>
          )}
          <NumericKeypad
            onDigit={(d) => setValue((v) => (v.length >= MAX_DIGITS ? v : (v === "0" ? "" : v) + d))}
            onBackspace={() => setValue((v) => v.slice(0, -1))}
            onClear={() => setValue("")}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <div className="text-sm font-medium">Tipo de defeito</div>
            <p className="text-xs text-muted-foreground">Opcional, mas ajuda a qualidade a achar a causa.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DEFECTS.map((d) => {
              const active = defect === d
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDefect(active ? null : d)}
                  className={cn(
                    "flex min-h-14 touch-manipulation items-center justify-between gap-2 rounded-xl border-2 px-4 text-left text-base font-medium transition-colors select-none",
                    "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]",
                    active ? "border-primary bg-primary/10" : "border-input bg-card hover:bg-accent",
                  )}
                >
                  {d}
                  {active && <CheckIcon className="size-5 shrink-0 text-primary" />}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t p-4 sm:flex-row sm:justify-end">
        <Button variant="ghost" className="h-12 text-base sm:px-6" onClick={onCancel}>
          Cancelar
        </Button>
        <Button className="h-14 text-lg sm:min-w-56" disabled={!valid} onClick={() => onConfirm(qty, defect)}>
          {qty > 0 ? `Lançar ${num(qty)} ${qty === 1 ? "peça" : "peças"}` : "Digite a quantidade"}
        </Button>
      </div>
    </>
  )
}
