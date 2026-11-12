/**
 * Dados simulados da 2ª rodada: notificações/alertas, acesso remoto (VPN), terminais,
 * central de ajuda e identidade visual por cliente. Tudo fictício.
 */

// ---------------------------------------------------------------------------
// Notificações / alertas
// ---------------------------------------------------------------------------
export type AlertSeverity = "critical" | "warning" | "info"
export type AlertType =
  | "machine_fault"
  | "machine_stopped"
  | "gateway_offline"
  | "machine_no_comm"
  | "oee_below_target"
  | "unclassified_stops"
  | "remote_access_request"
  | "remote_access_session"

export interface AppNotification {
  id: string
  clientId: string
  unitId: string | null
  type: AlertType
  severity: AlertSeverity
  title: string
  body: string
  href: string
  at: string
  read: boolean
  status: "open" | "acknowledged" | "resolved"
  acknowledgedBy?: string
}

export const notifications: AppNotification[] = [
  { id: "ntf_01", clientId: "cli_plastiform", unitId: "uni_jlle", type: "machine_stopped", severity: "warning", title: "Injetora 03 parada há 14 min", body: "Parada não planejada sem motivo informado · Linha Injeção A", href: "/plastiform/maquinas/mch_inj03", at: "2026-11-11T13:38:00.000Z", read: false, status: "open" },
  { id: "ntf_02", clientId: "cli_plastiform", unitId: "uni_jlle", type: "machine_no_comm", severity: "warning", title: "Injetora 04 sem comunicação", body: "Timeout no CLP (Modbus TCP 192.168.10.24) há 37 min", href: "/plastiform/maquinas/mch_inj04", at: "2026-11-11T13:10:00.000Z", read: false, status: "open" },
  { id: "ntf_03", clientId: "cli_plastiform", unitId: "uni_ctba", type: "gateway_offline", severity: "critical", title: "Gateway GW Curitiba offline", body: "Sem contato há 44 min · 2.184 registros aguardando no buffer do gateway", href: "/plastiform/config/gateways/gw_ctba01", at: "2026-11-11T13:03:00.000Z", read: false, status: "acknowledged", acknowledgedBy: "Pedro Alves" },
  { id: "ntf_04", clientId: "cli_plastiform", unitId: "uni_jlle", type: "unclassified_stops", severity: "info", title: "5 paradas sem motivo no 1º turno", body: "Linha Injeção A e Linha Sopro", href: "/plastiform/operador/mch_inj03", at: "2026-11-11T12:30:00.000Z", read: true, status: "open" },
  { id: "ntf_05", clientId: "cli_plastiform", unitId: "uni_jlle", type: "oee_below_target", severity: "warning", title: "OEE da Linha Injeção A abaixo da meta", body: "68,2% no turno até agora (meta 75%)", href: "/plastiform/relatorios/oee", at: "2026-11-11T11:00:00.000Z", read: true, status: "resolved" },
  { id: "ntf_06", clientId: "cli_plastiform", unitId: "uni_jlle", type: "remote_access_request", severity: "info", title: "Engemase pediu acesso remoto ao GW Joinville Sopro", body: "Diego Souza · chamado #1057 · 1 h · aguardando sua aprovação", href: "/plastiform/acesso-remoto", at: "2026-11-11T13:20:00.000Z", read: false, status: "open" },
  { id: "ntf_07", clientId: "cli_serra", unitId: "uni_caxias", type: "machine_fault", severity: "critical", title: "Prensa 02 em falha", body: "58 · Sobrecarga do motor principal", href: "/serra-azul/maquinas/mch_pre02", at: "2026-11-11T13:35:00.000Z", read: false, status: "open" },
  { id: "ntf_08", clientId: "cli_serra", unitId: "uni_caxias", type: "machine_no_comm", severity: "warning", title: "Prensa 03 sem comunicação", body: "CRC inválido na resposta (RS-485)", href: "/serra-azul/maquinas/mch_pre03", at: "2026-11-11T13:23:00.000Z", read: false, status: "open" },
]

// ---------------------------------------------------------------------------
// Acesso remoto (VPN de manutenção) — docs/12
// ---------------------------------------------------------------------------
export type RemoteAccessStatus =
  | "requested"
  | "approved"
  | "active"
  | "ended"
  | "rejected"
  | "expired_unapproved"
  | "revoked"

export interface RemoteAccessSession {
  id: string
  clientId: string
  gatewayId: string
  requestedBy: string
  reason: string
  ticket: string
  durationMin: number
  scope: { ssh: boolean; plcForward?: { deviceId: string; port: number } }
  status: RemoteAccessStatus
  requestedAt: string
  approvedBy?: string
  approvedAt?: string
  startedAt?: string
  expiresAt?: string
  endedAt?: string
  endedReason?: string
  connection?: "direct" | "relay"
  bytes?: number
}

