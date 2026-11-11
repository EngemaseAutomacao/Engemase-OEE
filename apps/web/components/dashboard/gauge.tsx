/**
 * Medidor semicircular (meio anel), como o "progresso da meta" da referência.
 * `value` 0–1 (fração da meta); o texto central é livre.
 */
export function Gauge({
  value,
  color = "#257bb4",
  track = "var(--muted)",
  width = 240,
  stroke = 22,
  center,
  caption,
}: {
  value: number
  color?: string
  track?: string
  width?: number
  stroke?: number
  center: React.ReactNode
  caption?: React.ReactNode
}) {
  const r = (width - stroke) / 2
  const h = r + stroke / 2
  const arc = Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  const cx = width / 2
  const cy = h
  const d = `M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${width - stroke / 2} ${cy}`
  return (
    <div className="relative mx-auto" style={{ width, height: h + 4 }}>
      <svg width={width} height={h + 4} viewBox={`0 0 ${width} ${h + 4}`} aria-hidden>
        <path d={d} fill="none" stroke={track} strokeWidth={stroke} strokeLinecap="round" />
        <path d={d} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${arc * v} ${arc}`} />
        <circle cx={cx} cy={cy} r={0} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center leading-tight">
        <div className="text-3xl font-bold tabular-nums">{center}</div>
        {caption && <div className="text-xs text-muted-foreground">{caption}</div>}
      </div>
    </div>
  )
}
