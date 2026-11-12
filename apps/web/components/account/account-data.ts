/**
 * Montagem (no servidor) dos dados das telas de Notificações e Minha conta.
 * Funções puras: só leem `lib/mock` e formatam com `lib/format` (fuso da planta, MOCK_NOW).
 */
import {
  getAccessibleClients,
  getClientSummary,
  getCurrentUser,
  getGateways,
  getLines,
  getMachines,
  getNotifications,
  getUnit,
  getUnits,
  seededRandom,
  type AlertSeverity,
  type AlertType,
} from "@/lib/mock"
import { ago, date, dateTime } from "@/lib/format"
import { CLIENT_ROLE_LABEL, CLIENT_STATUS_LABEL, PLAN_LABEL, PLATFORM_ROLE_LABEL, scopeSummary } from "@/lib/roles"

import { getMyPushDevices, getMySessions, type DeviceKind } from "./account-fixtures"
import type { AlertStatus } from "./labels"

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------
export interface AlertEntity {
  kind: "machine" | "gateway" | "line" | "unit"
  name: string
}

export interface AlertVM {
  id: string
  type: AlertType
  severity: AlertSeverity
  status: AlertStatus
  read: boolean
  title: string
  body: string
  href: string
  ago: string
  at: string
  unitId: string | null
  unitName: string | null
  entity: AlertEntity | null
  acknowledgedBy: string | null
}