export const remoteAccessSessions: RemoteAccessSession[] = [
  { id: "ras_07", clientId: "cli_plastiform", gatewayId: "gw_jlle02", requestedBy: "Diego Souza", reason: "Ajustar parâmetros do barramento RS-485 (CRC intermitente)", ticket: "#1057", durationMin: 60, scope: { ssh: true }, status: "requested", requestedAt: "2026-11-11T13:20:00.000Z" },
  { id: "ras_06", clientId: "cli_serra", gatewayId: "gw_cx01", requestedBy: "Carlos Mendes", reason: "Relógio do gateway com desvio de 2,5 s; verificar chrony", ticket: "#1052", durationMin: 120, scope: { ssh: true }, status: "active", requestedAt: "2026-11-11T12:40:00.000Z", approvedBy: "Renata Faria", approvedAt: "2026-11-11T12:46:00.000Z", startedAt: "2026-11-11T12:47:00.000Z", expiresAt: "2026-11-11T14:47:00.000Z", connection: "relay" },
  { id: "ras_05", clientId: "cli_plastiform", gatewayId: "gw_jlle01", requestedBy: "Diego Souza", reason: "Atualização assistida do agente para 1.2.0", ticket: "#1031", durationMin: 60, scope: { ssh: true }, status: "ended", requestedAt: "2026-11-04T17:00:00.000Z", approvedBy: "Marcos Lima", approvedAt: "2026-11-04T17:05:00.000Z", startedAt: "2026-11-04T17:06:00.000Z", expiresAt: "2026-11-04T18:06:00.000Z", endedAt: "2026-11-04T17:41:00.000Z", endedReason: "Encerrada pelo técnico", connection: "direct", bytes: 4_812_000 },
  { id: "ras_04", clientId: "cli_plastiform", gatewayId: "gw_jlle01", requestedBy: "Carlos Mendes", reason: "Suporte ao CLP da Injetora 04 (ajuste de mapa Modbus)", ticket: "#1019", durationMin: 30, scope: { ssh: true, plcForward: { deviceId: "dev_inj04", port: 502 } }, status: "ended", requestedAt: "2026-10-28T13:10:00.000Z", approvedBy: "Marcos Lima", approvedAt: "2026-10-28T13:15:00.000Z", startedAt: "2026-10-28T13:16:00.000Z", expiresAt: "2026-10-28T13:46:00.000Z", endedAt: "2026-10-28T13:46:00.000Z", endedReason: "Prazo encerrado", connection: "relay", bytes: 1_204_000 },
  { id: "ras_03", clientId: "cli_plastiform", gatewayId: "gw_ctba01", requestedBy: "Diego Souza", reason: "Diagnóstico de queda de rede", ticket: "#1004", durationMin: 60, scope: { ssh: true }, status: "rejected", requestedAt: "2026-10-20T19:00:00.000Z", approvedBy: "Marcos Lima", approvedAt: "2026-10-20T19:20:00.000Z", endedReason: "Recusado: fora do horário combinado com a TI" },
]

export interface RemoteAccessPolicy {
  clientId: string
  mode: "disabled" | "approval_required" | "preapproved_window"
  approverRoles: string[]
  maxDurationMin: number
  idleTimeoutMin: number
  allowPlcForward: boolean
  requireOnsiteContact: boolean
  windows: { day: number; start: string; end: string }[]
}

export const remoteAccessPolicies: RemoteAccessPolicy[] = [
  { clientId: "cli_plastiform", mode: "approval_required", approverRoles: ["client_admin"], maxDurationMin: 240, idleTimeoutMin: 15, allowPlcForward: true, requireOnsiteContact: true, windows: [] },
  { clientId: "cli_serra", mode: "approval_required", approverRoles: ["client_admin"], maxDurationMin: 120, idleTimeoutMin: 15, allowPlcForward: false, requireOnsiteContact: false, windows: [] },
  { clientId: "cli_bomsabor", mode: "preapproved_window", approverRoles: ["client_admin"], maxDurationMin: 240, idleTimeoutMin: 20, allowPlcForward: false, requireOnsiteContact: true, windows: [{ day: 6, start: "08:00", end: "12:00" }] },
  { clientId: "cli_valeverde", mode: "disabled", approverRoles: ["client_admin"], maxDurationMin: 60, idleTimeoutMin: 15, allowPlcForward: false, requireOnsiteContact: true, windows: [] },
]

// ---------------------------------------------------------------------------
// Terminais pareados (TV Andon e tablets) — docs/15
// ---------------------------------------------------------------------------
export interface Terminal {
  id: string
  clientId: string
  unitId: string
  name: string
  kind: "andon_tv" | "operator_tablet"
  scope: { lineIds?: string[]; machineIds?: string[] }
  theme: "dark" | "light" | "system"
  status: "online" | "offline" | "pending"
  pairedBy: string | null
  pairedAt: string | null
  lastSeen: string | null
  pairingCode?: string
}

