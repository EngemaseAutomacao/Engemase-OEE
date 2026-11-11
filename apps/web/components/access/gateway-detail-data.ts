/**
 * Monta o "view model" serializável do detalhe do gateway (servidor → componentes de cliente).
 * Tudo pré-formatado no servidor (datas, valores) para não haver diferença na hidratação.
 */
import {
  type Client,
  type Device,
  type Gateway,
  type ModbusArea,
  type Protocol,
  type Tag,
  getAuditLog,
  getClientUsers,
  getCurrentUser,
  getDevices,
  getMachines,
  getPlatformUsers,
  getRemoteAccessPolicy,
  getRemoteAccessSessions,
  getTags,
  getUnit,
  nowMs,
} from "@/lib/mock"
import { ago, dateTime, duration, time } from "@/lib/format"
import { PLATFORM_ROLE_LABEL } from "@/lib/roles"
import { type ConfigChange, type GatewayCommand, commandHistory, configHistory, healthSeries, type HealthSeries } from "./gateway-data"
import { activationInfo, freshCodeExpiresLabel, gatewayIssues, type GatewayIssue } from "./gateway-view"
import {
  CLOCK_ALERT_MS,
  FORWARD_PORTS,
  LATEST_AGENT,
  MODBUS_AREA_FC,
  MODBUS_AREA_SHORT,
  REMOTE_POLICY_LABEL,
  type SessionStatus,
  TAG_ROLE_LABEL,
  WEEKDAY_LABEL,
  bytesLabel,
  clockLabel,
  formatTagValue,
  is32,
  isOlderVersion,
  modbusRef,
  pollLabel,
  serialPortsFor,
  serialSummary,
} from "./labels"

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface DeviceVM {
  id: string
  name: string
  protocol: Protocol
  status: Device["status"]
  /** "192.168.10.21:502" ou "Escravo 3". */
  endpoint: string
  host: string | null
  port: number | null
  serialPort: string | null
  unitId: number
  timeoutMs: number
  latencyMs: number | null
  errors1m: number
  lastError: string | null
  machines: string[]
  tagCount: number
}

export interface BusVM {
  port: string
  /** "19200 bps · 8E1" (null = porta livre). */
  serial: string | null
  devices: DeviceVM[]
  /** Tempo aproximado de uma varredura do barramento (ms). */
  cycleMs: number
}

export interface TagVM {
  id: string
  deviceId: string
  deviceName: string
  machineName: string
  name: string
  roleLabel: string
  area: ModbusArea
  areaShort: string
  fc: string
  address: number
  ref: string
  dataType: Tag["dataType"]
  /** Só para 32 bits. */
  byteOrder: string | null
  pollLabel: string
  value: string
  quality: Tag["quality"]
  /** Valor simulado para "Ler agora" (com pequena variação para contadores). */
  readValue: string
  latencyMs: number | null
  deviceError: string | null
}

export interface ConfigVersionVM {
  version: number
  publishedLabel: string
  publishedAgo: string
  author: string
  summary: string
  changes: ConfigChange[]
  revertOf?: number
}

export interface CommandVM extends Omit<GatewayCommand, "createdAt"> {
  createdLabel: string
  createdAgo: string
}

export interface RemoteSessionVM {
  id: string
  requestedBy: string
  reason: string
  ticket: string
  durationMin: number
  status: SessionStatus
  ssh: boolean
  /** "CLP Injetora 04 · 192.168.10.24:502" */
  plc: string | null
  requestedLabel: string
  approvedBy: string | null
  approvedLabel: string | null
  startedLabel: string | null
  expiresLabel: string | null
  endedLabel: string | null
  endedReason: string | null
  connection: string | null
  bytes: string | null
  /** Segundos restantes (sessão ativa), contados a partir do "agora" do protótipo. */
  remainingS: number | null
}

