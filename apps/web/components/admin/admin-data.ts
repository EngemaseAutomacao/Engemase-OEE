/**
 * Montagem dos dados do console de clientes a partir de `@/lib/mock`.
 * Usado SÓ por componentes de servidor (páginas); devolve objetos serializáveis.
 * Nada de relógio do sistema: "agora" = MOCK_NOW.
 */
import {
  MOCK_NOW,
  getAuditLog,
  getClientBranding,
  getClientById,
  getClientSummary,
  getClientUsers,
  getClients,
  getDevices,
  getGateways,
  getLines,
  getMachinesWithLive,
  getNotifications,
  getPlatformUsers,
  getRemoteAccessPolicy,
  getRemoteAccessSessions,
  getShiftHistory,
  getShifts,
  getTerminals,
  getUnits,
  nowMs,
  type AuditEntry,
  type Client,
  type ClientManagement,
  type ClientPlan,
  type ClientRole,
  type ClientStatus,
  type Gateway,
  type GatewayStatus,
  type MachineState,
  type RemoteAccessStatus,
  type UserStatus,
} from "@/lib/mock"
import { ago, date, dateTime, dec, num, shortDate, time } from "@/lib/format"
import { PLATFORM_HOST, plural, timezoneLabel } from "./labels"

const DAY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Linhas da tabela de clientes
// ---------------------------------------------------------------------------
export interface ClientRow {
  id: string
  slug: string
  name: string
  legalName: string
  cnpj: string
  city: string
  state: string
  plan: ClientPlan
  management: ClientManagement
  status: ClientStatus
  units: number
  machines: number
  machinesLimit: number
  gateways: number
  gatewaysLimit: number
  gatewaysOnline: number
  gatewaysProblem: number
  gatewaysPending: number
  users: number
  usersLimit: number
  createdAt: string
  createdLabel: string
  oee: number
  machinesWithData: number
  running: number
  openAlerts: number
}

export function clientRow(c: Client): ClientRow {
  const s = getClientSummary(c.id)
  const gws = getGateways(c.id)
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    legalName: c.legalName,
    cnpj: c.cnpj,
    city: c.city,
    state: c.state,
    plan: c.plan,
    management: c.management,
    status: c.status,
    units: s.units,
    machines: s.machines,
    machinesLimit: c.limits.machines,
    gateways: s.gateways,
    gatewaysLimit: c.limits.gateways,
    gatewaysOnline: s.gatewaysOnline,
    gatewaysProblem: s.gatewaysProblem,
    gatewaysPending: gws.filter((g) => g.status === "pending").length,
    users: s.users,
    usersLimit: c.limits.users,
    createdAt: c.createdAt,
    createdLabel: date(c.createdAt),
    oee: s.oee.oee,
    machinesWithData: s.oee.machinesWithData,
    running: s.running,
    openAlerts: getNotifications(c.id).filter((n) => n.status !== "resolved").length,
  }
}

export const buildClientRows = (): ClientRow[] => getClients().map(clientRow)

// ---------------------------------------------------------------------------
// Problemas de gateway e pendências de implantação
// ---------------------------------------------------------------------------
export function gatewayProblems(g: Gateway): string[] {
  const out: string[] = []
  if (g.status === "offline") out.push(`Sem contato ${ago(g.lastSeen)}`)
  if (g.status === "pending" && g.enrollmentCode) out.push(`Aguardando ativação · código ${g.enrollmentCode}`)
  if (g.bufferPending >= 100) out.push(`${num(g.bufferPending)} registros aguardando no buffer`)
  if (g.clockOffsetMs !== null && Math.abs(g.clockOffsetMs) >= 1000) out.push(`Relógio com desvio de ${dec(g.clockOffsetMs / 1000)} s`)
  if (g.configApplied !== null && g.configApplied < g.configVersion) out.push(`Configuração v${g.configApplied} aplicada (publicada v${g.configVersion})`)
  const errs = getDevices(g.id).filter((d) => d.status === "error")
  if (errs.length > 0) out.push(`${plural(errs.length, "CLP", "CLPs")} com erro: ${errs[0]!.lastError ?? "sem resposta"}`)
  return out
}

