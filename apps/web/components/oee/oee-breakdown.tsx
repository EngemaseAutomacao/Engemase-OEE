import { cn } from "@/lib/utils"
import { pct } from "@/lib/format"
import { TONE_HEX, oeeTone } from "@/lib/states"
import type { OeeValues } from "@/lib/mock/types"

const ROWS: { key: keyof OeeValues; label: string }[] = [
  { key: "availability", label: "Disponibilidade" },
  { key: "performance", label: "Performance" },
  { key: "quality", label: "Qualidade" },
]

/** Barras horizontais de Disponibilidade, Performance e Qualidade. */
export function OeeBreakdown({ values, compact = false, className }: { values: OeeValues; compact?: boolean; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      {ROWS.map((row) => {
        const v = values[row.key]
        return (
          <div key={row.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
            <span className={cn("text-muted-foreground", compact ? "w-6 text-[11px]" : "w-28 text-xs")}>
              {compact ? row.label[0] : row.label}
            </span>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, v * 100)}%`, background: TONE_HEX[oeeTone(v)] }} />
            </div>
            <span className={cn("text-right tabular-nums", compact ? "w-9 text-[11px]" : "w-12 text-xs font-medium")}>{pct(v, compact ? 0 : 1)}</span>
          </div>
        )
      })}
    </div>
  )
}
