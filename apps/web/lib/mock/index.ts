/**
 * Camada de dados SIMULADA do protótipo. As telas importam SÓ daqui (`@/lib/mock`).
 * Quando o banco existir, este módulo será trocado pela camada de acesso a dados real,
 * com as mesmas assinaturas (que então passarão a ser async e com escopo de tenant).
 */
import {
  CURRENT_USER_ID,
  MOCK_NOW,
  areas,
  auditLog,
  clients,
  devices,
  downtimeReasons,
  gateways,
  lines,
  machines,
  products,
  shifts,
  tags,
  units,
  users,
} from "./data"
import { dailyOeeFor, hourlyFor, liveFor, paretoFor, shiftHistoryFor, timelineFor } from "./generated"
import type { Client, Machine, MachineLive, OeeValues, User } from "./types"

export * from "./types"
export { MOCK_NOW, DEFAULT_TZ } from "./data"
export { SHIFT_START, SHIFT_END, seededRandom } from "./generated"
export type { ShiftOeeRow } from "./generated"

// ---------------------------------------------------------------------------
// Usuário atual e acesso
// ---------------------------------------------------------------------------
export function getCurrentUser(): User {
  return users.find((u) => u.id === CURRENT_USER_ID)!
}

/** Clientes que o usuário atual pode acessar (plataforma vê todos). */
export function getAccessibleClients(): Client[] {
  const me = getCurrentUser()
  if (me.platformRole) return clients
  const ids = new Set(me.memberships.map((m) => m.clientId))
  return clients.filter((c) => ids.has(c.id))
}

// ---------------------------------------------------------------------------
// Clientes, unidades, áreas, linhas, máquinas
// ---------------------------------------------------------------------------
export const getClients = () => clients
export const getClientBySlug = (slug: string) => clients.find((c) => c.slug === slug)
export const getClientById = (id: string) => clients.find((c) => c.id === id)

export const getUnits = (clientId: string) => units.filter((u) => u.clientId === clientId)
export const getUnit = (id: string) => units.find((u) => u.id === id)
export const getAreas = (unitId: string) => areas.filter((a) => a.unitId === unitId)
export const getLines = (clientId: string, unitId?: string) =>
  lines.filter((l) => l.clientId === clientId && (!unitId || l.unitId === unitId))
export const getLine = (id: string) => lines.find((l) => l.id === id)

export const getMachines = (clientId: string, filter: { unitId?: string; lineId?: string } = {}) =>
  machines.filter(
    (m) =>
      m.clientId === clientId &&
      (!filter.unitId || m.unitId === filter.unitId) &&
      (!filter.lineId || m.lineId === filter.lineId),
  )
export const getMachine = (id: string) => machines.find((m) => m.id === id)

// ---------------------------------------------------------------------------
// Dados ao vivo e séries
// ---------------------------------------------------------------------------
export const getMachineLive = (machineId: string): MachineLive | undefined => liveFor(machineId)
export const getTimeline = timelineFor
export const getHourlyProduction = hourlyFor
export const getDailyOee = dailyOeeFor
export const getPareto = paretoFor
export const getShiftHistory = shiftHistoryFor

export interface MachineWithLive extends Machine {
  live: MachineLive | undefined
}
export function getMachinesWithLive(clientId: string, filter: { unitId?: string; lineId?: string } = {}): MachineWithLive[] {
  return getMachines(clientId, filter).map((m) => ({ ...m, live: liveFor(m.id) }))
}

/**
 * OEE agregado de um conjunto de máquinas no turno corrente.
 * Regra de docs/07: OEE agregado = Σ(boas × ciclo ideal) ÷ Σ tempo planejado
 * (aqui aproximado ponderando pelo tempo planejado igual entre máquinas com dados).
 */