export interface ChecklistItem {
  key: string
  label: string
  hint: string
  done: boolean
}

/** Etapas do fluxo de implantação (docs/15 §7), conferidas nos dados do cliente. */
export function implementationChecklist(clientId: string): ChecklistItem[] {
  const units = getUnits(clientId)
  const shifts = getShifts(clientId)
  const users = getClientUsers(clientId)
  const admins = users.filter((u) => u.memberships.some((m) => m.clientId === clientId && m.role === "client_admin"))
  const gws = getGateways(clientId)
  const machines = getMachinesWithLive(clientId)
  const terminals = getTerminals(clientId)
  const pendingGw = gws.filter((g) => g.status === "pending")
  const noPlc = machines.filter((m) => !m.deviceId)
  const paired = terminals.filter((t) => t.status !== "pending")
  const activeAdmin = admins.find((a) => a.status === "active")
  const invitedAdmin = admins.find((a) => a.status === "invited")
  return [
    { key: "unit", label: "Primeira unidade e fuso", hint: units.length ? plural(units.length, "unidade", "unidades") : "Nenhuma unidade", done: units.length > 0 },
    { key: "shifts", label: "Turnos configurados", hint: shifts.length ? plural(shifts.length, "turno", "turnos") : "Nenhum turno", done: shifts.length > 0 },
    {
      key: "admin",
      label: "Admin do cliente definiu a senha",
      hint: activeAdmin ? activeAdmin.name : invitedAdmin ? `${invitedAdmin.name} · e-mail “Definir senha” pendente` : admins[0] ? `${admins[0].name} · acesso desativado` : "Nenhum admin",
      done: Boolean(activeAdmin),
    },
    {
      key: "gateway",
      label: "Gateway ativado",
      hint: gws.length === 0 ? "Nenhum gateway provisionado" : pendingGw.length ? `${pendingGw[0]!.name} aguardando ativação` : plural(gws.length, "gateway", "gateways"),
      done: gws.length > 0 && pendingGw.length < gws.length,
    },
    {
      key: "machines",
      label: "Máquinas com CLP e tags Modbus",
      hint: machines.length === 0 ? "Nenhuma máquina" : noPlc.length ? `${plural(noPlc.length, "máquina", "máquinas")} sem CLP vinculado` : plural(machines.length, "máquina", "máquinas"),
      done: machines.length > 0 && noPlc.length === 0,
    },
    {
      key: "terminals",
      label: "TV e tablets pareados",
      hint: paired.length ? plural(paired.length, "terminal pareado", "terminais pareados") : "Nenhum terminal pareado",
      done: paired.length > 0,
    },
    {
      key: "team",
      label: "Equipe do cliente adicionada",
      hint: plural(users.length, "pessoa", "pessoas"),
      done: users.length > admins.length,
    },
  ]
}

// ---------------------------------------------------------------------------
// Visão geral da plataforma (/admin)
// ---------------------------------------------------------------------------
export type AttentionKind = "gateway_offline" | "gateway_degraded" | "onboarding" | "remote_request"

export interface AttentionItem {
  id: string
  kind: AttentionKind
  title: string
  subtitle: string
  details: string[]
  href: string
  actionLabel: string
  when: string
}

export interface ActivityItem {
  id: string
  action: string
  actionLabel: string
  actor: string
  impersonatedBy: string | null
  entityName: string
  details: string | null
  clientName: string
  when: string
  at: string
}

const ACTION_LABEL: Record<string, string> = {
  "config.publish": "Publicou configuração",
  "tag.test_read": "Leitura de teste",
  "user.invite": "Adicionou usuário",
  "stop.classify": "Classificou parada",
  "support.impersonate": "Sessão de suporte",
  "shift.update": "Alterou turno",
  "client.create": "Criou cliente",
  "client.suspend": "Suspendeu cliente",
  "client.reactivate": "Reativou cliente",
  "gateway.create": "Provisionou gateway",
  "platform.user_create": "Adicionou membro da equipe",
}

