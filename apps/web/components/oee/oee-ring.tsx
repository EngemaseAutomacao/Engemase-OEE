import { cn } from "@/lib/utils"
import { pct } from "@/lib/format"
import { TONE_HEX, oeeTone } from "@/lib/states"

/** Anel (donut) de OEE em SVG puro — funciona em componente de servidor. */
export function OeeRing({
  value,
  size = 72,
  stroke = 8,
  label = "OEE",
  className,
}: {
  value: number | null | undefined
  size?: number
  stroke?: number
  label?: string
  className?: string
}) {
  const tone = oeeTone(value)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = value && value > 0 ? Math.min(1, value) : 0
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={TONE_HEX[tone]}
          strokeDasharray={`${c * v} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-semibold tabular-nums" style={{ fontSize: size * 0.22 }}>
          {tone === "none" ? "—" : pct(value, 0)}
        </span>
        {label && size >= 64 && <span className="mt-0.5 text-[10px] text-muted-foreground uppercase">{label}</span>}
      </div>
    </div>
  )
}