export const terminals: Terminal[] = [
  { id: "trm_01", clientId: "cli_plastiform", unitId: "uni_jlle", name: "TV Linha Injeção A", kind: "andon_tv", scope: { lineIds: ["lin_injA"] }, theme: "dark", status: "online", pairedBy: "Pedro Alves", pairedAt: "2026-09-12T12:00:00.000Z", lastSeen: "2026-11-11T13:41:57.000Z" },
  { id: "trm_02", clientId: "cli_plastiform", unitId: "uni_jlle", name: "Tablet Injetoras 01–02", kind: "operator_tablet", scope: { machineIds: ["mch_inj01", "mch_inj02"] }, theme: "system", status: "online", pairedBy: "Pedro Alves", pairedAt: "2026-09-12T12:30:00.000Z", lastSeen: "2026-11-11T13:41:40.000Z" },
  { id: "trm_03", clientId: "cli_plastiform", unitId: "uni_jlle", name: "Tablet Injetoras 03–04", kind: "operator_tablet", scope: { machineIds: ["mch_inj03", "mch_inj04"] }, theme: "system", status: "offline", pairedBy: "Pedro Alves", pairedAt: "2026-09-12T12:40:00.000Z", lastSeen: "2026-11-10T22:05:00.000Z" },
  { id: "trm_04", clientId: "cli_plastiform", unitId: "uni_ctba", name: "TV Linha Injeção B", kind: "andon_tv", scope: { lineIds: ["lin_injB"] }, theme: "dark", status: "pending", pairedBy: null, pairedAt: null, lastSeen: null, pairingCode: "482 917" },
  { id: "trm_05", clientId: "cli_serra", unitId: "uni_caxias", name: "TV Estamparia", kind: "andon_tv", scope: { lineIds: ["lin_estamp"] }, theme: "dark", status: "online", pairedBy: "Renata Faria", pairedAt: "2026-07-01T12:00:00.000Z", lastSeen: "2026-11-11T13:41:59.000Z" },
]

// ---------------------------------------------------------------------------
// Central de ajuda
// ---------------------------------------------------------------------------
export interface HelpArticle {
  slug: string
  category: "primeiros-passos" | "oee" | "chao-de-fabrica" | "gateways-modbus" | "administracao" | "notificacoes"
  title: string
  summary: string
  minutes: number
  audience: string
}

export const helpCategories: Record<HelpArticle["category"], string> = {
  "primeiros-passos": "Primeiros passos",
  oee: "Entendendo o OEE",
  "chao-de-fabrica": "Chão de fábrica",
  "gateways-modbus": "Gateways e Modbus",
  administracao: "Administração e acessos",
  notificacoes: "Notificações e alertas",
}

export const helpArticles: HelpArticle[] = [
  { slug: "tour-da-plataforma", category: "primeiros-passos", title: "Tour pela plataforma em 5 minutos", summary: "Visão geral, máquinas, relatórios e configurações.", minutes: 5, audience: "Todos" },
  { slug: "o-que-e-oee", category: "oee", title: "O que é OEE (Disponibilidade × Performance × Qualidade)", summary: "Como o indicador é calculado, com um exemplo de turno.", minutes: 6, audience: "Todos" },
  { slug: "micro-paradas", category: "oee", title: "Micro-paradas e paradas planejadas", summary: "Por que paradas curtas reduzem a performance, não a disponibilidade.", minutes: 4, audience: "Supervisores" },
  { slug: "classificar-paradas", category: "chao-de-fabrica", title: "Como classificar paradas no tablet", summary: "Passo a passo para o operador apontar o motivo de uma parada.", minutes: 3, audience: "Operadores" },
  { slug: "andon-tv", category: "chao-de-fabrica", title: "TV Andon de uma linha", summary: "Como a TV é pareada por código pela Engemase, com a linha e o tema que você escolher.", minutes: 3, audience: "Supervisores" },
  { slug: "ligar-clp-modbus-tcp", category: "gateways-modbus", title: "Ligar um CLP por Modbus TCP", summary: "O que preparar no CLP e na rede antes de a Engemase ligar a máquina.", minutes: 7, audience: "Engenheiros" },
  { slug: "barramento-rs485", category: "gateways-modbus", title: "Barramento RS-485 (Modbus RTU) sem dor de cabeça", summary: "Cascata, terminação de 120 Ω, polarização, comum e mestre único.", minutes: 8, audience: "Engenheiros" },
  { slug: "bloco-oee-padrao", category: "gateways-modbus", title: "Bloco OEE padrão Engemase", summary: "Mapa de 32 registradores para padronizar a leitura de qualquer CLP.", minutes: 6, audience: "Engenheiros" },
  { slug: "enderecos-modbus", category: "gateways-modbus", title: "Endereços Modbus: base 0, 40001 e ordem das words", summary: "Os erros mais comuns de integração e como evitá-los.", minutes: 5, audience: "Engenheiros" },
  { slug: "gateway-offline", category: "gateways-modbus", title: "Gateway offline: o que verificar", summary: "Energia, rede, proxy, relógio e token — e por que nenhum dado se perde.", minutes: 4, audience: "Engenheiros" },
  { slug: "usuarios-e-escopo", category: "administracao", title: "Usuários, papéis e escopo", summary: "Quem vê o quê e como dar acesso só a algumas unidades ou máquinas.", minutes: 5, audience: "Administradores" },
  { slug: "acesso-remoto", category: "administracao", title: "Acesso remoto da Engemase (VPN)", summary: "Como aprovar, acompanhar e encerrar uma sessão de manutenção.", minutes: 4, audience: "Administradores" },
  { slug: "ativar-push", category: "notificacoes", title: "Ativar notificações no celular e no computador", summary: "Android, iPhone (instalar na Tela de Início) e navegador.", minutes: 3, audience: "Todos" },
  { slug: "regras-de-alerta", category: "notificacoes", title: "Regras de alerta e horário de silêncio", summary: "Escolha o que receber, de quais máquinas e quando.", minutes: 4, audience: "Supervisores" },
]

