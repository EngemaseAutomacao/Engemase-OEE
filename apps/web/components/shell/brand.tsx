import Image from "next/image"

import { cn } from "@/lib/utils"

/**
 * Marca Engemase. Arquivos em public/brand/:
 *   engemase-icone.png       ícone redondo (selo azul-marinho sem texto) — menu, favicon
 *   engemase-logo.png        logotipo completo (fundo claro)
 *   engemase-selo.png        selo redondo com texto (fundo escuro / telas de entrada)
 *   engemase-simbolo.png     só o símbolo (hexágono de faixas)
 *   engemase-marca-dagua.png símbolo esmaecido (fundo decorativo)
 */

/** Ícone + nome do produto (menu lateral). Mantém a assinatura usada pelos layouts. */
export function Brand({ subtitle, className }: { subtitle?: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <Image src="/brand/engemase-icone.png" alt="" width={32} height={32} className="size-8 shrink-0" priority />
      <div className="grid min-w-0 leading-tight">
        <span className="truncate text-sm font-semibold">Engemase OEE</span>
        {subtitle && <span className="truncate text-xs opacity-70">{subtitle}</span>}
      </div>
    </div>
  )
}

/** Logotipo completo da Engemase. Em fundo escuro, prefira `variant="selo"`. */
export function BrandLogo({
  variant = "logo",
  width = 220,
  className,
  priority = false,
}: {
  variant?: "logo" | "selo" | "simbolo"
  width?: number
  className?: string
  priority?: boolean
}) {
  const files = {
    logo: { src: "/brand/engemase-logo.png", w: 1686, h: 738 },
    selo: { src: "/brand/engemase-selo.png", w: 722, h: 722 },
    simbolo: { src: "/brand/engemase-simbolo.png", w: 545, h: 368 },
  } as const
  const f = files[variant]
  return (
    <Image
      src={f.src}
      alt="Engemase Engenharia"
      width={width}
      height={Math.round((width * f.h) / f.w)}
      className={cn("h-auto select-none", className)}
      priority={priority}
    />
  )
}

/** Símbolo esmaecido para fundos decorativos (posicione com className). */
export function BrandWatermark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/engemase-marca-dagua.png"
      alt=""
      aria-hidden
      width={373}
      height={252}
      className={cn("pointer-events-none select-none opacity-60 dark:opacity-15", className)}
    />
  )
}
