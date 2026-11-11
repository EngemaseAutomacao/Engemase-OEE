import Link from "next/link"
import type { LucideIcon } from "lucide-react"

import type { ClientManagement, ClientPlan, GatewayStatus } from "@/lib/mock/types"
import { GATEWAY_STATUS_LABEL, PLAN_LABEL } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { MANAGEMENT_LABEL, MANAGEMENT_SHORT, PLAN_TONE, STATUS_LABEL, STATUS_TONE, type AdminClientStatus, type SoftTone } from "./labels"

export const SOFT_TONES: Record<SoftTone, string> = {
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

const DOT: Record<SoftTone, string> = {
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
  children,
  className,
}: {
  tone?: SoftTone
  icon?: LucideIcon
  dot?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={cn("inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", SOFT_TONES[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", DOT[tone])} aria-hidden />}
      {Icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  )
}

export function ClientStatusBadge({ status, className }: { status: AdminClientStatus; className?: string }) {
  return (
    <SoftBadge tone={STATUS_TONE[status]} dot className={className}>
      {STATUS_LABEL[status]}
    </SoftBadge>
  )
}

export function PlanBadge({ plan }: { plan: ClientPlan }) {
  return <SoftBadge tone={PLAN_TONE[plan]}>{PLAN_LABEL[plan]}</SoftBadge>
}

export function ManagementBadge({ management, short = false }: { management: ClientManagement; short?: boolean }) {
  return <SoftBadge tone={management === "engemase" ? "teal" : "navy"}>{short ? MANAGEMENT_SHORT[management] : MANAGEMENT_LABEL[management]}</SoftBadge>
}

export const GATEWAY_TONE: Record<GatewayStatus, SoftTone> = { online: "green", degraded: "amber", offline: "red", pending: "slate" }

export function GatewayStatusBadge({ status }: { status: GatewayStatus }) {
  return (
    <SoftBadge tone={GATEWAY_TONE[status]} dot>
      {GATEWAY_STATUS_LABEL[status]}
    </SoftBadge>
  )
}

const SQUARE_TONES = {
  blue: "bg-primary/10 text-primary hover:bg-primary/20",
  teal: "bg-[#0e9384]/10 text-[#0e9384] hover:bg-[#0e9384]/20",
  red: "bg-state-fault/10 text-state-fault hover:bg-state-fault/20",
  slate: "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
} as const

export type SquareTone = keyof typeof SQUARE_TONES

export const squareClass = (tone: SquareTone = "blue") =>
  cn(
    "flex size-8 shrink-0 items-center justify-center rounded-lg transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&>svg]:size-4",
    SQUARE_TONES[tone],
  )

/** Link em botão-ícone quadrado e suave (ações de tabelas e listas). */
export function SquareLink({ href, icon: Icon, label, tone = "blue" }: { href: string; icon: LucideIcon; label: string; tone?: SquareTone }) {
  return (
    <Link href={href} aria-label={label} title={label} className={squareClass(tone)}>
      <Icon aria-hidden />
    </Link>
  )
}

/** Barra fina de uso × limite (verde/âmbar/vermelho conforme a ocupação). */
export function UsageBar({ used, limit, className }: { used: number; limit: number; className?: string }) {
  const ratio = limit > 0 ? used / limit : 0
  const color = ratio >= 1 ? "bg-state-fault" : ratio >= 0.8 ? "bg-state-stopped" : "bg-primary"
  return (
    <span className={cn("block h-1.5 overflow-hidden rounded-full bg-muted", className)} aria-hidden>
      <span className={cn("block h-full rounded-full", color)} style={{ width: `${Math.max(used > 0 ? 4 : 0, Math.min(100, ratio * 100))}%` }} />
    </span>
  )
}

/** Título de página do padrão visual: título forte, subtítulo e ações à direita. */
export function PageTitle({ title, description, actions, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {children}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Par rótulo/valor compacto (dados cadastrais, resumos). */
export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm first:pt-0 last:pb-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{children}</dd>
    </div>
  )
}

/** Cabeçalho de tabela padrão (texto pequeno, sem caixa alta gritante). */
export const TH = "h-9 px-3 text-left text-[11px] font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase first:pl-0 last:pr-0"
export const TD = "px-3 py-2.5 align-middle first:pl-0 last:pr-0"
