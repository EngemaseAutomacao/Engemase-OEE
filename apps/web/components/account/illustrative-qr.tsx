/**
 * QR code ILUSTRATIVO (protótipo): desenho determinístico a partir de um texto, com os três
 * quadrados de posição de um QR real. Não é legível por aplicativos autenticadores.
 */
const N = 29

function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 2147483647 || 7
}

function cellsFor(text: string) {
  let seed = hash(text)
  const finders = [
    [0, 0],
    [N - 7, 0],
    [0, N - 7],
  ]
  const reserved = (x: number, y: number) => finders.some(([fx, fy]) => x >= fx - 1 && x <= fx + 7 && y >= fy - 1 && y <= fy + 7)
  const cells: string[] = []
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      seed = (seed * 48271) % 2147483647
      if (reserved(x, y)) continue
      const timing = (x === 6 || y === 6) && (x + y) % 2 === 0
      if (timing || seed / 2147483647 > 0.53) cells.push(`${x},${y}`)
    }
  }
  return cells
}

export function IllustrativeQr({ value, size = 176, label }: { value: string; size?: number; label: string }) {
  const cells = cellsFor(value)
  const finder = (x: number, y: number) => (
    <g key={`f${x}-${y}`}>
      <rect x={x} y={y} width={7} height={7} rx={1.6} fill="#0f172a" />
      <rect x={x + 1} y={y + 1} width={5} height={5} rx={1} fill="#fff" />
      <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.7} fill="#0f172a" />
    </g>
  )
  // Fundo sempre branco (como um QR impresso), legível também no modo escuro.
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${N + 4} ${N + 4}`} role="img" aria-label={label} className="rounded-xl shadow-xs ring-1 ring-black/5">
      <rect x={-2} y={-2} width={N + 4} height={N + 4} rx={2.5} fill="#fff" />
      {cells.map((c) => {
        const [x, y] = c.split(",").map(Number)
        return <rect key={c} x={x + 0.07} y={y + 0.07} width={0.86} height={0.86} rx={0.22} fill="#0f172a" />
      })}
      {finder(0, 0)}
      {finder(N - 7, 0)}
      {finder(0, N - 7)}
      <rect x={N / 2 - 3} y={N / 2 - 3} width={6} height={6} rx={1.4} fill="#fff" />
      <rect x={N / 2 - 2.2} y={N / 2 - 2.2} width={4.4} height={4.4} rx={1.1} fill="#257bb4" />
    </svg>
  )
}