/** Máquina, gateway ou linha a que o alerta se refere (pelo link e pelo texto do alerta). */
function resolveEntity(clientId: string, type: AlertType, href: string, text: string): AlertEntity | null {
  const machines = getMachines(clientId)
  const gateways = getGateways(clientId)

  if (type === "oee_below_target" || type === "unclassified_stops") {
    const lines = getLines(clientId).filter((l) => text.includes(l.name))
    if (lines.length > 0) return { kind: "line", name: lines.map((l) => l.name).join(" e ") }
  }
  const machineId = href.match(/\/(?:maquinas|operador)\/([^/?#]+)/)?.[1]
  const machine = machineId ? machines.find((m) => m.id === machineId) : undefined
  if (machine) return { kind: "machine", name: machine.name }

  const gatewayId = href.match(/\/gateways\/([^/?#]+)/)?.[1]
  const gateway = gatewayId ? gateways.find((g) => g.id === gatewayId) : gateways.find((g) => text.includes(g.name))
  if (gateway) return { kind: "gateway", name: gateway.name }

  const byName = machines.find((m) => text.includes(m.name))
  if (byName) return { kind: "machine", name: byName.name }
  return null
}

export function buildAlerts(clientId: string): AlertVM[] {
  return getNotifications(clientId).map((n) => {
    const unit = n.unitId ? getUnit(n.unitId) : undefined
    return {
      id: n.id,
      type: n.type,
      severity: n.severity,
      status: n.status,
      read: n.read,
      title: n.title,
      body: n.body,
      href: n.href,
      ago: ago(n.at),
      at: dateTime(n.at),
      unitId: n.unitId,
      unitName: unit?.name ?? null,
      entity: resolveEntity(clientId, n.type, n.href, `${n.title} ${n.body}`),
      acknowledgedBy: n.acknowledgedBy ?? null,
    }
  })
}

// ---------------------------------------------------------------------------
// Escopo das preferências (unidades e máquinas do cliente)
// ---------------------------------------------------------------------------
export interface ScopeUnit {
  id: string
  name: string
  machines: { id: string; name: string; line: string }[]
}

export function buildScope(clientId: string): ScopeUnit[] {
  const lines = getLines(clientId)
  return getUnits(clientId).map((u) => ({
    id: u.id,
    name: u.name,
    machines: getMachines(clientId, { unitId: u.id }).map((m) => ({
      id: m.id,
      name: m.name,
      line: lines.find((l) => l.id === m.lineId)?.name ?? "",
    })),
  }))
}

// ---------------------------------------------------------------------------
// Dispositivos (push) e sessões
// ---------------------------------------------------------------------------
export interface DeviceVM {
  id: string
  name: string
  kind: DeviceKind
  detail: string
  created: string
  lastSeen: string
  status: "active" | "expired"
}

export function buildDevices(): DeviceVM[] {
  return getMyPushDevices().map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    detail: `${d.browser} · ${d.os}`,
    created: date(d.createdAt),
    lastSeen: ago(d.lastSeenAt),
    status: d.status,
  }))
}

export interface SessionVM {
  id: string
  kind: DeviceKind
  title: string
  place: string
  ip: string
  started: string
  lastActive: string
  current: boolean
}

export function buildSessions(): SessionVM[] {
  return getMySessions().map((s) => ({
    id: s.id,
    kind: s.kind,
    title: `${s.browser} · ${s.os}`,
    place: s.place,
    ip: s.ip,
    started: dateTime(s.startedAt),
    lastActive: s.current ? "ativa agora" : ago(s.lastActiveAt),
    current: s.current,
  }))
}

// ---------------------------------------------------------------------------
// Conta: perfil e clientes acessíveis
// ---------------------------------------------------------------------------
export interface AccountProfile {
  name: string
  email: string
  roleLabel: string
  isPlatform: boolean
  twoFactor: boolean
  lastLogin: string
}

export function buildProfile(): AccountProfile {
  const me = getCurrentUser()
  const membership = me.memberships[0]
  return {
    name: me.name,
    email: me.email ?? me.username ?? "",
    roleLabel: me.platformRole ? `Engemase · ${PLATFORM_ROLE_LABEL[me.platformRole]}` : membership ? CLIENT_ROLE_LABEL[membership.role] : "",
    isPlatform: Boolean(me.platformRole),
    twoFactor: me.twoFactor,
    lastLogin: me.lastLoginAt ? `${dateTime(me.lastLoginAt)} (${ago(me.lastLoginAt)})` : "nunca",
  }
}

export interface AccessibleClientVM {
  id: string
  slug: string
  name: string
  place: string
  status: "active" | "onboarding" | "suspended"
  statusLabel: string
  plan: string
  access: string
  scope: string
  units: number
  machines: number
  gatewaysProblem: number
}

export function buildAccessibleClients(): AccessibleClientVM[] {
  const me = getCurrentUser()
  return getAccessibleClients().map((c) => {
    const s = getClientSummary(c.id)
    const membership = me.memberships.find((m) => m.clientId === c.id)
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      place: `${c.city}, ${c.state}`,
      status: c.status,
      statusLabel: CLIENT_STATUS_LABEL[c.status],
      plan: PLAN_LABEL[c.plan],
      access: me.platformRole ? `Equipe Engemase · ${PLATFORM_ROLE_LABEL[me.platformRole]}` : membership ? CLIENT_ROLE_LABEL[membership.role] : "—",
      scope: me.platformRole
        ? "Todas as unidades · acesso auditado"
        : membership
          ? membership.scope.kind === "units"
            ? membership.scope.unitIds
                .map((id) => getUnit(id)?.name)
                .filter(Boolean)
                .join(", ") || "Nenhuma unidade"
            : scopeSummary(membership.scope)
          : "—",
      units: s.units,
      machines: s.machines,
      gatewaysProblem: s.gatewaysProblem,
    }
  })
}

// ---------------------------------------------------------------------------
// Verificação em 2 etapas (dados ilustrativos e determinísticos)
// ---------------------------------------------------------------------------
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export interface TwoFactorSeed {
  /** Chave secreta em base32, agrupada de 4 em 4 para digitação manual. */
  secret: string
  otpauth: string
  recoveryCodes: string[]
}

export function buildTwoFactorSeed(): TwoFactorSeed {
  const me = getCurrentUser()
  const r = seededRandom(`2fa:${me.id}`)
  const raw = Array.from({ length: 32 }, () => BASE32[Math.floor(r() * 32)]).join("")
  const code = () => Array.from({ length: 10 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(r() * 31)]).join("")
  return {
    secret: raw.match(/.{4}/g)!.join(" "),
    otpauth: `otpauth://totp/Engemase%20OEE:${encodeURIComponent(me.email ?? me.id)}?secret=${raw}&issuer=Engemase%20OEE`,
    recoveryCodes: Array.from({ length: 10 }, () => {
      const c = code()
      return `${c.slice(0, 5)}-${c.slice(5)}`
    }),
  }
}
