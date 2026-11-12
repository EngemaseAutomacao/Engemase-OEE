/**
 * Dados da equipe Engemase (console), montados a partir de `@/lib/mock`.
 * Atribuições de engenheiros de campo e concessões de suporte ainda não existem em lib/mock:
 * são DERIVADAS da atividade real dos mocks (auditoria e sessões de acesso remoto).
 * Usado SÓ por páginas (servidor). "Agora" = MOCK_NOW.
 */
import {
  getAuditLog,
  getClientById,
  getClientUsers,
  getClients,
  getCurrentUser,
  getGateways,
  getPlatformUsers,
  getRemoteAccessSessions,
  getUnits,
  nowMs,
  type PlatformRole,
  type UserStatus,
} from "@/lib/mock"
import { ago, date, dateTime } from "@/lib/format"
import { SUPPORT_MAX_HOURS } from "./labels"

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

export interface MemberRow {
  id: string
  name: string
  email: string
  role: PlatformRole
  status: UserStatus
  twoFactor: boolean
  lastLoginAt: string | null
  lastLoginAgo: string
  lastLoginLabel: string
  isMe: boolean
}

export interface AssignmentRow {
  id: string
  userId: string
  userName: string
  clientId: string
  clientName: string
  clientStatus: string
  units: string[] | "all"
  unitLabel: string
  validFrom: string
  validUntil: string
  validFromLabel: string
  validUntilLabel: string
  daysLeft: number
  reason: string
  createdBy: string
}

export interface GrantRow {
  id: string
  userId: string
  userName: string
  clientId: string
  clientName: string
  ticket: string
  reason: string
  startedAt: string
  endsAt: string
  endedAt: string | null
  startedLabel: string
  endsLabel: string
  active: boolean
  durationLabel: string
}

export interface TeamData {
  members: MemberRow[]
  assignments: AssignmentRow[]
  grants: GrantRow[]
  clients: { id: string; name: string; status: string; units: { id: string; name: string }[]; admins: string[] }[]
  meId: string
}

function unitLabel(clientId: string, unitIds: Set<string>): { units: string[] | "all"; label: string } {
  const all = getUnits(clientId)
  if (unitIds.size === 0 || all.every((u) => unitIds.has(u.id))) return { units: "all", label: all.length === 1 ? all[0]!.name : "Todas as unidades" }
  const names = all.filter((u) => unitIds.has(u.id)).map((u) => u.name)
  return { units: [...unitIds], label: names.join(", ") }
}

