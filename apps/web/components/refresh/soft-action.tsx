"use client"

import Link from "next/link"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Botões-ícone quadrados e suaves (padrão das ações em listas e tabelas).
 * O ícone vem como elemento (`<PencilIcon />`), para poder ser usado também a partir de páginas de servidor.
 */
export const SOFT_TONES = {
  blue: "bg-primary/10 text-primary hover:bg-primary/20",
  teal: "bg-[#0e9384]/10 text-[#0e9384] hover:bg-[#0e9384]/20",
  orange: "bg-[#e96549]/12 text-[#cf5539] hover:bg-[#e96549]/20",
  red: "bg-state-fault/10 text-state-fault hover:bg-state-fault/20",
  slate: "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
} as const

export type SoftTone = keyof typeof SOFT_TONES

const BASE =
  "inline-flex shrink-0 items-center justify-center rounded-lg transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0"

const SIZES = {
  sm: "size-8 [&_svg:not([class*='size-'])]:size-4",
  md: "size-9 [&_svg:not([class*='size-'])]:size-4",
} as const

/** Botão-ícone suave com dica (tooltip). */
export function SoftIconButton({
  label,
  tone = "blue",
  size = "sm",
  onClick,
  disabled,
  className,
  children,
}: {
  label: string
  tone?: SoftTone
  size?: keyof typeof SIZES
  onClick?: () => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={cn(BASE, SIZES[size], SOFT_TONES[tone], className)}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Link em forma de botão-ícone suave com dica (tooltip). */
export function SoftIconLink({
  href,
  label,
  tone = "blue",
  size = "sm",
  className,
  children,
}: {
  href: string
  label: string
  tone?: SoftTone
  size?: keyof typeof SIZES
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={href} aria-label={label} className={cn(BASE, SIZES[size], SOFT_TONES[tone], className)}>
          {children}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Link suave com ícone e texto (ações de cabeçalho que precisam de rótulo visível). */
export function SoftLink({
  href,
  tone = "blue",
  className,
  children,
}: {
  href: string
  tone?: SoftTone
  className?: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(BASE, "h-9 gap-2 px-3 text-sm font-medium [&_svg:not([class*='size-'])]:size-4", SOFT_TONES[tone], className)}
    >
      {children}
    </Link>
  )
}
