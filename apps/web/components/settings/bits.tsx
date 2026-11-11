"use client"

import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** Título de página no padrão novo: título forte, subtítulo e ações à direita. */
export function SettingsTitle({ title, description, actions }: { title: string; description: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

const ACTION_TONES = {
  blue: "bg-primary/10 text-primary hover:bg-primary/20",
  teal: "bg-[#0e9384]/10 text-[#0e9384] hover:bg-[#0e9384]/20",
  red: "bg-state-fault/10 text-state-fault hover:bg-state-fault/20",
  slate: "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
} as const

/** Botão-ícone quadrado e suave (ações em tabelas e listas). */
export function SquareAction({
  icon: Icon,
  label,
  tone = "blue",
  onClick,
  disabled,
  className,
}: {
  icon: LucideIcon
  label: string
  tone?: keyof typeof ACTION_TONES
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&>svg]:size-4",
            ACTION_TONES[tone],
            className,
          )}
        >
          <Icon aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export const SOFT_TONES = {
  blue: "bg-primary/10 text-primary",
  navy: "bg-[#2c4e73]/10 text-[#2c4e73] dark:bg-white/10 dark:text-[#9cc3e6]",
  teal: "bg-[#0e9384]/12 text-[#0e9384]",
  orange: "bg-[#e96549]/12 text-[#cf5539]",
  green: "bg-state-running/12 text-state-running",
  amber: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
  red: "bg-state-fault/12 text-state-fault",
  violet: "bg-state-setup/12 text-state-setup",
  slate: "bg-muted text-muted-foreground",
} as const

export type SoftTone = keyof typeof SOFT_TONES

/** Badge suave (fundo claro, texto colorido). */
export function SoftBadge({ tone = "slate", icon: Icon, children, className }: { tone?: SoftTone; icon?: LucideIcon; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", SOFT_TONES[tone], className)}>
      {Icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  )
}

/** Ponto de status + texto (online/offline etc.). */
export function StatusDot({ tone, children, pulse = false }: { tone: SoftTone; children: React.ReactNode; pulse?: boolean }) {
  const dot = {
    blue: "bg-primary",
    navy: "bg-[#2c4e73]",
    teal: "bg-[#0e9384]",
    orange: "bg-[#e96549]",
    green: "bg-state-running",
    amber: "bg-state-stopped",
    red: "bg-state-fault",
    violet: "bg-state-setup",
    slate: "bg-state-nocomm",
  }[tone]
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", SOFT_TONES[tone])}>
      <span className="relative flex size-1.5">
        {pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", dot)} />}
        <span className={cn("relative inline-flex size-1.5 rounded-full", dot)} />
      </span>
      {children}
    </span>
  )
}

/** Avatar com iniciais em círculo suave. */
export function InitialsAvatar({ name, tone = "blue", className }: { name: string; tone?: SoftTone; className?: string }) {
  const text = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("")
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", SOFT_TONES[tone], className)} aria-hidden>
      {text}
    </span>
  )
}

/** Confirmação de ação sensível (revogar, desativar, restaurar). */
export function ConfirmAction({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = true,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`
}
