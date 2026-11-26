/**
 * Acesso remoto (VPN de manutenção, docs/12) de todos os clientes, montado a partir de `@/lib/mock`.
 * Usado SÓ por páginas (servidor). Devolve objetos serializáveis; "agora" = r.agoraIso().
 */
import {
  type GatewayStatus,
  type Protocol,
  type RemoteAccessPolicy,
  type RemoteAccessSession,
} from "@/lib/mock"
import { repositorioMock, type Repositorio } from "@/lib/data/admin/repositorio"
import { dateTime, duration, time } from "@/lib/format"
import { PLATFORM_ROLE_LABEL } from "@/lib/roles"
import { bytesLabel, type SessionStatus } from "./labels"

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"]

export interface SessionRow {
  id: string
  clientId: string
  clientName: string
  gatewayId: string
  gatewayName: string
  hostname: string
  unitName: string
  gatewayStatus: GatewayStatus
  requestedBy: string
  requestedByRole: string
  reason: string
  ticket: string
  durationMin: number
  ssh: boolean
  plc: { deviceName: string; target: string } | null
  onsiteContact: string | null
  status: SessionStatus
  requestedAt: string
  requestedLabel: string
  approvedBy: string | null
  approvedLabel: string | null
  startedAt: string | null
  expiresAt: string | null
  endedAt: string | null
  endedLabel: string | null
  endedReason: string | null
  realDuration: string | null
  connection: "direct" | "relay" | null
  bytes: string | null
  approvers: string[]
}

export interface PolicyRow {
  clientId: string
  clientName: string
  clientStatus: string
  mode: RemoteAccessPolicy["mode"]
  maxDurationMin: number
  idleTimeoutMin: number
  allowPlcForward: boolean
  requireOnsiteContact: boolean
  windows: string[]
  approvers: string[]
}

export interface RequestTarget {
  id: string
  name: string
  status: string
  policy: PolicyRow | null
  gateways: {
    id: string
    name: string
    hostname: string
    status: GatewayStatus
    unitName: string
    devices: { id: string; name: string; protocol: Protocol; host: string | null }[]
  }[]
}

export interface RemoteData {
  sessions: SessionRow[]
  policies: PolicyRow[]
  targets: RequestTarget[]
  me: { name: string; role: string }
  last30: number
  avgMinutes: number | null
}

function adminsOf(clientId: string, r: Repositorio): string[] {
  return r.getClientUsers(clientId)
    .filter((u) => u.status === "active" && u.memberships.some((m) => m.clientId === clientId && m.role === "client_admin"))
    .map((u) => u.name)
}

function policyRow(clientId: string, clientName: string, clientStatus: string, r: Repositorio): PolicyRow | null {
  const p = r.getRemoteAccessPolicy(clientId)
  if (!p) return null
  return {
    clientId,
    clientName,
    clientStatus,
    mode: p.mode,
    maxDurationMin: p.maxDurationMin,
    idleTimeoutMin: p.idleTimeoutMin,
    allowPlcForward: p.allowPlcForward,
    requireOnsiteContact: p.requireOnsiteContact,
    windows: p.windows.map((w) => `${WEEKDAY[w.day]} ${w.start}–${w.end}`),
    approvers: adminsOf(clientId, r),
  }
}

export function sessionRow(s: RemoteAccessSession, clientName: string, r: Repositorio = repositorioMock): SessionRow {
  const g = r.getGateway(s.gatewayId)
  const dev = s.scope.plcForward ? r.getDevice(s.scope.plcForward.deviceId) : undefined
  const requester = r.getPlatformUsers().find((u) => u.name === s.requestedBy)
  const rejected = s.status === "rejected"
  return {
    id: s.id,
    clientId: s.clientId,
    clientName,
    gatewayId: s.gatewayId,
    gatewayName: g?.name ?? s.gatewayId,
    hostname: g?.hostname ?? "—",
    unitName: g ? (r.getUnit(g.unitId)?.name ?? "—") : "—",
    gatewayStatus: g?.status ?? "offline",
    requestedBy: s.requestedBy,
    requestedByRole: requester?.platformRole ? PLATFORM_ROLE_LABEL[requester.platformRole] : "Engemase",
    reason: s.reason,
    ticket: s.ticket,
    durationMin: s.durationMin,
    ssh: s.scope.ssh,
    plc: s.scope.plcForward ? { deviceName: dev?.name ?? s.scope.plcForward.deviceId, target: `${dev?.params.host ?? "?"}:${s.scope.plcForward.port}` } : null,
    onsiteContact: null,
    status: s.status,
    requestedAt: s.requestedAt,
    requestedLabel: dateTime(s.requestedAt),
    approvedBy: s.approvedBy ?? null,
    approvedLabel: s.approvedAt ? `${rejected ? "Recusado" : "Aprovado"} por ${s.approvedBy} às ${time(s.approvedAt)}` : null,
    startedAt: s.startedAt ?? null,
    expiresAt: s.expiresAt ?? null,
    endedAt: s.endedAt ?? null,
    endedLabel: s.endedAt ? dateTime(s.endedAt) : null,
    endedReason: s.endedReason ?? null,
    realDuration: s.startedAt && s.endedAt ? duration((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000) : null,
    connection: s.connection ?? null,
    bytes: s.bytes !== undefined ? bytesLabel(s.bytes) : null,
    approvers: adminsOf(s.clientId, r),
  }
}

export function buildRemoteAccess(r: Repositorio = repositorioMock): RemoteData {
  const clients = r.getClients()
  const nameOf = (id: string) => clients.find((c) => c.id === id)?.name ?? id
  const sessions = r.getRemoteAccessSessions().map((s) => sessionRow(s, nameOf(s.clientId), r))
  const me = r.getCurrentUser()
  const now = Date.parse(r.agoraIso())

  const recent = sessions.filter((s) => s.startedAt && now - Date.parse(s.startedAt) <= 30 * 86_400_000)
  const finished = recent.filter((s) => s.startedAt && s.endedAt)
  const avgMinutes = finished.length > 0 ? Math.round(finished.reduce((sum, s) => sum + (Date.parse(s.endedAt!) - Date.parse(s.startedAt!)), 0) / finished.length / 60_000) : null

  const targets: RequestTarget[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    policy: policyRow(c.id, c.name, c.status, r),
    gateways: r.getGateways(c.id).map((g) => ({
      id: g.id,
      name: g.name,
      hostname: g.hostname,
      status: g.status,
      unitName: r.getUnit(g.unitId)?.name ?? "—",
      devices: r.getDevices(g.id).map((d) => ({ id: d.id, name: d.name, protocol: d.protocol, host: d.params.host ?? null })),
    })),
  }))

  return {
    sessions,
    policies: targets.map((t) => t.policy).filter((p): p is PolicyRow => p !== null),
    targets,
    me: { name: me.name, role: me.platformRole ? PLATFORM_ROLE_LABEL[me.platformRole] : "Engemase" },
    last30: recent.length,
    avgMinutes,
  }
}
