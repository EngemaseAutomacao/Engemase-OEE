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

const ACTION_TONES = {
  blue: "bg-primary/10 text-primary hover:bg-primary/20",
  teal: "bg-[#0e9384]/10 text-[#0e9384] hover:bg-[#0e9384]/20",
  red: "bg-state-fault/10 text-state-fault hover:bg-state-fault/20",
  slate: "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
} as const

/** Botão-ícone quadrado e suave (padrão das ações em tabelas e listas). */
export function IconAction({
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

/** Confirmação de ação destrutiva (excluir). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Excluir",
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel?: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Título de página no padrão novo: título forte, subtítulo e ações à direita. */
export function PageTitle({ title, description, actions }: { title: string; description: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">{actions}</div>}
    </div>
  )
}
