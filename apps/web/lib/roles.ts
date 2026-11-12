import type { ClientPlan, ClientRole, ClientStatus, GatewayStatus, PlatformRole, UserStatus } from "@/lib/mock/types"

export const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = {
  super_admin: "Super admin",
  support: "Suporte",
  field_engineer: "Engenheiro de campo",
}

export const CLIENT_ROLE_LABEL: Record<ClientRole, string> = {
  client_admin: "Admin do cliente",
  engineer: "Engenheiro",
  supervisor: "Supervisor",
  operator: "Operador",
  viewer: "Visualizador",
}

export const CLIENT_ROLE_DESCRIPTION: Record<ClientRole, string> = {
  client_admin: "Gerencia unidades, máquinas, usuários e configurações do cliente",
  engineer: "Configura gateways, CLPs e tags; vê tudo das unidades permitidas",
  supervisor: "Dashboards, relatórios, turnos, produtos e motivos de parada",
  operator: "Tela do operador: classifica paradas, lança refugo e troca de produto",
  viewer: "Somente leitura: dashboards e relatórios das unidades permitidas",
}

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  active: "Ativo",
  onboarding: "Implantação",
  suspended: "Suspenso",
}

export const PLAN_LABEL: Record<ClientPlan, string> = { starter: "Starter", pro: "Pro", enterprise: "Enterprise" }

export const GATEWAY_STATUS_LABEL: Record<GatewayStatus, string> = {
  online: "Online",
  degraded: "Com alertas",
  offline: "Offline",
  pending: "Aguardando ativação",
}

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  active: "Ativo",
  invited: "Aguardando definir senha",
  disabled: "Desativado",
}
