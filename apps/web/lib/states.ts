import type { MachineState } from "@/lib/mock/types"

/**
 * Metadados visuais dos estados de máquina.
 * `dot`/`bg`/`text`/`border` usam as cores de tema (app/globals.css), que mudam no modo escuro.
 * `hex` é usado em gráficos (ECharts não lê variáveis CSS).
 */
export const STATE_META: Record<
  MachineState,
  { label: string; short: string; dot: string; bg: string; soft: string; text: string; border: string; hex: string }
> = {
  RUNNING: { label: "Produzindo", short: "Produzindo", dot: "bg-state-running", bg: "bg-state-running", soft: "bg-state-running/12", text: "text-state-running", border: "border-state-running", hex: "#16a34a" },
  STOPPED: { label: "Parada não planejada", short: "Parada", dot: "bg-state-stopped", bg: "bg-state-stopped", soft: "bg-state-stopped/15", text: "text-amber-700 dark:text-state-stopped", border: "border-state-stopped", hex: "#f59e0b" },
  FAULT: { label: "Falha", short: "Falha", dot: "bg-state-fault", bg: "bg-state-fault", soft: "bg-state-fault/12", text: "text-state-fault", border: "border-state-fault", hex: "#dc2626" },
  SETUP: { label: "Setup / troca", short: "Setup", dot: "bg-state-setup", bg: "bg-state-setup", soft: "bg-state-setup/12", text: "text-state-setup", border: "border-state-setup", hex: "#8b5cf6" },
  PLANNED_STOP: { label: "Parada planejada", short: "Planejada", dot: "bg-state-planned", bg: "bg-state-planned", soft: "bg-state-planned/15", text: "text-state-planned", border: "border-state-planned", hex: "#64748b" },
  NO_COMM: { label: "Sem comunicação", short: "Sem com.", dot: "bg-state-nocomm", bg: "bg-state-nocomm", soft: "bg-state-nocomm/15", text: "text-muted-foreground", border: "border-state-nocomm", hex: "#a1a1aa" },
}

export const STATE_ORDER: MachineState[] = ["RUNNING", "STOPPED", "FAULT", "SETUP", "PLANNED_STOP", "NO_COMM"]

/** Faixas de OEE: ≥ 85% classe mundial, ≥ 60% aceitável, abaixo disso crítico. */
export function oeeTone(value: number | null | undefined): "good" | "warn" | "bad" | "none" {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) return "none"
  if (value >= 0.85) return "good"
  if (value >= 0.6) return "warn"
  return "bad"
}

export const TONE_TEXT = {
  good: "text-state-running",
  warn: "text-amber-600 dark:text-state-stopped",
  bad: "text-state-fault",
  none: "text-muted-foreground",
} as const

export const TONE_HEX = { good: "#16a34a", warn: "#f59e0b", bad: "#dc2626", none: "#a1a1aa" } as const
