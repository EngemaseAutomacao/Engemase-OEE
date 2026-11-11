/**
 * Dados da frota de gateways (console Engemase), montados a partir de `@/lib/mock`.
 * Usado SÓ por páginas (servidor). Devolve objetos serializáveis; "agora" = MOCK_NOW.
 */
import { MOCK_NOW, getClients, getDevices, getGateways, getMachines, getUnit, getUnits, type ClientStatus, type GatewayStatus } from "@/lib/mock"
import { ago, date, dateTime, duration } from "@/lib/format"
import { compareVersions } from "./labels"

// ---------------------------------------------------------------------------
// Catálogo de versões do agente
// (ainda não existe em lib/mock: o canal estável é a maior versão em campo; o beta é fixo aqui)
// ---------------------------------------------------------------------------
export type AgentChannel = "stable" | "beta"

export interface AgentRelease {
  version: string
  channel: AgentChannel
  publishedAt: string
  publishedLabel: string
  notes: string[]
}

const BETA_RELEASE = {
  version: "1.3.0-beta.2",
  publishedAt: "2026-11-06T18:30:00.000Z",
  notes: ["Encaminhamento de porta para CLP no helper de acesso remoto", "logs.upload com compressão zstd", "Reconexão Modbus RTU mais rápida após CRC inválido"],
}
const STABLE_NOTES: Record<string, string[]> = {
  "1.2.0": ["Aplicação de configuração por diferença, com volta à última config boa", "Alerta de relógio acima de 2 s", "Correções de reenvio da outbox em lotes"],
  "1.1.3": ["Correção de vazamento de memória no leitor Modbus TCP"],
  "1.0.4": ["Primeira versão de produção"],
}
const STABLE_PUBLISHED: Record<string, string> = {
  "1.2.0": "2026-10-21T17:00:00.000Z",
  "1.1.3": "2026-08-12T17:00:00.000Z",
  "1.0.4": "2026-03-20T17:00:00.000Z",
}
/** Versões abaixo desta não recebem mais correções. */
export const MIN_SUPPORTED = "1.1.0"

export type VersionState = "current" | "outdated" | "unsupported" | "none"
export type ConfigState = "synced" | "pending" | "none"
export type ClockState = "ok" | "warn" | "alert" | "none"
export type BufferState = "ok" | "warn" | "alert"

export interface FleetRow {
  id: string
  name: string
  hostname: string
  hardware: string
  clientId: string
  clientName: string
  clientSlug: string
  clientStatus: ClientStatus
  unitId: string
  unitName: string
  status: GatewayStatus
  lastSeen: string | null
  lastSeenAgo: string
  lastSeenAt: string
  agentVersion: string | null
  versionState: VersionState
  channel: AgentChannel
  configVersion: number
  configApplied: number | null
  configState: ConfigState
  bufferPending: number
  bufferState: BufferState
  clockOffsetMs: number | null
  clockState: ClockState
  machines: number
  devices: number
  ipIt: string | null
  ipOt: string | null
  uptime: string | null
  enrollmentCode: string | null
  href: string
  issues: number
}

export interface FleetData {
  rows: FleetRow[]
  latest: string
  releases: AgentRelease[]
  clients: { id: string; name: string; status: ClientStatus; units: { id: string; name: string }[] }[]
  generatedAt: string
}

function versionState(v: string | null, latest: string): VersionState {
  if (!v) return "none"
  if (compareVersions(v, MIN_SUPPORTED) < 0) return "unsupported"
  if (compareVersions(v, latest) < 0) return "outdated"
  return "current"
}

export function buildFleet(): FleetData {
  const clients = getClients()
  const gws = getGateways()
  const versions = gws.map((g) => g.agentVersion).filter((v): v is string => !!v && !v.includes("-"))
  const latest = versions.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max), versions[0] ?? "1.0.0")

  const rows: FleetRow[] = gws.map((g) => {
    const c = clients.find((x) => x.id === g.clientId)!
    const u = getUnit(g.unitId)
    const vState = versionState(g.agentVersion, latest)
    const configState: ConfigState = g.configApplied === null ? "none" : g.configApplied < g.configVersion ? "pending" : "synced"
    const abs = g.clockOffsetMs === null ? null : Math.abs(g.clockOffsetMs)
    const clockState: ClockState = abs === null ? "none" : abs >= 2000 ? "alert" : abs >= 500 ? "warn" : "ok"
    const bufferState: BufferState = g.bufferPending >= 1000 ? "alert" : g.bufferPending >= 100 ? "warn" : "ok"
    const issues =
      (g.status === "offline" || g.status === "degraded" ? 1 : 0) +
      (vState === "outdated" || vState === "unsupported" ? 1 : 0) +
      (configState === "pending" ? 1 : 0) +
      (clockState === "alert" ? 1 : 0) +
      (bufferState !== "ok" ? 1 : 0)
    return {
      id: g.id,
      name: g.name,
      hostname: g.hostname,
      hardware: g.hardware,
      clientId: c.id,
      clientName: c.name,
      clientSlug: c.slug,
      clientStatus: c.status,
      unitId: g.unitId,
      unitName: u?.name ?? "—",
      status: g.status,
      lastSeen: g.lastSeen,
      lastSeenAgo: ago(g.lastSeen),
      lastSeenAt: g.lastSeen ? dateTime(g.lastSeen) : "—",
      agentVersion: g.agentVersion,
      versionState: vState,
      channel: g.agentVersion?.includes("-") ? "beta" : "stable",
      configVersion: g.configVersion,
      configApplied: g.configApplied,
      configState,
      bufferPending: g.bufferPending,
      bufferState,
      clockOffsetMs: g.clockOffsetMs,
      clockState,
      machines: getMachines(c.id).filter((m) => m.gatewayId === g.id).length,
      devices: getDevices(g.id).length,
      ipIt: g.ipIt,
      ipOt: g.ipOt,
      uptime: g.uptimeS !== null ? duration(g.uptimeS) : null,
      enrollmentCode: g.enrollmentCode ?? null,
      href: `/${c.slug}/config/gateways/${g.id}`,
      issues,
    }
  })

  const stableVersions = [...new Set([latest, ...versions])].sort((a, b) => compareVersions(b, a))
  const releases: AgentRelease[] = [
    { version: BETA_RELEASE.version, channel: "beta", publishedAt: BETA_RELEASE.publishedAt, publishedLabel: date(BETA_RELEASE.publishedAt), notes: BETA_RELEASE.notes },
    ...stableVersions.map((v) => ({
      version: v,
      channel: "stable" as const,
      publishedAt: STABLE_PUBLISHED[v] ?? MOCK_NOW,
      publishedLabel: STABLE_PUBLISHED[v] ? date(STABLE_PUBLISHED[v]) : "—",
      notes: STABLE_NOTES[v] ?? [],
    })),
  ]

  return {
    rows,
    latest,
    releases,
    clients: clients.map((c) => ({ id: c.id, name: c.name, status: c.status, units: getUnits(c.id).map((u) => ({ id: u.id, name: u.name })) })),
    generatedAt: dateTime(MOCK_NOW),
  }
}
