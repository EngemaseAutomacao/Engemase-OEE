/**
 * Monta os "view models" serializáveis dos gateways (servidor → componentes de cliente).
 * Tudo pré-formatado no servidor para evitar diferenças de formatação na hidratação.
 */
import { type AuditEntry, type Device, type Gateway, type GatewayStatus, type Machine, nowMs } from "@/lib/mock"
import { ago, dateTime, num } from "@/lib/format"
import { CLOCK_ALERT_MS, clockLabel, configLabel } from "./labels"

export type IssueKind = "offline" | "pending" | "clock" | "config" | "device" | "buffer" | "disk"

export interface GatewayIssue {
  kind: IssueKind
  tone: "bad" | "warn" | "info"
  text: string
}

export interface GatewayRow {
  id: string
  name: string
  hostname: string
  unitId: string
  unitName: string
  hardware: string
  status: GatewayStatus
  lastSeenAgo: string
  lastSeenAt: string | null
  agentVersion: string | null
  configText: string
  configTone: "ok" | "warn" | "none"
  configVersion: number
  configApplied: number | null
  bufferPending: number
  cpuPct: number | null
  memMb: number | null
  diskFreePct: number | null
  clockText: string
  clockAlert: boolean
  devices: number
  devicesError: number
  machines: number
  enrollmentCode: string | null
  /** Código de ativação vencido (vale 24 h). */
  codeExpired: boolean
  /** "12/11 10:42": validade (ou vencimento) do código atual. */
  codeExpiresLabel: string
  issues: GatewayIssue[]
  /** Criado nesta sessão (protótipo): ainda sem página de detalhe. */
  local?: boolean
}

export function gatewayIssues(g: Gateway, devices: Device[]): GatewayIssue[] {
  const out: GatewayIssue[] = []
  if (g.status === "pending") {
    out.push({ kind: "pending", tone: "info", text: "Aguardando a instalação e ativação do agente no local" })
    return out
  }
  if (g.status === "offline") {
    out.push({
      kind: "offline",
      tone: "bad",
      text: `Sem contato ${ago(g.lastSeen)}${g.bufferPending > 0 ? ` · ${num(g.bufferPending)} leituras guardadas no buffer local (nenhum dado se perde)` : ""}`,
    })
  }
  if (g.clockOffsetMs !== null && Math.abs(g.clockOffsetMs) > CLOCK_ALERT_MS) {
    out.push({
      kind: "clock",
      tone: "warn",
      text: `Relógio ${g.clockOffsetMs > 0 ? "adiantado" : "atrasado"} ${clockLabel(Math.abs(g.clockOffsetMs)).replace("+", "")} (limite 2 s): verifique o NTP (chrony)`,
    })
  }
  if (g.configApplied !== null && g.configApplied < g.configVersion) {
    out.push({ kind: "config", tone: "warn", text: `Configuração v${g.configVersion} publicada e ainda não aplicada (em uso: v${g.configApplied})` })
  }
  const errors = devices.filter((d) => d.status === "error")
  if (errors.length > 0 && g.status !== "offline") {
    const first = errors[0]!
    out.push({
      kind: "device",
      tone: "bad",
      text: `${errors.length === 1 ? "1 CLP com erro" : `${errors.length} CLPs com erro`}: ${first.name}${first.lastError ? ` — ${first.lastError}` : ""}`,
    })
  }
  if (g.status !== "offline" && g.bufferPending > 20) {
    out.push({ kind: "buffer", tone: "warn", text: `Fila de envio acima do normal: ${num(g.bufferPending)} leituras aguardando` })
  }
  if (g.diskFreePct !== null && g.diskFreePct < 20) {
    out.push({ kind: "disk", tone: "warn", text: `Pouco espaço livre em disco (${g.diskFreePct}%)` })
  }
  return out
}

const CODE_TTL_MS = 24 * 60 * 60_000

/** Validade de um código gerado agora (protótipo: a partir de MOCK_NOW). */
export const freshCodeExpiresLabel = () => dateTime(new Date(nowMs() + CODE_TTL_MS).toISOString())

/**
 * Validade do código de ativação de um gateway pendente. Usa o registro "gateway.create" da auditoria
 * (quando o código foi gerado); sem registro, considera gerado há 2 h.
 */
export function activationInfo(g: Gateway, audit: AuditEntry[]): { expired: boolean; expiresLabel: string } {
  const created = audit.find((a) => a.action === "gateway.create" && a.entityName === g.name)
  const issued = created ? Date.parse(created.at) : nowMs() - 2 * 60 * 60_000
  const expires = issued + CODE_TTL_MS
  return { expired: expires < nowMs(), expiresLabel: dateTime(new Date(expires).toISOString()) }
}

export function gatewayRow(g: Gateway, unitName: string, devices: Device[], machines: Machine[], audit: AuditEntry[] = []): GatewayRow {
  const cfg = configLabel(g.configVersion, g.configApplied)
  const code = activationInfo(g, audit)
  return {
    id: g.id,
    name: g.name,
    hostname: g.hostname,
    unitId: g.unitId,
    unitName,
    hardware: g.hardware,
    status: g.status,
    lastSeenAgo: g.lastSeen ? ago(g.lastSeen) : "nunca conectou",
    lastSeenAt: g.lastSeen ? dateTime(g.lastSeen) : null,
    agentVersion: g.agentVersion,
    configText: cfg.text,
    configTone: cfg.tone,
    configVersion: g.configVersion,
    configApplied: g.configApplied,
    bufferPending: g.bufferPending,
    cpuPct: g.cpuPct,
    memMb: g.memMb,
    diskFreePct: g.diskFreePct,
    clockText: clockLabel(g.clockOffsetMs),
    clockAlert: g.clockOffsetMs !== null && Math.abs(g.clockOffsetMs) > CLOCK_ALERT_MS,
    devices: devices.length,
    devicesError: devices.filter((d) => d.status === "error").length,
    machines: machines.filter((m) => m.gatewayId === g.id).length,
    enrollmentCode: g.enrollmentCode ?? null,
    codeExpired: g.status === "pending" && code.expired,
    codeExpiresLabel: code.expiresLabel,
    issues: gatewayIssues(g, devices),
  }
}

/** Ordem de exibição: problemas primeiro. */
export const STATUS_RANK: Record<GatewayStatus, number> = { offline: 0, degraded: 1, pending: 2, online: 3 }
