import type { ClientPlan, ClientRole, ClientStatus, GatewayStatus, MemberScope, MemberScopeKind, PlatformRole, UserStatus } from "@/lib/mock/types"

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

/**
 * O que cada papel do cliente faz (decisões D12 e D13). A configuração (unidades, linhas, máquinas,
 * gateways, tags, terminais, turnos, produtos, motivos e aparência) é feita só pela equipe Engemase.
 */
export const CLIENT_ROLE_DESCRIPTION: Record<ClientRole, string> = {
  client_admin: "Gerencia os usuários do cliente (convites, papéis, escopos) e vê tudo, só leitura na configuração",
  engineer: "Leitura técnica: saúde dos gateways, conexões com os CLPs e tags, sem editar",
  supervisor: "Dashboards e relatórios; classifica paradas, lança refugo e troca de produto",
  operator: "Tela do operador: classifica paradas, lança refugo e troca de produto",
  viewer: "Somente leitura: dashboards e relatórios do seu escopo",
}

/** Escopo do vínculo (D11): todo o cliente, unidades ou máquinas. */
export const SCOPE_KIND_LABEL: Record<MemberScopeKind, string> = {
  all: "Todo o cliente",
  units: "Unidades",
  machines: "Máquinas",
}

/**
 * Resumo curto do escopo para listas: "Todo o cliente", "Unidade Joinville", "2 unidades", "3 máquinas".
 * Fail-closed: lista vazia aparece como "Nenhuma unidade" / "Nenhuma máquina".
 */
export function scopeSummary(scope: MemberScope, unitName?: (id: string) => string | undefined): string {
  if (scope.kind === "all") return SCOPE_KIND_LABEL.all
  if (scope.kind === "units") {
    const n = scope.unitIds.length
    if (n === 0) return "Nenhuma unidade"
    if (n === 1 && unitName) return unitName(scope.unitIds[0]!) ?? "1 unidade"
    return `${n} unidades`
  }
  const n = scope.machineIds.length
  return n === 0 ? "Nenhuma máquina" : n === 1 ? "1 máquina" : `${n} máquinas`
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
