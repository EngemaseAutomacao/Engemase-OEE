import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { num } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"

export interface UsageItem {
  label: string
  used: number
  limit: number
  icon: LucideIcon
}

/** Cor da barra conforme a ocupação do limite do plano. */
function tone(used: number, limit: number) {
  const ratio = limit > 0 ? used / limit : 0
  if (ratio >= 1) return { bar: "*:data-[slot=progress-indicator]:bg-state-fault", text: "text-state-fault", note: "Limite atingido" }
  if (ratio >= 0.8) return { bar: "*:data-[slot=progress-indicator]:bg-state-stopped", text: "text-amber-700 dark:text-state-stopped", note: "Perto do limite" }
  return { bar: "", text: "text-muted-foreground", note: null }
}

/** Uma barra de uso: "8 de 30 máquinas". Componente sem estado (servidor ou cliente). */
export function UsageMeter({ item, className }: { item: UsageItem; className?: string }) {
  const t = tone(item.used, item.limit)
  const Icon = item.icon
  const value = item.limit > 0 ? Math.min(100, (item.used / item.limit) * 100) : 0
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
          <Icon className="size-3.5" />
          {item.label}
        </span>
        <span className="tabular-nums">
          <span className="font-semibold text-foreground">{num(item.used)}</span>
          <span className="text-muted-foreground"> / {num(item.limit)}</span>
        </span>
      </div>
      <Progress value={value} className={cn("h-1.5", t.bar)} aria-label={`${item.label}: ${item.used} de ${item.limit}`} />
      {t.note && <span className={cn("text-[11px] font-medium", t.text)}>{t.note}</span>}
    </div>
  )
}

/** Cartão com o plano do cliente e o uso dos limites (máquinas, gateways, usuários). */
export function PlanUsage({
  planLabel,
  items,
  footnote,
  className,
}: {
  planLabel: string
  items: UsageItem[]
  footnote?: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("gap-0 py-4", className)}>
      <CardContent className="flex flex-col gap-4 px-4 md:flex-row md:items-center md:gap-6">
        <div className="flex shrink-0 items-center gap-2 md:w-44 md:flex-col md:items-start md:gap-1">
          <span className="text-xs font-medium text-muted-foreground uppercase">Plano contratado</span>
          <Badge variant="secondary" className="text-sm">
            {planLabel}
          </Badge>
        </div>
        <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <UsageMeter key={it.label} item={it} />
          ))}
        </div>
        {footnote && <div className="text-xs text-muted-foreground md:w-56 md:shrink-0">{footnote}</div>}
      </CardContent>
    </Card>
  )
}