export function aggregateOee(list: { live?: MachineLive }[]): OeeValues & { machinesWithData: number } {
  const withData = list.filter((m) => m.live && !m.live.stale && m.live.countShift > 0)
  if (withData.length === 0) return { availability: 0, performance: 0, quality: 0, oee: 0, machinesWithData: 0 }
  const avg = (k: keyof OeeValues) => withData.reduce((s, m) => s + (m.live!.shift[k] ?? 0), 0) / withData.length
  return {
    availability: avg("availability"),
    performance: avg("performance"),
    quality: avg("quality"),
    oee: avg("oee"),
    machinesWithData: withData.length,
  }
}

// ---------------------------------------------------------------------------
// Gateways, dispositivos (CLPs) e tags
// ---------------------------------------------------------------------------
export const getGateways = (clientId?: string) => (clientId ? gateways.filter((g) => g.clientId === clientId) : gateways)
export const getGateway = (id: string) => gateways.find((g) => g.id === id)
export const getDevices = (gatewayId: string) => devices.filter((d) => d.gatewayId === gatewayId)
export const getDevice = (id: string) => devices.find((d) => d.id === id)
export const getTags = (filter: { deviceId?: string; machineId?: string }) =>
  tags.filter((t) => (!filter.deviceId || t.deviceId === filter.deviceId) && (!filter.machineId || t.machineId === filter.machineId))

// ---------------------------------------------------------------------------
// Cadastros de produção
// ---------------------------------------------------------------------------
export const getProducts = (clientId: string) => products.filter((p) => p.clientId === clientId)
export const getShifts = (clientId: string, unitId?: string) =>
  shifts.filter((s) => s.clientId === clientId && (!unitId || s.unitId === unitId))
export const getDowntimeReasons = (clientId: string) => downtimeReasons.filter((r) => r.clientId === clientId)
export const getDowntimeReason = (id: string | null) => (id ? downtimeReasons.find((r) => r.id === id) : undefined)

// ---------------------------------------------------------------------------
// Usuários e auditoria
// ---------------------------------------------------------------------------
export const getUsers = () => users
export const getPlatformUsers = () => users.filter((u) => u.platformRole !== null)
export const getClientUsers = (clientId: string) => users.filter((u) => u.memberships.some((m) => m.clientId === clientId))
export const getAuditLog = (clientId?: string) =>
  [...auditLog.filter((a) => !clientId || a.clientId === clientId)].sort((a, b) => b.at.localeCompare(a.at))

// ---------------------------------------------------------------------------
// Resumo por cliente (console da plataforma)
// ---------------------------------------------------------------------------
export function getClientSummary(clientId: string) {
  const ms = getMachinesWithLive(clientId)
  const gws = getGateways(clientId)
  return {
    units: getUnits(clientId).length,
    machines: ms.length,
    gateways: gws.length,
    gatewaysOnline: gws.filter((g) => g.status === "online").length,
    gatewaysProblem: gws.filter((g) => g.status === "offline" || g.status === "degraded").length,
    users: getClientUsers(clientId).length,
    oee: aggregateOee(ms),
    running: ms.filter((m) => m.live?.state === "RUNNING").length,
  }
}

// ---------------------------------------------------------------------------
// Parâmetros para generateStaticParams (Cache Components exige ≥ 1 resultado)
// ---------------------------------------------------------------------------
export const clientParams = () => clients.map((c) => ({ cliente: c.slug }))
export const machineParams = (clienteSlug: string) => {
  const c = getClientBySlug(clienteSlug)
  return c ? getMachines(c.id).map((m) => ({ maquinaId: m.id })) : []
}
export const lineParams = (clienteSlug: string) => {
  const c = getClientBySlug(clienteSlug)
  return c ? getLines(c.id).map((l) => ({ linhaId: l.id })) : []
}
export const gatewayParams = (clienteSlug: string) => {
  const c = getClientBySlug(clienteSlug)
  return c ? getGateways(c.id).map((g) => ({ gatewayId: g.id })) : []
}
/** Para rotas de console: /admin/clientes/[clienteId] */
export const adminClientParams = () => clients.map((c) => ({ clienteId: c.id }))

/** Instante "agora" do protótipo em ms (para cálculos de duração em componentes de servidor). */
export const nowMs = () => Date.parse(MOCK_NOW)
