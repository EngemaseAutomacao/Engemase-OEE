/**
 * Agregações das telas de monitoramento (usadas pelas páginas, no servidor).
 * Tudo é derivado de @/lib/mock e de MOCK_NOW — nada de relógio do sistema.
 */
import {
  MOCK_NOW,
  SHIFT_END,
  SHIFT_START,
  getDevice,
  getGateways,
  getLine,
  getTimeline,
  type Gateway,
  type MachineState,
  type MachineWithLive,
  type StateEvent,
} from "@/lib/mock"
import { dec, num, time } from "@/lib/format"
import { STATE_ORDER } from "@/lib/states"
import { GATEWAY_STATUS_LABEL } from "@/lib/roles"

// ---------------------------------------------------------------------------
// Turno corrente
// ---------------------------------------------------------------------------
export interface ShiftInfo {
  name: string
  start: string
  end: string
  now: string
  /** 0–1: quanto do turno já passou. */
  progress: number
}

export function currentShift(): ShiftInfo {
  const s = Date.parse(SHIFT_START)
  const e = Date.parse(SHIFT_END)
  const n = Date.parse(MOCK_NOW)
  return { name: "1º turno", start: SHIFT_START, end: SHIFT_END, now: MOCK_NOW, progress: Math.min(1, Math.max(0, (n - s) / (e - s))) }
}

// ---------------------------------------------------------------------------
// Contagens
// ---------------------------------------------------------------------------
export function stateCounts(machines: MachineWithLive[]): Record<MachineState, number> {
  const out = Object.fromEntries(STATE_ORDER.map((s) => [s, 0])) as Record<MachineState, number>
  for (const m of machines) out[m.live?.state ?? "NO_COMM"]++
  return out
}

export function productionTotals(machines: MachineWithLive[]) {
  let total = 0
  let reject = 0
  let target = 0
  for (const m of machines) {
    if (!m.live) continue
    total += m.live.countShift
    reject += m.live.rejectShift
    target += m.live.countShift > 0 ? m.live.targetShift : 0
  }
  return { total, reject, good: total - reject, target }
}

/** Segundos em cada estado dentro dos eventos do turno. */
export function stateDurations(events: StateEvent[]): Record<MachineState, number> {
  const out = Object.fromEntries(STATE_ORDER.map((s) => [s, 0])) as Record<MachineState, number>
  for (const e of events) out[e.state] += (Date.parse(e.end) - Date.parse(e.start)) / 1000
  return out
}

const durS = (e: StateEvent) => (Date.parse(e.end) - Date.parse(e.start)) / 1000

/** Paradas não planejadas sem motivo (acima do limite de micro-parada), em aberto ou não. */
export function unclassifiedStops(events: StateEvent[], microStopThresholdS: number) {
  return events.filter((e) => e.state === "STOPPED" && e.reasonId === null && durS(e) >= microStopThresholdS)
}

// ---------------------------------------------------------------------------
// Alertas ativos
// ---------------------------------------------------------------------------
export type AlertSeverity = "critical" | "warning" | "info"
export type AlertKind = "fault" | "no_comm" | "stopped_no_reason" | "pending_reasons" | "gateway_offline" | "gateway_degraded" | "gateway_pending"

export interface MonitoringAlert {
  id: string
  kind: AlertKind
  severity: AlertSeverity
  title: string
  description: string
  /** Início do problema (ISO), quando conhecido. */
  since: string | null
  href: string
  context: string
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 }

