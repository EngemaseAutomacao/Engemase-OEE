import type { LucideIcon } from "lucide-react"
import {
  AlertOctagonIcon,
  ClipboardListIcon,
  KeyRoundIcon,
  PauseCircleIcon,
  RouterIcon,
  ServerCogIcon,
  ShieldCheckIcon,
  TrendingDownIcon,
  UnplugIcon,
} from "lucide-react"

import type { AlertSeverity, AlertType } from "@/lib/mock"
import type { IconTone } from "@/components/dashboard/icon-circle"

/** Tipos de alerta mostrados nas preferências (inclui o operacional da equipe Engemase). */
export type PrefAlertType = AlertType | "engemase_ops"

export type Channel = "push" | "email" | "whatsapp"

export const ALERT_TYPE_META: Record<
  PrefAlertType,
  { label: string; description: string; rule: string; severity: AlertSeverity; icon: LucideIcon; platformOnly?: boolean }
> = {
  machine_fault: {
    label: "Falha de máquina",
    description: "Máquina em falha, com o código lido do CLP",
    rule: "Imediato · crítico",
    severity: "critical",
    icon: AlertOctagonIcon,
  },
  machine_stopped: {
    label: "Máquina parada",
    description: "Parada não planejada que passa do tempo limite",
    rule: "Após 10 min · aviso",
    severity: "warning",
    icon: PauseCircleIcon,
  },
  machine_no_comm: {
    label: "Sem comunicação",
    description: "Máquina sem dados do CLP (suprimido se o gateway estiver offline)",
    rule: "Após 5 min · aviso",
    severity: "warning",
    icon: UnplugIcon,
  },
  gateway_offline: {
    label: "Gateway offline",
    description: "Gateway sem contato com a nuvem; os dados ficam no buffer local",
    rule: "Após 5 min · crítico",
    severity: "critical",
    icon: RouterIcon,
  },
  oee_below_target: {
    label: "OEE abaixo da meta",
    description: "OEE do turno abaixo da meta da linha ou máquina",
    rule: "Após 2 h de turno · 1 por turno",
    severity: "warning",
    icon: TrendingDownIcon,
  },
  unclassified_stops: {
    label: "Paradas sem motivo",
    description: "Paradas acima do limite de micro-parada sem motivo informado",
    rule: "Após 30 min · agrupado por linha",
    severity: "info",
    icon: ClipboardListIcon,
  },
  remote_access_request: {
    label: "Pedido de acesso remoto",
    description: "A Engemase pediu acesso de manutenção (VPN) a um gateway",
    rule: "Na hora · aguarda aprovação",
    severity: "info",
    icon: KeyRoundIcon,
  },
  remote_access_session: {
    label: "Sessão de acesso remoto",
    description: "Sessão de manutenção iniciada, encerrada ou expirada",
    rule: "Na hora · informativo",
    severity: "info",
    icon: ShieldCheckIcon,
  },
  engemase_ops: {
    label: "Operacionais Engemase",
    description: "Buffer do gateway acima de 80%, relógio com desvio > 2 s, ingestão ou rotina agendada falhando",
    rule: "Na hora · só equipe Engemase",
    severity: "warning",
    icon: ServerCogIcon,
    platformOnly: true,
  },
}

export const PREF_ALERT_TYPES = Object.keys(ALERT_TYPE_META) as PrefAlertType[]

/** Canais padrão sugeridos por tipo (a central no app é sempre ligada). */
export const DEFAULT_CHANNELS: Record<PrefAlertType, Record<Channel, boolean>> = {
  machine_fault: { push: true, email: true, whatsapp: false },
  machine_stopped: { push: true, email: false, whatsapp: false },
  machine_no_comm: { push: true, email: false, whatsapp: false },
  gateway_offline: { push: true, email: true, whatsapp: false },
  oee_below_target: { push: false, email: true, whatsapp: false },
  unclassified_stops: { push: false, email: false, whatsapp: false },
  remote_access_request: { push: true, email: true, whatsapp: false },
  remote_access_session: { push: false, email: true, whatsapp: false },
  engemase_ops: { push: true, email: false, whatsapp: false },
}

export const SEVERITY_META: Record<AlertSeverity, { label: string; tone: IconTone; badge: string; dot: string }> = {
  critical: {
    label: "Crítico",
    tone: "red",
    badge: "bg-state-fault/12 text-state-fault",
    dot: "bg-state-fault",
  },
  warning: {
    label: "Aviso",
    tone: "amber",
    badge: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
    dot: "bg-state-stopped",
  },
  info: {
    label: "Informativo",
    tone: "blue",
    badge: "bg-primary/10 text-primary",
    dot: "bg-primary",
  },
}

export type AlertStatus = "open" | "acknowledged" | "resolved"

export const STATUS_META: Record<AlertStatus, { label: string; badge: string }> = {
  open: { label: "Aberto", badge: "bg-[#e96549]/12 text-[#cf5539]" },
  acknowledged: { label: "Reconhecido", badge: "bg-[#2c4e73]/10 text-[#2c4e73] dark:bg-white/10 dark:text-[#9cc3e6]" },
  resolved: { label: "Resolvido", badge: "bg-state-running/12 text-state-running" },
}

export function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`
}