export function activityItem(a: AuditEntry): ActivityItem {
  return {
    id: a.id,
    action: a.action,
    actionLabel: ACTION_LABEL[a.action] ?? a.action,
    actor: a.actorName,
    impersonatedBy: a.impersonatedBy,
    entityName: a.entityName,
    details: a.details ?? null,
    clientName: a.clientId ? (getClientById(a.clientId)?.name ?? "—") : "Plataforma",
    when: ago(a.at),
    at: dateTime(a.at),
  }
}

const GATEWAY_COLORS: Record<GatewayStatus, string> = { online: "#16a34a", degraded: "#f59e0b", offline: "#dc2626", pending: "#a1a1aa" }

export function buildPlatformOverview() {
  const clients = getClients()
  const rows = clients.map(clientRow)
  const gateways = getGateways()
  const machines = clients.flatMap((c) => getMachinesWithLive(c.id))
  const alerts = getNotifications().filter((n) => n.status !== "resolved")
  const remote = getRemoteAccessSessions()
  const clientName = (id: string) => getClientById(id)?.name ?? "—"
  const clientSlug = (id: string) => getClientById(id)?.slug ?? ""

  const attention: AttentionItem[] = []
  for (const g of gateways.filter((x) => x.status === "offline")) {
    const c = getClientById(g.clientId)
    attention.push({
      id: `gw-${g.id}`,
      kind: "gateway_offline",
      title: `${g.name} offline`,
      subtitle: `${clientName(g.clientId)}${c?.status === "suspended" ? " · cliente suspenso" : ""}`,
      details: gatewayProblems(g),
      href: `/${clientSlug(g.clientId)}/config/gateways/${g.id}`,
      actionLabel: `Abrir ${g.name}`,
      when: ago(g.lastSeen),
    })
  }
  for (const g of gateways.filter((x) => x.status === "degraded")) {
    attention.push({
      id: `gw-${g.id}`,
      kind: "gateway_degraded",
      title: `${g.name} com alertas`,
      subtitle: clientName(g.clientId),
      details: gatewayProblems(g),
      href: `/${clientSlug(g.clientId)}/config/gateways/${g.id}`,
      actionLabel: `Abrir ${g.name}`,
      when: ago(g.lastSeen),
    })
  }
  for (const c of clients.filter((x) => x.status === "onboarding")) {
    const pending = implementationChecklist(c.id).filter((i) => !i.done)
    if (pending.length === 0) continue
    attention.push({
      id: `onb-${c.id}`,
      kind: "onboarding",
      title: `${c.name} em implantação`,
      subtitle: `${plural(pending.length, "pendência", "pendências")} · criado ${ago(c.createdAt)}`,
      details: pending.slice(0, 3).map((p) => `${p.label}: ${p.hint}`),
      href: `/admin/clientes/${c.id}`,
      actionLabel: `Abrir ${c.name}`,
      when: date(c.createdAt),
    })
  }
  for (const s of remote.filter((x) => x.status === "requested")) {
    const g = gateways.find((x) => x.id === s.gatewayId)
    attention.push({
      id: `ras-${s.id}`,
      kind: "remote_request",
      title: `Acesso remoto aguardando o cliente`,
      subtitle: `${clientName(s.clientId)} · ${g?.name ?? s.gatewayId}`,
      details: [`${s.requestedBy} · chamado ${s.ticket} · ${s.durationMin} min`, s.reason],
      href: "/admin/acesso-remoto",
      actionLabel: "Ver pedidos de acesso remoto",
      when: ago(s.requestedAt),
    })
  }

  const byStatus = (st: ClientStatus) => clients.filter((c) => c.status === st).length
  const gwBy = (st: GatewayStatus) => gateways.filter((g) => g.status === st).length
  const versions = new Map<string, number>()
  for (const g of gateways) if (g.agentVersion) versions.set(g.agentVersion, (versions.get(g.agentVersion) ?? 0) + 1)

  return {
    rows,
    counts: {
      clients: clients.length,
      active: byStatus("active"),
      onboarding: byStatus("onboarding"),
      suspended: byStatus("suspended"),
      machines: machines.length,
      machinesRunning: machines.filter((m) => m.live?.state === "RUNNING").length,
      machinesLimit: clients.reduce((s, c) => s + c.limits.machines, 0),
      gateways: gateways.length,
      gatewaysOnline: gwBy("online"),
      gatewaysOffline: gwBy("offline"),
      gatewaysDegraded: gwBy("degraded"),
      gatewaysPending: gwBy("pending"),
      alerts: alerts.length,
      alertsCritical: alerts.filter((a) => a.severity === "critical").length,
      alertsUnacked: alerts.filter((a) => a.status === "open").length,
    },
    attention,
    activity: getAuditLog().slice(0, 6).map(activityItem),
    fleet: (["online", "degraded", "offline", "pending"] as GatewayStatus[]).map((st) => ({ status: st, value: gwBy(st), color: GATEWAY_COLORS[st] })),
    versions: [...versions.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([version, count]) => ({ version, count })),
    remote: {
      pending: remote.filter((s) => s.status === "requested").length,
      active: remote.filter((s) => s.status === "active").length,
    },
  }
}