export function buildAlerts(slug: string, clientId: string, machines: MachineWithLive[]): MonitoringAlert[] {
  const alerts: MonitoringAlert[] = []
  const gateways = getGateways(clientId)
  const gatewayById = new Map<string, Gateway>(gateways.map((g) => [g.id, g]))

  for (const m of machines) {
    const live = m.live
    if (!live) continue
    const href = `/${slug}/maquinas/${m.id}`
    const lineName = getLine(m.lineId)?.name ?? ""
    const gw = m.gatewayId ? gatewayById.get(m.gatewayId) : undefined
    const gatewayDown = gw && (gw.status === "offline" || gw.status === "pending")

    if (live.state === "FAULT") {
      alerts.push({
        id: `fault:${m.id}`,
        kind: "fault",
        severity: "critical",
        title: `${m.name} em falha`,
        description: live.faultCode !== undefined ? `Alarme ${live.faultCode} · ${live.faultText ?? "sem descrição"}` : "Falha sinalizada pelo CLP",
        since: live.stateSince,
        href,
        context: lineName,
      })
    }

    if (live.state === "NO_COMM" && !live.stale && !gatewayDown) {
      const device = m.deviceId ? getDevice(m.deviceId) : undefined
      alerts.push({
        id: `nocomm:${m.id}`,
        kind: "no_comm",
        severity: "critical",
        title: `${m.name} sem comunicação com o CLP`,
        description: device ? `${device.name}: ${device.lastError ?? "sem resposta do escravo Modbus"}` : "Gateway online, mas sem leitura do CLP",
        since: live.stateSince,
        href,
        context: gw ? `${lineName} · ${gw.name}` : lineName,
      })
    }

    const events = getTimeline(m.id)
    const pending = unclassifiedStops(events, m.microStopThresholdS)
    const current = events.at(-1)
    const openNoReason = live.state === "STOPPED" && current && current.state === "STOPPED" && current.reasonId === null
    if (openNoReason) {
      alerts.push({
        id: `stopped:${m.id}`,
        kind: "stopped_no_reason",
        severity: "warning",
        title: `${m.name} parada sem motivo`,
        description: "Parada não planejada em andamento aguardando apontamento do operador",
        since: live.stateSince,
        href,
        context: lineName,
      })
    }
    const closed = pending.filter((e) => e !== current)
    if (closed.length > 0) {
      const totalS = closed.reduce((s, e) => s + durS(e), 0)
      alerts.push({
        id: `pending:${m.id}`,
        kind: "pending_reasons",
        severity: "info",
        title: `${m.name}: ${closed.length} ${closed.length === 1 ? "parada" : "paradas"} sem motivo`,
        description: `Mais antiga às ${time(closed[0].start)} · ${Math.round(totalS / 60)} min parados a classificar`,
        since: closed[0].start,
        href,
        context: lineName,
      })
    }
  }

  for (const g of gateways) {
    const href = `/${slug}/config/gateways/${g.id}`
    const affected = machines.filter((m) => m.gatewayId === g.id)
    if (g.status === "offline") {
      alerts.push({
        id: `gw:${g.id}`,
        kind: "gateway_offline",
        severity: "critical",
        title: `${g.name} offline`,
        description: `${affected.length} ${affected.length === 1 ? "máquina" : "máquinas"} com dados atrasados${g.bufferPending > 0 ? ` · ${num(g.bufferPending)} leituras no buffer local` : ""}`,
        since: g.lastSeen,
        href,
        context: "Gateway",
      })
    } else if (g.status === "degraded") {
      const issues: string[] = []
      if (g.configApplied !== null && g.configApplied < g.configVersion) issues.push(`config v${g.configVersion} pendente (rodando v${g.configApplied})`)
      if (g.clockOffsetMs !== null && Math.abs(g.clockOffsetMs) > 1000) issues.push(`relógio defasado ${dec(g.clockOffsetMs / 1000)} s`)
      const devErrors = affected.filter((m) => m.deviceId && getDevice(m.deviceId)?.status === "error").length
      if (devErrors > 0) issues.push(`${devErrors} ${devErrors === 1 ? "CLP com erro" : "CLPs com erro"} de leitura`)
      alerts.push({
        id: `gw:${g.id}`,
        kind: "gateway_degraded",
        severity: "warning",
        title: `${g.name} ${GATEWAY_STATUS_LABEL.degraded.toLowerCase()}`,
        description: issues.length ? issues.join(" · ") : "Verifique o diagnóstico do gateway",
        since: null,
        href,
        context: "Gateway",
      })
    } else if (g.status === "pending") {
      alerts.push({
        id: `gw:${g.id}`,
        kind: "gateway_pending",
        severity: "info",
        title: `${g.name} aguardando ativação`,
        description: `${g.enrollmentCode ? `Código de ativação ${g.enrollmentCode} · ` : ""}${affected.length} ${affected.length === 1 ? "máquina aguardando" : "máquinas aguardando"} dados`,
        since: null,
        href,
        context: "Gateway",
      })
    }
  }

  return alerts.sort((a, b) => {
    const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (r !== 0) return r
    if (a.since && b.since) return a.since.localeCompare(b.since)
    return a.since ? -1 : b.since ? 1 : 0
  })
}