export const helpFaq: { q: string; a: string }[] = [
  { q: "A internet da fábrica caiu. Perdi dados?", a: "Não. O gateway guarda os dados localmente por dias e reenvia tudo em ordem quando a conexão volta. Durante a queda, as telas mostram o selo \"dados atrasados\"." },
  { q: "Por que o OEE do turno mudou depois que o turno acabou?", a: "Paradas classificadas depois, refugo lançado manualmente ou dados que chegaram atrasados fazem o turno ser recalculado automaticamente." },
  { q: "A performance passou de 100%. É erro?", a: "Quase sempre o tempo de ciclo ideal cadastrado está maior que o real. Abra um chamado para a Engemase revisar o ciclo ideal do produto nessa máquina." },
  { q: "Posso ver máquinas de outra unidade?", a: "Só se o admin do cliente liberar essa unidade (ou essas máquinas) para você, em Configurações › Usuários." },
  { q: "Quem cadastra máquinas, turnos e motivos de parada?", a: "A equipe Engemase. Você consulta tudo em Configurações e pede mudanças por chamado. O admin do cliente cuida dos usuários." },
  { q: "A Engemase consegue acessar nossos dados?", a: "Sim. A Engemase administra a plataforma e configura a sua conta, por isso sempre tem acesso, com faixa na tela e registro visível na Auditoria. O acesso remoto aos gateways (VPN) é outra coisa: só acontece com aprovação do admin do cliente." },
  { q: "O iPhone não recebe notificações. O que fazer?", a: "No iPhone/iPad, abra a plataforma no Safari, toque em Compartilhar › Adicionar à Tela de Início, abra pelo ícone e ative as notificações." },
]

// ---------------------------------------------------------------------------
// Identidade visual por cliente — docs/14
// ---------------------------------------------------------------------------
export interface ClientBranding {
  clientId: string
  displayName: string
  preset: string | null
  brandColor: string
  sidebarMode: "neutral" | "brand-dark" | "light"
  /** Tokens já calculados (no real: algoritmo OKLCH + contraste no servidor). */
  tokens: { light: { primary: string; ring: string; sidebar: string }; dark: { primary: string; ring: string; sidebar: string } }
  adjusted: boolean
}

/** Paletas prontas (validadas contra as cores de estado). */
export const brandPresets: { name: string; hex: string }[] = [
  { name: "Azul Engemase", hex: "#257BB4" },
  { name: "Azul-marinho", hex: "#1E3A8A" },
  { name: "Índigo", hex: "#4338CA" },
  { name: "Azul-céu", hex: "#0369A1" },
  { name: "Petróleo", hex: "#0E7490" },
  { name: "Teal", hex: "#0F766E" },
  { name: "Grafite", hex: "#334155" },
  { name: "Roxo", hex: "#6B21A8" },
]

export const clientBrandings: ClientBranding[] = [
  // Plastiform usa o padrão Engemase (sem registro = padrão)
  {
    clientId: "cli_serra",
    displayName: "Serra Azul OEE",
    preset: "Petróleo",
    brandColor: "#0E7490",
    sidebarMode: "brand-dark",
    tokens: {
      light: { primary: "#0e7490", ring: "#0e7490", sidebar: "#123a44" },
      dark: { primary: "#38b2cf", ring: "#38b2cf", sidebar: "#0f2a32" },
    },
    adjusted: false,
  },
]
