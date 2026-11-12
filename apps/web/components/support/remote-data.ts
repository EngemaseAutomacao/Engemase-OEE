/**
 * Acesso remoto do ponto de vista do CLIENTE, montado a partir de `@/lib/mock`.
 * Usado SÓ pela página (servidor). "Agora" = MOCK_NOW.
 */
import {
  getClientUsers,
  getCurrentUser,
  getDevice,
  getGateway,
  getPlatformUsers,
  getRemoteAccessPolicy,
  getRemoteAccessSessions,
  getUnit,
  nowMs,
  type Client,
  type RemoteAccessSession,
} from "@/lib/mock"
import { date } from "@/lib/format"
import { CLIENT_ROLE_LABEL, PLATFORM_ROLE_LABEL } from "@/lib/roles"
import type { PersonVM, PolicyVM, RemoteData, RemoteSessionVM } from "./remote-types"

const ms = (iso?: string) => (iso ? Date.parse(iso) : null)

function plcOf(s: RemoteAccessSession) {
  const fwd = s.scope.plcForward
  if (!fwd) return null
  const dev = getDevice(fwd.deviceId)
  return { deviceName: dev?.name ?? fwd.deviceId, target: `${dev?.params.host ?? "?"}:${fwd.port}` }
}

export function buildRemoteAccess(client: Client): RemoteData {
  const me = getCurrentUser()
  const raw = getRemoteAccessSessions({ clientId: client.id })
  const platform = getPlatformUsers()

  const sessions: RemoteSessionVM[] = raw.map((s) => {
    const gw = getGateway(s.gatewayId)
    const requester = platform.find((u) => u.name === s.requestedBy)
    const previous = raw.filter((o) => o.id !== s.id && o.requestedBy === s.requestedBy && o.startedAt && o.requestedAt < s.requestedAt)
    const last = previous[0]
    const plc = plcOf(s)
    return {
      id: s.id,
      gatewayId: s.gatewayId,
      gatewayName: gw?.name ?? s.gatewayId,
      hostname: gw?.hostname ?? "—",
      unitName: gw ? (getUnit(gw.unitId)?.name ?? "") : "",
      gatewayStatus: gw?.status ?? "offline",
      requestedBy: s.requestedBy,
      requestedByRole: requester?.platformRole ? `Engemase · ${PLATFORM_ROLE_LABEL[requester.platformRole]}` : "Engemase",
      requesterHistory: last
        ? `${previous.length} ${previous.length === 1 ? "sessão anterior" : "sessões anteriores"} neste cliente · última em ${date(last.startedAt!)}`
        : "Primeira sessão deste técnico neste cliente",
      reason: s.reason,
      ticket: s.ticket,
      durationMin: s.durationMin,
      requestedDurationMin: s.durationMin,
      ssh: s.scope.ssh,
      plc,
      requestedPlc: plc,
      status: s.status,
      requestedMs: Date.parse(s.requestedAt),
      decidedBy: s.approvedBy ?? null,
      decidedMs: ms(s.approvedAt),
      startedMs: ms(s.startedAt),
      expiresMs: ms(s.expiresAt),
      endedMs: ms(s.endedAt),
      endedReason: s.endedReason ?? null,
      connection: s.connection ?? null,
      bytes: s.bytes ?? null,
      onsiteContact: null,
      changes: [],
    }
  })

  const members = getClientUsers(client.id).filter((u) => u.status === "active")
  const roleOf = (userId: string) => members.find((u) => u.id === userId)?.memberships.find((m) => m.clientId === client.id)?.role
  const approvers = members.filter((u) => roleOf(u.id) === "client_admin").map((u) => u.name)
  const contacts: PersonVM[] = members
    .filter((u) => {
      const r = roleOf(u.id)
      return r === "client_admin" || r === "engineer" || r === "supervisor"
    })
    .map((u) => ({ id: u.id, name: u.name, role: CLIENT_ROLE_LABEL[roleOf(u.id)!] }))

  const p = getRemoteAccessPolicy(client.id)
  const defaultContact = contacts.find((c) => c.role === CLIENT_ROLE_LABEL.engineer) ?? contacts[0]
  const policy: PolicyVM = {
    // Sem registro = padrão da plataforma: com aprovação (docs/12).
    mode: p?.mode ?? "approval_required",
    maxDurationMin: p?.maxDurationMin ?? 240,
    idleTimeoutMin: p?.idleTimeoutMin ?? 15,
    allowPlcForward: p?.allowPlcForward ?? false,
    requireOnsiteContact: p?.requireOnsiteContact ?? true,
    onsiteContactId: defaultContact?.id ?? null,
    windows: p?.windows ?? [],
  }

  return {
    clientName: client.name,
    clientSlug: client.slug,
    me: { name: me.name, isPlatform: Boolean(me.platformRole) },
    approvers,
    contacts,
    sessions,
    policy,
    nowMs: nowMs(),
  }
}
