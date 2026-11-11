import { FactoryIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** Marca provisória do produto (trocar pelo logotipo da Engemase). */
export function Brand({ subtitle, className }: { subtitle?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        <FactoryIcon className="size-4" />
      </div>
      <div className="grid min-w-0 leading-tight">
        <span className="truncate text-sm font-semibold">Engemase OEE</span>
        {subtitle && <span className="truncate text-xs opacity-70">{subtitle}</span>}
      </div>
    </div>
  )
}