export function buildTeam(): TeamData {
  const me = getCurrentUser()
  const now = nowMs()
  const platform = getPlatformUsers()
  const superAdmin = platform.find((u) => u.platformRole === "super_admin")?.name ?? "Super admin"
  const sessions = getRemoteAccessSessions()
  const audit = getAuditLog()
  const gateways = getGateways()

  const members: MemberRow[] = platform.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email ?? "",
    role: u.platformRole!,
    status: u.status,
    twoFactor: u.twoFactor,
    lastLoginAt: u.lastLoginAt,
    lastLoginAgo: ago(u.lastLoginAt),
    lastLoginLabel: u.lastLoginAt ? dateTime(u.lastLoginAt) : "—",
    isMe: u.id === me.id,
  }))

  // Atribuições: clientes em que cada engenheiro de campo atuou (sessões de VPN e auditoria).
  const assignments: AssignmentRow[] = []
  for (const u of platform.filter((x) => x.platformRole === "field_engineer")) {
    const byClient = new Map<string, { first: number; units: Set<string> }>()
    const touch = (clientId: string, at: string, unitId?: string) => {
      const cur = byClient.get(clientId) ?? { first: Date.parse(at), units: new Set<string>() }
      cur.first = Math.min(cur.first, Date.parse(at))
      if (unitId) cur.units.add(unitId)
      byClient.set(clientId, cur)
    }
    for (const s of sessions.filter((s) => s.requestedBy === u.name)) touch(s.clientId, s.requestedAt, gateways.find((g) => g.id === s.gatewayId)?.unitId)
    for (const a of audit.filter((a) => a.actorName === u.name && a.clientId)) {
      touch(a.clientId!, a.at, a.entity === "gateway" ? gateways.find((g) => g.name === a.entityName)?.unitId : undefined)
    }
    for (const [clientId, info] of byClient) {
      const c = getClientById(clientId)
      if (!c) continue
      const onboarding = c.status === "onboarding"
      const from = onboarding ? Math.min(info.first, Date.parse(c.createdAt)) : info.first
      const until = from + (onboarding ? 60 : 120) * DAY
      const scope = unitLabel(clientId, info.units)
      assignments.push({
        id: `asg_${u.id}_${clientId}`,
        userId: u.id,
        userName: u.name,
        clientId,
        clientName: c.name,
        clientStatus: c.status,
        units: scope.units,
        unitLabel: scope.label,
        validFrom: new Date(from).toISOString(),
        validUntil: new Date(until).toISOString(),
        validFromLabel: date(new Date(from).toISOString()),
        validUntilLabel: date(new Date(until).toISOString()),
        daysLeft: Math.ceil((until - now) / DAY),
        reason: onboarding ? "Implantação: gateways, máquinas e tags" : "Configuração do cliente: gateways, máquinas, tags e cadastros",
        createdBy: superAdmin,
      })
    }
  }

  // Concessões de suporte: sessões de suporte em andamento (VPN ativa) e acessos registrados na auditoria.
  const grants: GrantRow[] = []
  for (const u of platform.filter((x) => x.platformRole === "support")) {
    for (const s of sessions.filter((s) => s.requestedBy === u.name && s.status === "active")) {
      const start = Date.parse(s.requestedAt)
      const end = start + SUPPORT_MAX_HOURS * HOUR
      grants.push({
        id: `grt_${s.id}`,
        userId: u.id,
        userName: u.name,
        clientId: s.clientId,
        clientName: getClientById(s.clientId)?.name ?? s.clientId,
        ticket: s.ticket,
        reason: s.reason,
        startedAt: s.requestedAt,
        endsAt: new Date(end).toISOString(),
        endedAt: null,
        startedLabel: dateTime(s.requestedAt),
        endsLabel: dateTime(new Date(end).toISOString()),
        active: end > now,
        durationLabel: `${SUPPORT_MAX_HOURS} h`,
      })
    }
    for (const a of audit.filter((a) => a.actorName === u.name && a.action.startsWith("support.") && a.clientId)) {
      const minutes = Number(a.details?.match(/(\d+)\s*min/)?.[1] ?? 30)
      const ticket = a.details?.match(/#\d+/)?.[0] ?? "—"
      const end = Date.parse(a.at) + minutes * 60 * 1000
      grants.push({
        id: `grt_${a.id}`,
        userId: u.id,
        userName: u.name,
        clientId: a.clientId!,
        clientName: getClientById(a.clientId!)?.name ?? a.clientId!,
        ticket,
        reason: a.details ?? "Sessão de suporte",
        startedAt: a.at,
        endsAt: new Date(end).toISOString(),
        endedAt: new Date(end).toISOString(),
        startedLabel: dateTime(a.at),
        endsLabel: dateTime(new Date(end).toISOString()),
        active: false,
        durationLabel: `${minutes} min`,
      })
    }
  }
  grants.sort((a, b) => b.startedAt.localeCompare(a.startedAt))

  return {
    members,
    assignments,
    grants,
    clients: getClients().map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      units: getUnits(c.id).map((u) => ({ id: u.id, name: u.name })),
      admins: getClientUsers(c.id)
        .filter((u) => u.memberships.some((m) => m.clientId === c.id && m.role === "client_admin"))
        .map((u) => u.name),
    })),
    meId: me.id,
  }
}
