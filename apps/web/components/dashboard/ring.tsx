/** Anel de progresso simples (ex.: % da meta), em SVG. */
export function Ring({ value, size = 64, stroke = 7, color = "#257bb4", label }: { value: number; size?: number; stroke?: number; color?: string; label?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" stroke={color} strokeDasharray={`${c * v} ${c}`} />
      </svg>
      {label && <span className="absolute text-[11px] font-semibold tabular-nums">{label}</span>}
    </div>
  )
}