// ---------------------------------------------------------------------------
// Detalhe do cliente (/admin/clientes/[clienteId])
// ---------------------------------------------------------------------------
export interface UnitRow {
  id: string
  name: string
  city: string
  state: string
  timezone: string
  lines: number
  machines: number
  gateways: number
  shifts: string[]
}

export interface MachineRow {
  id: string
  name: string
  code: string
  type: string
  unit: string
  line: string
  gateway: string | null
  hasPlc: boolean
  state: MachineState
  stale: boolean
  oee: number | null
  href: string
}

export interface GatewayRow {
  id: string
  name: string
  hostname: string
  unit: string
  status: GatewayStatus
  lastSeen: string
  agentVersion: string | null
  config: string
  configOutdated: boolean
  buffer: number
  machines: number
  problems: string[]
  href: string
}

export interface UserRow {
  id: string
  name: string
  login: string
  isUsername: boolean
  role: ClientRole
  scope: string
  status: UserStatus
  twoFactor: boolean
  lastLogin: string
}

export interface SupportGrant {
  id: string
  userName: string
  ticket: string
  reason: string
  start: string
  end: string
  status: "active" | "ended" | "revoked"
}

export interface Assignment {
  id: string
  userName: string
  units: string
  start: string
  end: string
  reason: string
  status: "active" | "expired" | "revoked"
}

export interface RemoteSessionRow {
  id: string
  gateway: string
  requestedBy: string
  ticket: string
  reason: string
  status: RemoteAccessStatus
  when: string
}

export interface LifecycleEvent {
  id: string
  action: string
  title: string
  subtitle: string
  at: string
}

const REMOTE_MODE_LABEL = {
  disabled: "Desativado pelo cliente",
  approval_required: "Mediante aprovação a cada pedido",
  preapproved_window: "Janela pré-aprovada",
} as const

