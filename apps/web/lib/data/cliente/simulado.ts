/**
 * `ClienteDados` da demonstração (sem banco): repassa as consultas para `@/lib/mock`, com o "agora" fixo
 * do protótipo (MOCK_NOW). Nada aqui lê o relógio, então as telas continuam pré-renderizáveis.
 */
import {
  MOCK_NOW,
  SHIFT_END,
  SHIFT_START,
  aggregateOee,
  getAccessibleClients,
  getAreas,
  getClientBranding,
  getClientBySlug,
  getClientUsers,
  getConfigAccess,
  getCurrentUser,
  getDailyOee,
  getDevice,
  getDevices,
  getDowntimeReason,
  getDowntimeReasons,
  getGateway,
  getGateways,
  getHourlyProduction,
  getLine,
  getLines,
  getMachine,
  getMachineLive,
  getMachines,
  getMachinesWithLive,
  getNotifications,
  getPareto,
  getProducts,
  getRemoteAccessSessions,
  getShiftHistory,
  getShifts,
  getTags,
  getTimeline,
  getUnit,
  getUnits,
  scopeAllowsMachine,
  type Client,
} from "@/lib/mock"
import { CLIENT_ROLE_LABEL, PLATFORM_ROLE_LABEL } from "@/lib/roles"
import { buildStopRecords } from "@/components/reports/stops-data"
import type { ClienteDados, JanelaTurno } from "./tipos"

/** Turno corrente do protótipo: 1º turno de 11/11, 06:00–14:00, refeição 10:00–10:30 (BRT). */
const TURNO_SIMULADO: JanelaTurno = {
  id: "sh_1",
  name: "1º turno",
  start: SHIFT_START,
  end: SHIFT_END,
  breaks: [{ start: "2026-11-11T13:00:00.000Z", end: "2026-11-11T13:30:00.000Z" }],
  emAndamento: true,
}

export function clienteSimulado(slug: string): ClienteDados | null {
  const client: Client | undefined = getClientBySlug(slug)
  if (!client) return null
  const me = getCurrentUser()
  const membership = me.memberships.find((m) => m.clientId === client.id)
  const access = getConfigAccess(client.id)
  const machines = getMachines(client.id)
  const owns = (id: string) => getMachine(id)?.clientId === client.id

  return {
    fonte: "simulado",
    now: MOCK_NOW,
    nowMs: Date.parse(MOCK_NOW),
    client,
    viewer: {
      name: me.name,
      email: me.email ?? me.username ?? "",
      roleLabel: me.platformRole ? `Engemase · ${PLATFORM_ROLE_LABEL[me.platformRole]}` : membership ? CLIENT_ROLE_LABEL[membership.role] : "",
      isPlatform: Boolean(me.platformRole),
    },
    access: { ...access, canSeeTechnical: true },
    accessibleClients: getAccessibleClients().map((c) => ({ slug: c.slug, name: c.name, status: c.status })),
    branding: getClientBranding(client.id),
    oeeTarget: 0.75,

    units: getUnits(client.id),
    areas: getUnits(client.id).flatMap((u) => getAreas(u.id)),
    lines: getLines(client.id),
    machines,
    gateways: getGateways(client.id),
    reasons: getDowntimeReasons(client.id),
    products: getProducts(client.id),
    rejectReasons: [],
    shifts: getShifts(client.id),

    getUnit: (id) => {
      const u = getUnit(id)
      return u?.clientId === client.id ? u : undefined
    },
    getLine: (id) => {
      const l = getLine(id)
      return l?.clientId === client.id ? l : undefined
    },
    getMachine: (id) => {
      const m = getMachine(id)
      return m?.clientId === client.id ? m : undefined
    },
    getAreas: (unitId) => getAreas(unitId).filter((a) => a.clientId === client.id),
    getGateway: (id) => {
      const g = getGateway(id)
      return g?.clientId === client.id ? g : undefined
    },
    getDevice,
    getDevices,
    getTags: (machineId) => getTags({ machineId }),
    getDowntimeReason,

    shiftWindow: () => TURNO_SIMULADO,

    getMachinesWithLive: (filter) => getMachinesWithLive(client.id, filter),
    getMachineLive: (id) => (owns(id) ? getMachineLive(id) : undefined),
    getTimeline: (id) => (owns(id) ? getTimeline(id) : []),
    getHourlyProduction: (id) => (owns(id) ? getHourlyProduction(id) : []),
    getDailyOee: (id, days) => (owns(id) ? getDailyOee(id, days) : []),
    getPareto: (ids) => getPareto(ids.filter(owns)),
    getShiftHistory: (ids, days) => getShiftHistory(ids.filter(owns), days),
    getStopRecords: (ids) => buildStopRecords(ids.filter(owns)),
    aggregateOee: (list) => aggregateOee([...list]),
    getNotifications: () => getNotifications(client.id),
    getRemoteSessions: () => getRemoteAccessSessions({ clientId: client.id }),
    operatorFor: (machine) => {
      const u =
        getClientUsers(client.id).find((x) =>
          x.memberships.some((m) => m.clientId === client.id && m.role === "operator" && scopeAllowsMachine(m.scope, machine)),
        ) ?? me
      return { name: u.name, username: u.username ?? u.email }
    },
  }
}
