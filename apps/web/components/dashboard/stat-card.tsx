import type { LucideIcon } from "lucide-react"
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"

/**
 * Cartão de indicador no estilo do painel: ícone em círculo, rótulo, valor grande e variação.
 * `delta` positivo = melhora (verde); use `deltaInverted` quando subir for ruim (ex.: refugo).
 */
export function StatCard({
  icon,
  tone = "blue",
  label,
  value,
  delta,
  deltaLabel = "vs ontem",
  deltaInverted = false,
  hint,
  aside,
  className,
}: {
  icon: LucideIcon
  tone?: IconTone
  label: string
  value: React.ReactNode
  delta?: number | null
  deltaLabel?: string
  deltaInverted?: boolean
  hint?: React.ReactNode
  aside?: React.ReactNode
  className?: string
}) {
  const good = delta !== undefined && delta !== null && (deltaInverted ? delta < 0 : delta > 0)
  const showDelta = delta !== undefined && delta !== null && delta !== 0
  return (
    <div className={cn("flex items-center gap-4 rounded-2xl border bg-card px-5 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)}>
      <IconCircle icon={icon} tone={tone} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate text-2xl leading-tight font-bold tracking-tight tabular-nums">{value}</div>
        {showDelta ? (
          <div className="mt-0.5 flex items-center gap-1 text-xs">
            <span className={cn("inline-flex items-center gap-0.5 font-semibold", good ? "text-state-running" : "text-state-fault")}>
              {delta! > 0 ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />}
              {Math.abs(delta!).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
            </span>
            <span className="truncate text-muted-foreground">{deltaLabel}</span>
          </div>
        ) : (
          hint && <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>
        )}
      </div>
      {aside}
    </div>
  )
}
