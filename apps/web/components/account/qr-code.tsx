import type { QrDrawing } from "@/lib/qr"

/** Margem em volta do QR (a norma pede 4 módulos para os leitores acharem o código). */
const QUIET = 4

/**
 * Desenha um QR code gerado por `qrDrawing` (lib/qr.ts). Fundo sempre branco e módulos pretos, como
 * um QR impresso: legível pelo celular também no modo escuro.
 */
export function QrCode({ drawing, size = 200, label }: { drawing: QrDrawing; size?: number; label: string }) {
  const side = drawing.size + QUIET * 2
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-QUIET} ${-QUIET} ${side} ${side}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="h-auto max-w-full shrink-0 rounded-xl ring-1 ring-black/10"
    >
      <rect x={-QUIET} y={-QUIET} width={side} height={side} fill="#fff" />
      <path d={drawing.path} fill="#000" />
    </svg>
  )
}
