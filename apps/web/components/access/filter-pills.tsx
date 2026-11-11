"use client"

import { cn } from "@/lib/utils"

export interface PillOption<T extends string> {
  value: T
  label: string
  count?: number
  dot?: string
}

/** Filtro em pílulas (estilo "segmentos" do painel), com contagem opcional. Rola na horizontal no celular. */
export function FilterPills<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: PillOption<T>[]
  value: T
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <div className={cn("-mx-1 overflow-x-auto px-1", className)}>
      <div role="radiogroup" aria-label={label} className="flex w-max items-center gap-1.5">
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {o.dot && <span className={cn("size-2 rounded-full", o.dot)} />}
              {o.label}
              {o.count !== undefined && (
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-white/20" : "bg-muted")}>{o.count}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
