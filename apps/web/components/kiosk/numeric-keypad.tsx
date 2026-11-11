"use client"

import { DeleteIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const

/**
 * Teclado numérico grande para toque (uso com luva): teclas de 64 px ou mais,
 * com "Limpar" e "Apagar". Não guarda estado: quem usa controla o valor.
 */
export function NumericKeypad({
  onDigit,
  onBackspace,
  onClear,
  size = "lg",
  className,
}: {
  onDigit: (digit: string) => void
  onBackspace: () => void
  onClear: () => void
  size?: "md" | "lg"
  className?: string
}) {
  const key = cn(
    "flex touch-manipulation items-center justify-center rounded-xl border bg-card font-semibold tabular-nums shadow-xs transition-colors select-none",
    "hover:bg-accent active:scale-[0.97] active:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
    size === "lg" ? "h-16 text-3xl" : "h-14 text-2xl",
  )
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)} role="group" aria-label="Teclado numérico">
      {KEYS.map((k) => (
        <button key={k} type="button" className={key} onClick={() => onDigit(k)}>
          {k}
        </button>
      ))}
      <button type="button" className={cn(key, "text-base font-medium text-muted-foreground")} onClick={onClear}>
        Limpar
      </button>
      <button type="button" className={key} onClick={() => onDigit("0")}>
        0
      </button>
      <button type="button" className={key} onClick={onBackspace} aria-label="Apagar último dígito">
        <DeleteIcon className="size-7" />
      </button>
    </div>
  )
}