export interface RemoteAccessVM {
  policy: {
    mode: "disabled" | "approval_required" | "preapproved_window"
    modeLabel: string
    maxDurationMin: number
    idleTimeoutMin: number
    allowPlcForward: boolean
    requireOnsiteContact: boolean
    windows: string[]
  }
  approvers: { name: string; invited: boolean }[]
  sessions: RemoteSessionVM[]
  /** Dispositivos Modbus TCP elegíveis para encaminhamento de um IP:porta. */
  plcTargets: { id: string; label: string; host: string }[]
  ports: { port: number; label: string }[]
  me: { name: string; roleLabel: string; canRequest: boolean }
  historyHref: string
}

export interface GatewayDetail {
  id: string
  name: string
  hostname: string
  hardware: string
  unitName: string
  status: Gateway["status"]
  clientName: string
  clientSlug: string
  managed: boolean
  lastSeenAgo: string
  lastSeenLabel: string | null
  agentVersion: string | null
  agentOutdated: boolean
  latestAgent: string
  configVersion: number
  configApplied: number | null
  bufferPending: number
  cpuPct: number | null
  memMb: number | null
  diskFreePct: number | null
  clockText: string
  clockAlert: boolean
  ipIt: string | null
  ipOt: string | null
  uptime: string | null
  issues: GatewayIssue[]
  devices: DeviceVM[]
  tcpDevices: DeviceVM[]
  buses: BusVM[]
  tags: TagVM[]
  configVersions: ConfigVersionVM[]
  commands: CommandVM[]
  health: HealthSeries | null
  remote: RemoteAccessVM
  /** Máquinas que este gateway alimenta (ou vai alimentar, se pendente). */
  machines: { id: string; name: string; code: string; hasDevice: boolean }[]
  activation: {
    code: string
    expired: boolean
    expiresLabel: string
    freshExpiresLabel: string
    createdBy: string | null
    createdLabel: string | null
  } | null
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

/** Pequena variação determinística do valor para a "leitura agora" (contadores andam um pouco). */
function nextValue(t: Tag): string {
  if (t.lastValue === "—") return "—"
  if (t.role === "count.total") return String(Number(t.lastValue) + 3)
  if (t.role === "count.reject") return t.lastValue
  if (t.dataType === "float32") return (Number(t.lastValue) + 0.3).toFixed(1)
  return t.lastValue
}

export function buildGatewayDetail(client: Client, g: Gateway): GatewayDetail {
  const unit = getUnit(g.unitId)
  const devices = getDevices(g.id)
  const machines = getMachines(client.id)
  const tags = devices.flatMap((d) => getTags({ deviceId: d.id }))
  const machineName = (id: string) => machines.find((m) => m.id === id)?.name ?? "Máquina"
  const audit = getAuditLog(client.id)

  // Pessoas (autores de configuração, solicitantes de comandos, aprovadores)
  const clientUsers = getClientUsers(client.id)
  const platform = getPlatformUsers()
  const engineers = clientUsers
    .filter((u) => u.status === "active" && u.memberships.some((m) => m.clientId === client.id && (m.role === "client_admin" || m.role === "engineer")))
    .map((u) => u.name)
  const engemase = platform.map((u) => u.name)
  const authors = client.management === "engemase" ? [...engemase, ...engineers] : [...engineers, ...engemase]
  const approvers = clientUsers
    .filter((u) => u.status !== "disabled" && u.memberships.some((m) => m.clientId === client.id && m.role === "client_admin"))
    .map((u) => ({ name: u.name, invited: u.status === "invited" }))

  // Dispositivos
  const deviceVM = (d: Device): DeviceVM => ({
    id: d.id,
    name: d.name,
    protocol: d.protocol,
    status: d.status,
    endpoint: d.protocol === "modbus-tcp" ? `${d.params.host}:${d.params.port}` : `Escravo ${d.params.unitId}`,
    host: d.params.host ?? null,
    port: d.params.port ?? null,
    serialPort: d.params.serialPort ?? null,
    unitId: d.params.unitId,
    timeoutMs: d.params.timeoutMs,
    latencyMs: d.latencyMs,
    errors1m: d.errors1m,
    lastError: d.lastError ?? null,
    machines: [
      ...new Set([
        ...machines.filter((m) => m.deviceId === d.id).map((m) => m.name),
        ...tags.filter((t) => t.deviceId === d.id).map((t) => machineName(t.machineId)),
      ]),
    ],
    tagCount: tags.filter((t) => t.deviceId === d.id).length,
  })
  const deviceList = devices.map(deviceVM)
  const tcpDevices = deviceList.filter((d) => d.protocol === "modbus-tcp")
  const rtu = deviceList.filter((d) => d.protocol === "modbus-rtu")
  const ports = [...new Set([...serialPortsFor(g.hardware), ...rtu.map((d) => d.serialPort!)])].sort()
  const buses: BusVM[] = ports.map((port) => {
    const list = rtu.filter((d) => d.serialPort === port).sort((a, b) => a.unitId - b.unitId)
    const first = devices.find((d) => d.params.serialPort === port)
    return {
      port,
      serial: first ? serialSummary(first.params) : null,
      devices: list,
      // Escravo com erro consome o timeout inteiro a cada varredura (docs/11).
      cycleMs: list.reduce((s, d) => s + (d.status === "error" ? d.timeoutMs : d.status === "disabled" ? 0 : (d.latencyMs ?? 40)), 0),
    }
  })

  // Tags
  const tagVMs: TagVM[] = tags.map((t) => {
    const d = devices.find((x) => x.id === t.deviceId)
    return {
      id: t.id,
      deviceId: t.deviceId,
      deviceName: d?.name ?? "—",
      machineName: machineName(t.machineId),
      name: t.name,
      roleLabel: TAG_ROLE_LABEL[t.role],
      area: t.area,
      areaShort: MODBUS_AREA_SHORT[t.area],
      fc: MODBUS_AREA_FC[t.area],
      address: t.address,
      ref: modbusRef(t.area, t.address),
      dataType: t.dataType,
      byteOrder: is32(t.dataType) ? t.byteOrder : null,
      pollLabel: pollLabel(t.pollMs),
      value: formatTagValue(t.lastValue, t.dataType),
      quality: t.quality,
      readValue: formatTagValue(nextValue(t), t.dataType),
      latencyMs: d?.latencyMs ?? null,
      deviceError: d?.status === "error" ? (d.lastError ?? "Sem resposta do escravo") : d?.status === "disabled" ? "Conexão desativada na configuração" : null,
    }
  })

  // Configuração
  const latestPublish = audit.find((a) => a.action === "config.publish" && a.entityName === g.name)
  const versions = configHistory(
    g,
    devices,
    tags,
    machines,
    authors,
    latestPublish ? { author: latestPublish.actorName, at: latestPublish.at, details: latestPublish.details } : undefined,
  ).map((v) => ({ ...v, publishedLabel: dateTime(v.publishedAt), publishedAgo: ago(v.publishedAt) }))

  // Comandos
  const latestVersion = versions.find((v) => v.version === g.configVersion)
  const commands = commandHistory(g, devices, tags, machines, authors, latestVersion ? Date.parse(latestVersion.publishedAt) : undefined).map(
    ({ createdAt, ...c }) => ({ ...c, createdLabel: dateTime(createdAt), createdAgo: ago(createdAt) }),
  )

  // Acesso remoto
  const policy = getRemoteAccessPolicy(client.id)
  const me = getCurrentUser()
  const sessions: RemoteSessionVM[] = getRemoteAccessSessions({ gatewayId: g.id }).map((s) => {
    const plcDev = s.scope.plcForward ? devices.find((d) => d.id === s.scope.plcForward!.deviceId) : undefined
    return {
      id: s.id,
      requestedBy: s.requestedBy,
      reason: s.reason,
      ticket: s.ticket,
      durationMin: s.durationMin,
      status: s.status,
      ssh: s.scope.ssh,
      plc: s.scope.plcForward ? `${plcDev?.name ?? "CLP"} · ${plcDev?.params.host ?? "—"}:${s.scope.plcForward.port}` : null,
      requestedLabel: dateTime(s.requestedAt),
      approvedBy: s.approvedBy ?? null,
      approvedLabel: s.approvedAt ? dateTime(s.approvedAt) : null,
      startedLabel: s.startedAt ? dateTime(s.startedAt) : null,
      expiresLabel: s.expiresAt ? time(s.expiresAt) : null,
      endedLabel: s.endedAt ? dateTime(s.endedAt) : null,
      endedReason: s.endedReason ?? null,
      connection: s.connection === "direct" ? "Conexão direta" : s.connection === "relay" ? "Via relay (TCP 443)" : null,
      bytes: s.bytes ? bytesLabel(s.bytes) : null,
      remainingS: s.status === "active" && s.expiresAt ? Math.max(0, Math.round((Date.parse(s.expiresAt) - nowMs()) / 1000)) : null,
    }
  })

  const act = g.status === "pending" && g.enrollmentCode ? activationInfo(g, audit) : null
  const created = audit.find((a) => a.action === "gateway.create" && a.entityName === g.name)

  return {
    id: g.id,
    name: g.name,
    hostname: g.hostname,
    hardware: g.hardware,
    unitName: unit?.name ?? "—",
    status: g.status,
    clientName: client.name,
    clientSlug: client.slug,
    managed: client.management === "engemase",
    lastSeenAgo: g.lastSeen ? ago(g.lastSeen) : "nunca conectou",
    lastSeenLabel: g.lastSeen ? dateTime(g.lastSeen) : null,
    agentVersion: g.agentVersion,
    agentOutdated: !!g.agentVersion && isOlderVersion(g.agentVersion),
    latestAgent: LATEST_AGENT,
    configVersion: g.configVersion,
    configApplied: g.configApplied,
    bufferPending: g.bufferPending,
    cpuPct: g.cpuPct,
    memMb: g.memMb,
    diskFreePct: g.diskFreePct,
    clockText: clockLabel(g.clockOffsetMs),
    clockAlert: g.clockOffsetMs !== null && Math.abs(g.clockOffsetMs) > CLOCK_ALERT_MS,
    ipIt: g.ipIt,
    ipOt: g.ipOt,
    uptime: g.uptimeS !== null ? duration(g.uptimeS) : null,
    issues: gatewayIssues(g, devices),
    devices: deviceList,
    tcpDevices,
    buses,
    tags: tagVMs,
    configVersions: versions,
    commands,
    health: healthSeries(g, (x) => time(x)),
    remote: {
      policy: {
        mode: policy?.mode ?? "approval_required",
        modeLabel: REMOTE_POLICY_LABEL[policy?.mode ?? "approval_required"],
        maxDurationMin: policy?.maxDurationMin ?? 60,
        idleTimeoutMin: policy?.idleTimeoutMin ?? 15,
        allowPlcForward: policy?.allowPlcForward ?? false,
        requireOnsiteContact: policy?.requireOnsiteContact ?? true,
        windows: (policy?.windows ?? []).map((w) => `${WEEKDAY_LABEL[w.day]}, ${w.start}–${w.end}`),
      },
      approvers,
      sessions,
      plcTargets: tcpDevices.filter((d) => d.status !== "disabled").map((d) => ({ id: d.id, label: `${d.name} · ${d.host}`, host: d.host ?? "" })),
      ports: FORWARD_PORTS,
      me: {
        name: me.name,
        roleLabel: me.platformRole ? `${PLATFORM_ROLE_LABEL[me.platformRole]} Engemase` : "Usuário do cliente",
        canRequest: !!me.platformRole,
      },
      historyHref: `/${client.slug}/acesso-remoto`,
    },
    machines: machines.filter((m) => m.gatewayId === g.id).map((m) => ({ id: m.id, name: m.name, code: m.code, hasDevice: !!m.deviceId })),
    activation:
      act && g.enrollmentCode
        ? {
            code: g.enrollmentCode,
            expired: act.expired,
            expiresLabel: act.expiresLabel,
            freshExpiresLabel: freshCodeExpiresLabel(),
            createdBy: created?.actorName ?? null,
            createdLabel: created ? dateTime(created.at) : null,
          }
        : null,
  }
}
