/**
 * Quem pode o quê dentro de um cliente (docs/15, seções 2 e 3; decisões D12 e D13 de 12/11/2026).
 *
 * O banco isola por cliente (RLS); o que cada papel faz dentro do cliente é regra daqui. Tudo é
 * lista fechada: permissão que não está na tabela não existe (fail-closed).
 *
 * - Admin do cliente: gerencia os USUÁRIOS do cliente (D12), aprova acesso remoto, vê tudo
 *   (configuração só leitura, auditoria) e faz as ações do chão.
 * - Engenheiro do cliente: leitura técnica (gateways, conexões, tags), sem editar (D13).
 * - Supervisor: dashboards, relatórios e ações do chão. Operador: ações do chão. Visualizador: leitura.
 * - Equipe Engemase: toda a configuração do cliente é dela (D12/D13) — o super admin e o técnico
 *   (com atribuição ou concessão de suporte ativa) editam e rodam diagnóstico. Ninguém da Engemase mexe
 *   nos usuários do cliente, exceto o super admin (cria o primeiro admin). Ações do chão são do cliente.
 */
import type { ClientRole, PlatformRole } from "@engemase/db"

export const PERMISSIONS = [
  /** Dashboards, máquinas, linhas e relatórios (sempre dentro do escopo). */
  "data.read",
  /** Ações do chão: classificar paradas, lançar refugo, trocar produto. */
  "floor.act",
  /** Leitura técnica: saúde de gateways, conexões Modbus, tags. */
  "technical.read",
  /** Ver a configuração do cliente (unidades, linhas, máquinas, turnos, produtos, motivos...). */
  "config.read",
  /** Editar a configuração do cliente (só a Engemase, D12/D13). */
  "config.write",
  /** Convidar, mudar papel/escopo e desativar usuários do cliente (admin do cliente, D12). */
  "users.manage",
  /** Ver a auditoria do cliente. */
  "audit.read",
  /** Aprovar sessão de acesso remoto ao gateway (docs/12, D20). */
  "remote_access.approve",
  /** Comandos de diagnóstico no gateway. */
  "diagnostics.run",
] as const
export type Permission = (typeof PERMISSIONS)[number]

const CLIENT_ROLE_PERMISSIONS: Record<ClientRole, readonly Permission[]> = {
  client_admin: [
    "data.read",
    "floor.act",
    "technical.read",
    "config.read",
    "users.manage",
    "audit.read",
    "remote_access.approve",
  ],
  engineer: ["data.read", "floor.act", "technical.read", "config.read"],
  supervisor: ["data.read", "floor.act"],
  operator: ["data.read", "floor.act"],
  viewer: ["data.read"],
}

const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly Permission[]> = {
  super_admin: [
    "data.read",
    "technical.read",
    "config.read",
    "config.write",
    "users.manage",
    "audit.read",
    "diagnostics.run",
  ],
  technician: ["data.read", "technical.read", "config.read", "config.write", "audit.read", "diagnostics.run"],
}

export function clientRolePermissions(role: ClientRole): ReadonlySet<Permission> {
  return new Set(CLIENT_ROLE_PERMISSIONS[role] ?? [])
}

export function platformRolePermissions(role: PlatformRole): ReadonlySet<Permission> {
  return new Set(PLATFORM_ROLE_PERMISSIONS[role] ?? [])
}
