/**
 * QR ilustrativo do pareamento (protótipo): desenho determinístico a partir do código,
 * com os três quadrados de posição de um QR real. Não é um QR válido para leitura.
 */
const N = 25

/** Módulos "escuros" do desenho, a partir do código (gerador congruente simples). */
function modulesFor(code: string) {
  const digits = code.replace(/\D/g, "") || "0"
  let seed = Number(digits) % 2147483647 || 7
  const corners = [
    [0, 0],
    [N - 7, 0],
    [0, N - 7],
  ]
  const inFinder = (x: number, y: number) => corners.some(([cx, cy]) => x >= cx - 1 && x <= cx + 7 && y >= cy - 1 && y <= cy + 7)
  const cells: { x: number; y: number }[] = []
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      seed = (seed * 48271) % 2147483647
      if (inFinder(x, y)) continue
      if ((x === 6 || y === 6) && (x + y) % 2 === 0) cells.push({ x, y })
      else if (seed / 2147483647 > 0.52) cells.push({ x, y })
    }
  }
  return cells
}

export function PairingQr({ code, size = 168 }: { code: string; size?: number }) {
  const n = N
  const cells = modulesFor(code)

  const finder = (cx: number, cy: number) => (
    <g key={`${cx}-${cy}`}>
      <rect x={cx} y={cy} width={7} height={7} rx={1.4} className="fill-foreground" />
      <rect x={cx + 1} y={cy + 1} width={5} height={5} rx={0.9} className="fill-card" />
      <rect x={cx + 2} y={cy + 2} width={3} height={3} rx={0.6} className="fill-foreground" />
    </g>
  )

  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={`QR de pareamento (ilustrativo) do código ${code}`} className="rounded-xl bg-card">
      <rect x={-2} y={-2} width={n + 4} height={n + 4} rx={2} className="fill-card" />
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x + 0.06} y={c.y + 0.06} width={0.88} height={0.88} rx={0.2} className="fill-foreground" />
      ))}
      {finder(0, 0)}
      {finder(n - 7, 0)}
      {finder(0, n - 7)}
    </svg>
  )
}