export function buildClientDetail(clientId: string) {
  const c = getClientById(clientId)
  if (!c) return null
  const base = `/${c.slug}`
  const units = getUnits(c.id)
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? "—"
  const lines = getLines(c.id)
  const gateways = getGateways(c.id)
  const machines = getMachinesWithLive(c.id)
  const users = getClientUsers(c.id)
  const summary = getClientSummary(c.id)
  const audit = getAuditLog(c.id)
  const sessions = getRemoteAccessSessions({ clientId: c.id })
  const platform = getPlatformUsers()
  const now = nowMs()

  const unitRows: UnitRow[] = units.map((u) => ({
    id: u.id,
    name: u.name,
    city: u.city,
    state: u.state,
    timezone: timezoneLabel(u.timezone),
    lines: lines.filter((l) => l.unitId === u.id).length,
    machines: machines.filter((m) => m.unitId === u.id).length,
    gateways: gateways.filter((g) => g.unitId === u.id).length,
    shifts: getShifts(c.id, u.id).map((s) => `${s.name} ${s.start}–${s.end}`),
  }))

  const machineRows: MachineRow[] = machines.map((m) => ({
    id: m.id,
    name: m.name,
    code: m.code,
    type: m.type,
    unit: unitName(m.unitId),
    line: lines.find((l) => l.id === m.lineId)?.name ?? "—",
    gateway: gateways.find((g) => g.id === m.gatewayId)?.name ?? null,
    hasPlc: Boolean(m.deviceId),
    state: m.live?.state ?? "NO_COMM",
    stale: m.live?.stale ?? true,
    oee: m.live && !m.live.stale && m.live.countShift > 0 ? m.live.shift.oee : null,
    href: `${base}/maquinas/${m.id}`,
  }))

  const gatewayRows: GatewayRow[] = gateways.map((g) => ({
    id: g.id,
    name: g.name,
    hostname: g.hostname,
    unit: unitName(g.unitId),
    status: g.status,
    lastSeen: g.status === "pending" ? "nunca" : ago(g.lastSeen),
    agentVersion: g.agentVersion,
    config: g.configApplied === null ? `v${g.configVersion} (não aplicada)` : `v${g.configApplied} de v${g.configVersion}`,
    configOutdated: g.configApplied === null || g.configApplied < g.configVersion,
    buffer: g.bufferPending,
    machines: machines.filter((m) => m.gatewayId === g.id).length,
    problems: gatewayProblems(g),
    href: `${base}/config/gateways/${g.id}`,
  }))

  const userRows: UserRow[] = users.map((u) => {
    const m = u.memberships.find((x) => x.clientId === c.id)!
    return {
      id: u.id,
      name: u.name,
      login: u.email ?? u.username ?? "—",
      isUsername: !u.email,
      role: m.role,
      scope: m.unitScope === "all" ? "Todas as unidades" : m.unitScope.map(unitName).join(", ") || "Nenhuma unidade",
      status: u.status,
      twoFactor: u.twoFactor,
      lastLogin: u.lastLoginAt ? ago(u.lastLoginAt) : "nunca entrou",
    }
  })

  // Acesso Engemase: concessões de suporte vêm da auditoria (sessões encerradas) e das sessões
  // de acesso remoto ativas abertas por alguém do suporte; atribuições, das pessoas de campo que já
  // atuaram no cliente (protótipo: o modelo real tem tabelas próprias, docs/15 §9).
  const supportNames = new Set(platform.filter((u) => u.platformRole === "support").map((u) => u.name))
  const grants: SupportGrant[] = [
    ...sessions
      .filter((s) => s.status === "active" && supportNames.has(s.requestedBy))
      .map((s) => ({
        id: `grt-${s.id}`,
        userName: s.requestedBy,
        ticket: s.ticket,
        reason: s.reason,
        start: dateTime(s.approvedAt ?? s.requestedAt),
        end: s.expiresAt ? dateTime(s.expiresAt) : "—",
        status: "active" as const,
      })),
    ...audit
      .filter((a) => a.action === "support.impersonate")
      .map((a) => {
        const minutes = Number(a.details?.match(/(\d+)\s*min/)?.[1] ?? 30)
        return {
          id: `grt-${a.id}`,
          userName: a.actorName,
          ticket: a.details?.match(/#\d+/)?.[0] ?? "—",
          reason: "Diagnóstico com o cliente (sessão de suporte)",
          start: dateTime(a.at),
          end: dateTime(new Date(Date.parse(a.at) + minutes * 60_000).toISOString()),
          status: "ended" as const,
        }
      }),
  ]

  const fieldEngineers = platform.filter((u) => u.platformRole === "field_engineer")
  const assignments: Assignment[] =
    c.management === "engemase"
      ? fieldEngineers
          .filter((u) => sessions.some((s) => s.requestedBy === u.name) || audit.some((a) => a.actorName === u.name))
          .map((u) => {
            const startMs = Date.parse(c.createdAt)
            const endMs = startMs + 365 * DAY_MS
            return {
              id: `asg-${u.id}-${c.id}`,
              userName: u.name,
              units: "Todas as unidades",
              start: date(c.createdAt),
              end: date(new Date(endMs).toISOString()),
              reason: "Comissionamento e configuração como serviço",
              status: endMs > now ? ("active" as const) : ("expired" as const),
            }
          })
      : []

  const remoteSessions: RemoteSessionRow[] = sessions.slice(0, 5).map((s) => ({
    id: s.id,
    gateway: gateways.find((g) => g.id === s.gatewayId)?.name ?? s.gatewayId,
    requestedBy: s.requestedBy,
    ticket: s.ticket,
    reason: s.reason,
    status: s.status,
    when: ago(s.requestedAt),
  }))

  const lifecycle: LifecycleEvent[] = [...audit]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((a) => ({
      id: a.id,
      action: a.action,
      title: ACTION_LABEL[a.action] ?? a.action,
      subtitle: `${a.actorName}${a.impersonatedBy ? " (Engemase)" : ""} · ${a.details ?? a.entityName}`,
      at: `${date(a.at)} ${time(a.at)}`,
    }))
  if (!audit.some((a) => a.action === "client.create")) {
    lifecycle.unshift({
      id: "created",
      action: "client.create",
      title: "Cliente criado",
      subtitle: `Plano ${c.plan === "starter" ? "Starter" : c.plan === "pro" ? "Pro" : "Enterprise"} · ${c.management === "engemase" ? "gerenciado pela Engemase" : "autogestão"}`,
      at: `${date(c.createdAt)} ${time(c.createdAt)}`,
    })
  }

  // OEE médio por dia (últimos 14 dias), a partir do histórico por turno
  const history = getShiftHistory(machines.map((m) => m.id), 14)
  const byDate = new Map<string, number[]>()
  for (const r of history) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r.oee])
  const oeeHistory = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, vals]) => ({ label: shortDate(d), oee: vals.reduce((s, v) => s + v, 0) / vals.length }))

  const admins = userRows.filter((u) => u.role === "client_admin")
  const notifications = getNotifications(c.id).filter((n) => n.status !== "resolved")
  const policy = getRemoteAccessPolicy(c.id)
  const branding = getClientBranding(c.id) ?? null
  const terminals = getTerminals(c.id)

  return {
    client: {
      id: c.id,
      slug: c.slug,
      name: c.name,
      legalName: c.legalName,
      cnpj: c.cnpj,
      city: c.city,
      state: c.state,
      status: c.status,
      plan: c.plan,
      management: c.management,
      limits: c.limits,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      createdAt: date(c.createdAt),
      createdAgo: ago(c.createdAt),
      url: `${PLATFORM_HOST}/${c.slug}`,
    },
    usage: { machines: machines.length, gateways: gateways.length, users: users.length },
    summary: {
      units: summary.units,
      machines: summary.machines,
      running: summary.running,
      gateways: summary.gateways,
      gatewaysOnline: summary.gatewaysOnline,
      gatewaysProblem: summary.gatewaysProblem,
      users: summary.users,
      oee: summary.oee,
      alerts: notifications.length,
      alertsCritical: notifications.filter((n) => n.severity === "critical").length,
      terminals: terminals.length,
      terminalsOnline: terminals.filter((t) => t.status === "online").length,
    },
    units: unitRows,
    machines: machineRows,
    gateways: gatewayRows,
    users: userRows,
    admins,
    grants,
    assignments,
    remoteSessions,
    remotePolicy: policy ? REMOTE_MODE_LABEL[policy.mode] : "Não configurada",
    platformSupport: platform.filter((u) => u.platformRole === "support").map((u) => u.name),
    platformField: fieldEngineers.map((u) => u.name),
    unitOptions: units.map((u) => ({ id: u.id, name: u.name })),
    branding,
    checklist: implementationChecklist(c.id),
    lifecycle,
    oeeHistory,
    now: MOCK_NOW,
  }
}

export type ClientDetail = NonNullable<ReturnType<typeof buildClientDetail>>
