import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Variação em relação ao período anterior, colorida pelo SIGNIFICADO
 * (melhorou = verde, piorou = vermelho), não pelo sinal.
 */
export function Delta({
  value,
  better,
  format,
  label,
  epsilon = 0,
  className,
}: {
  /** Diferença atual − anterior (null = sem base de comparação). */
  value: number | null
  /** "up": subir é bom (OEE, MTBF); "down": descer é bom (tempo parado, MTTR). */
  better: "up" | "down"
  /** Formata o valor ABSOLUTO da variação. */
  format: (abs: number) => string
  label?: string
  /** Variações menores que isto contam como estáveis. */
  epsilon?: number
  className?: string
}) {
  if (value === null || Number.isNaN(value)) {
    return <span className={cn("text-muted-foreground", className)}>Sem base de comparação</span>
  }
  const flat = Math.abs(value) <= epsilon
  const good = flat ? null : better === "up" ? value > 0 : value < 0
  const Icon = flat ? MinusIcon : value > 0 ? ArrowUpIcon : ArrowDownIcon
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-medium tabular-nums",
          good === null ? "text-muted-foreground" : good ? "text-state-running" : "text-state-fault",
        )}
      >
        <Icon className="size-3" aria-hidden />
        <span className="sr-only">{flat ? "Estável:" : good ? "Melhorou:" : "Piorou:"}</span>
        {flat ? "estável" : format(Math.abs(value))}
      </span>
      {label && <span className="text-muted-foreground">{label}</span>}
    </span>
  )
}
