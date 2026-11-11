import type { LucideIcon } from "lucide-react"
import {
  CalendarClockIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  OctagonAlertIcon,
  RefreshCwIcon,
  WifiOffIcon,
} from "lucide-react"

import type { MachineState, ReasonCategory } from "@/lib/mock"

/**
 * Cor do texto sobre um fundo sólido de estado (bg-state-*), escolhida pelo contraste:
 * cores claras (verde, âmbar, violeta, ardósia) pedem texto escuro; vermelho pede branco.
 */
export const STATE_ON: Record<MachineState, string> = {
  RUNNING: "text-zinc-950",
  STOPPED: "text-zinc-950",
  FAULT: "text-white",
  SETUP: "text-zinc-950",
  PLANNED_STOP: "text-zinc-950",
  NO_COMM: "text-zinc-950 dark:text-white",
}

export const STATE_ICON: Record<MachineState, LucideIcon> = {
  RUNNING: CirclePlayIcon,
  STOPPED: CirclePauseIcon,
  FAULT: OctagonAlertIcon,
  SETUP: RefreshCwIcon,
  PLANNED_STOP: CalendarClockIcon,
  NO_COMM: WifiOffIcon,
}

/** Categoria de motivo → estado com a mesma cor (para colorir os botões de motivo). */
export const CATEGORY_STATE: Record<ReasonCategory, MachineState> = {
  unplanned: "STOPPED",
  setup: "SETUP",
  planned: "PLANNED_STOP",
}

export const CATEGORY_LABEL: Record<ReasonCategory, string> = {
  unplanned: "Não planejada",
  setup: "Setup",
  planned: "Planejada",
}

/** Botões de motivo: fundo suave + borda na cor da categoria (mesmas cores dos estados). */
export const CATEGORY_BUTTON: Record<ReasonCategory, string> = {
  unplanned: "border-state-stopped/60 bg-state-stopped/12 hover:bg-state-stopped/22",
  setup: "border-state-setup/60 bg-state-setup/12 hover:bg-state-setup/22",
  planned: "border-state-planned/60 bg-state-planned/12 hover:bg-state-planned/22",
}
