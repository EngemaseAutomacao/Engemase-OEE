/** Ícones, cores e rótulos da central de ajuda (usados por componentes de cliente). */
import {
  BellRingIcon,
  CpuIcon,
  FactoryIcon,
  GaugeIcon,
  RocketIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react"

import type { IconTone } from "@/components/dashboard/icon-circle"
import type { HelpCategoryId, TicketPriority, TicketVM } from "./help-types"

export const CATEGORY_META: Record<HelpCategoryId, { icon: LucideIcon; tone: IconTone; description: string }> = {
  "primeiros-passos": { icon: RocketIcon, tone: "blue", description: "Conheça as telas e comece a usar" },
  oee: { icon: GaugeIcon, tone: "teal", description: "Cálculo, perdas e como ler os números" },
  "chao-de-fabrica": { icon: FactoryIcon, tone: "orange", description: "Tablet do operador e TV Andon" },
  "gateways-modbus": { icon: CpuIcon, tone: "navy", description: "CLPs, Modbus TCP/RTU e gateways" },
  administracao: { icon: ShieldCheckIcon, tone: "violet", description: "Usuários, unidades e acesso remoto" },
  notificacoes: { icon: BellRingIcon, tone: "amber", description: "Alertas no celular e no computador" },
}

export const PRIORITY_META: Record<TicketPriority, { label: string; hint: string; className: string }> = {
  low: { label: "Baixa", hint: "Dúvida ou sugestão de melhoria", className: "bg-muted text-muted-foreground" },
  normal: { label: "Normal", hint: "Algo não funciona como esperado", className: "bg-[#257bb4]/12 text-[#257bb4] dark:text-[#4a9fd6]" },
  high: { label: "Alta", hint: "Afeta a produção ou os dados de uma linha", className: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped" },
  critical: { label: "Crítica", hint: "Máquinas ou unidade sem dados agora", className: "bg-state-fault/12 text-state-fault" },
}

export const TICKET_STATUS_META: Record<TicketVM["status"], { label: string; className: string }> = {
  open: { label: "Aberto", className: "bg-[#257bb4]/12 text-[#257bb4] dark:text-[#4a9fd6]" },
  in_progress: { label: "Em atendimento", className: "bg-[#0e9384]/12 text-[#0e9384]" },
  waiting: { label: "Aguardando você", className: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped" },
  resolved: { label: "Resolvido", className: "bg-muted text-muted-foreground" },
}
