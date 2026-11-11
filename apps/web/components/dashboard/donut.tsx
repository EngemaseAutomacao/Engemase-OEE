export interface DonutSegment {
  label: string
  value: number
  color: string
}

/** Rosca com segmentos e rótulo central. */
export function Donut({ segments, size = 168, stroke = 26, center, caption }: { segments: DonutSegment[]; size?: number; stroke?: number; center: React.ReactNode; caption?: React.ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const offsets = segments.map((_, i) => segments.slice(0, i).reduce((acc, x) => acc + (x.value / total) * c, 0))
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        {segments.map((s, i) => {
          const len = (s.value / total) * c
          return (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
              strokeDashoffset={-offsets[i]}
            />
          )
        })}
      </svg>
      <div className="absolute flex flex-col items-center leading-tight">
        <span className="text-2xl font-bold tabular-nums">{center}</span>
        {caption && <span className="text-[11px] text-muted-foreground">{caption}</span>}
      </div>
    </div>
  )
}
