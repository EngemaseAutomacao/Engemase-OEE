/**
 * Peças visuais do console de operação (frota, equipe, auditoria, acesso remoto).
 * Sem hooks: servem tanto para páginas (servidor) quanto para componentes "use client".
 */
import Link from "next/link"
import type { LucideIcon } from "lucide-react"

import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"

export type Tone = "blue" | "navy" | "teal" | "orange" | "green" | "amber" | "red" | "violet" | "slate"

export const SOFT: Record<Tone, string> = {
  blue: "bg-primary/10 text-primary",
  navy: "bg-[#2c4e73]/10 text-[#2c4e73] dark:bg-white/10 dark:text-[#9cc3e6]",
  teal: "bg-[#0e9384]/12 text-[#0e9384]",
  orange: "bg-[#e96549]/12 text-[#cf5539]",
  green: "bg-state-running/12 text-state-running",
  amber: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
  red: "bg-state-fault/12 text-state-fault",
  violet: "bg-state-setup/12 text-state-setup",
  slate: "bg-muted text-muted-foreground",
}

const DOT: Record<Tone, string> = {
  blue: "bg-primary",
  navy: "bg-[#2c4e73] dark:bg-[#9cc3e6]",
  teal: "bg-[#0e9384]",
  orange: "bg-[#e96549]",
  green: "bg-state-running",
  amber: "bg-state-stopped",
  red: "bg-state-fault",
  violet: "bg-state-setup",
  slate: "bg-state-nocomm",
}

/** Badge suave (fundo claro, texto colorido), com ponto ou ícone opcional. */
export function SoftBadge({
  tone = "slate",
  icon: Icon,
  dot = false,
  title,
  className,
  children,
}: {
  tone?: Tone
  icon?: LucideIcon
  dot?: boolean
  title?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      title={title}
      className={cn("inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", SOFT[tone], className)}
    >
      {dot && <span className={cn("size-1.5 rounded-full", DOT[tone])} aria-hidden />}
      {Icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  )
}

/** Título da página no padrão novo: título grande, subtítulo e ações à direita. */
export function OpsTitle({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Avatar com iniciais, em círculo suave. */
export function PersonAvatar({ name, tone = "blue", size = "md" }: { name: string; tone?: Tone; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        size === "sm" ? "size-7 text-[10px]" : "size-9 text-xs",
        SOFT[tone],
      )}
    >
      {initials(name)}
    </span>
  )
}

/** Classes de cabeçalho e célula das tabelas do console. */
export const TH = "px-3 py-2.5 text-left text-[11px] font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase first:pl-0 last:pr-0"
export const TD = "px-3 py-3 align-middle first:pl-0 last:pr-0"

/** Botão-ícone quadrado e suave (ações de linha). */
export const squareClass = (tone: Tone = "blue") =>
  cn(
    "inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
    SOFT[tone],
    "hover:brightness-95 dark:hover:brightness-125",
  )

export function SquareLink({ href, label, icon: Icon, tone = "blue" }: { href: string; label: string; icon: LucideIcon; tone?: Tone }) {
  return (
    <Link href={href} aria-label={label} title={label} className={squareClass(tone)}>
      <Icon aria-hidden />
    </Link>
  )
}

/** Pílulas de filtro com contagem (rádio acessível). Use dentro de componentes de cliente. */
export function FilterPills<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; count?: number }[]
  label: string
}) {
  return (
    <div className="-mx-1 max-w-full min-w-0 overflow-x-auto px-1">
      <div role="radiogroup" aria-label={label} className="flex w-max items-center gap-1.5">
        {options.map((o) => {
          const active = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {o.label}
              {o.count !== undefined && (
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-white/20" : "bg-muted")}>{o.count}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Linha "rótulo: valor" compacta usada em cartões e no detalhe. */
export function InfoRow({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-baseline justify-between gap-3 text-xs", className)}>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  )
}

/** Remove acentos e caixa para buscas. */
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`
