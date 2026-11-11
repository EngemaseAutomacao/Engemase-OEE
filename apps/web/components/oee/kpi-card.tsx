import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"

/** Card de indicador: rótulo, valor grande, dica e ícone opcional. */
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  valueClassName,
  className,
  children,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: LucideIcon
  valueClassName?: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <Card className={cn("gap-0 py-4", className)}>
      <CardContent className="px-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">{label}</span>
          {Icon && <Icon className="size-4 text-muted-foreground" />}
        </div>
        <div className={cn("mt-1 text-2xl font-semibold tabular-nums", valueClassName)}>{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        {children}
      </CardContent>
    </Card>
  )
}
