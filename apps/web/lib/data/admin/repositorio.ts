/**
 * Repositório das telas do console Engemase e dos cadastros (W8): o mesmo conjunto de consultas que
 * as telas usavam de `@/lib/mock`, com duas implementações:
 *
 * - `repositorioMock`: os dados simulados (demonstração sem banco);
 * - `repositorioEmMemoria(foto)`: uma "foto" do banco já lida e filtrada pela RLS/escopo
 *   (`snapshot.ts`), nos mesmos tipos do protótipo.
 *
 * Os montadores dos componentes (`buildClientDetail`, `buildFleet`, `buildGatewayDetail`...) recebem um
 * `Repositorio` e não sabem de onde vêm os dados. Sem relógio do sistema: "agora" vem do repositório.
 */
import * as mock from "@/lib/mock"
import type {
  AppNotification,
  Area,
  AuditEntry,
  Client,
  ClientBranding,
  ConfigAccess,
  Device,
  DowntimeReason,
  Gateway,
  Line,
  Machine,
  MachineWithLive,
  Product,
  RemoteAccessPolicy,
  RemoteAccessSession,
  Shift,
  ShiftOeeRow,
  Tag,
  Terminal,
  Unit,
  User,
} from "@/lib/mock"

export interface Repositorio {
  /** "Agora" (ISO): instante fixo no protótipo, relógio real com banco. */
  agoraIso(): string
  getCurrentUser(): User
  getConfigAccess(clientId: string): ConfigAccess
  getClients(): Client[]
  getClientById(id: string): Client | undefined
  getClientBySlug(slug: string): Client | undefined
  getUnits(clientId: string): Unit[]
  getUnit(id: string): Unit | undefined
  getAreas(unitId: string): Area[]
  getLines(clientId: string, unitId?: string): Line[]
  getLine(id: string): Line | undefined
  getMachines(clientId: string, filter?: { unitId?: string; lineId?: string }): Machine[]
  getMachine(id: string): Machine | undefined
  getMachinesWithLive(clientId: string, filter?: { unitId?: string; lineId?: string }): MachineWithLive[]
  getClientSummary(clientId: string): ReturnType<typeof mock.getClientSummary>
  getShiftHistory(machineIds: string[], days: number): ShiftOeeRow[]
  getGateways(clientId?: string): Gateway[]
  getGateway(id: string): Gateway | undefined
  getDevices(gatewayId: string): Device[]
  getDevice(id: string): Device | undefined
  getTags(filter: { deviceId?: string; machineId?: string }): Tag[]
  getProducts(clientId: string): Product[]
  getShifts(clientId: string, unitId?: string): Shift[]
  getDowntimeReasons(clientId: string): DowntimeReason[]
  getUsers(): User[]
  getPlatformUsers(): User[]
  getClientUsers(clientId: string): User[]
  getAuditLog(clientId?: string): AuditEntry[]
  getNotifications(clientId?: string): AppNotification[]
  getRemoteAccessSessions(filter?: { clientId?: string; gatewayId?: string }): RemoteAccessSession[]
  getRemoteAccessPolicy(clientId: string): RemoteAccessPolicy | undefined
  getTerminals(clientId: string): Terminal[]
  getClientBranding(clientId: string): ClientBranding | undefined
}

export const repositorioMock: Repositorio = {
  agoraIso: () => mock.MOCK_NOW,
  getCurrentUser: mock.getCurrentUser,
  getConfigAccess: mock.getConfigAccess,
  getClients: mock.getClients,
  getClientById: mock.getClientById,
  getClientBySlug: mock.getClientBySlug,
  getUnits: mock.getUnits,
  getUnit: mock.getUnit,
  getAreas: mock.getAreas,
  getLines: mock.getLines,
  getLine: mock.getLine,
  getMachines: mock.getMachines,
  getMachine: mock.getMachine,
  getMachinesWithLive: mock.getMachinesWithLive,
  getClientSummary: mock.getClientSummary,
  getShiftHistory: mock.getShiftHistory,
  getGateways: mock.getGateways,
  getGateway: mock.getGateway,
  getDevices: mock.getDevices,
  getDevice: mock.getDevice,
  getTags: mock.getTags,
  getProducts: mock.getProducts,
  getShifts: mock.getShifts,
  getDowntimeReasons: mock.getDowntimeReasons,
  getUsers: mock.getUsers,
  getPlatformUsers: mock.getPlatformUsers,
  getClientUsers: mock.getClientUsers,
  getAuditLog: mock.getAuditLog,
  getNotifications: mock.getNotifications,
  getRemoteAccessSessions: mock.getRemoteAccessSessions,
  getRemoteAccessPolicy: mock.getRemoteAccessPolicy,
  getTerminals: mock.getTerminals,
  getClientBranding: mock.getClientBranding,
}

/**
 * "Foto" do banco nos tipos do protótipo. Só entra o que a pessoa pode ver (RLS do cliente + escopo).
 * O que ainda não vem do banco nesta etapa (dados ao vivo, notificações, acesso remoto, terminais,
 * identidade visual) fica vazio: as telas mostram o estado vazio.
 */
export interface Foto {
  agora: string
  usuario: User
  acesso: Record<string, ConfigAccess>
  clients: Client[]
  units: Unit[]
  areas: Area[]
  lines: Line[]
  machines: Machine[]
  gateways: Gateway[]
  devices: Device[]
  tags: Tag[]
  users: User[]
  platformUsers: User[]
  audit: AuditEntry[]
  shifts: Shift[]
}

const SEM_ACESSO: ConfigAccess = { isEngemase: false, canConfigure: false, canManageUsers: false }

export function repositorioEmMemoria(f: Foto): Repositorio {
  const getMachines = (clientId: string, filter: { unitId?: string; lineId?: string } = {}) =>
    f.machines.filter(
      (m) => m.clientId === clientId && (!filter.unitId || m.unitId === filter.unitId) && (!filter.lineId || m.lineId === filter.lineId),
    )
  const getMachinesWithLive = (clientId: string, filter: { unitId?: string; lineId?: string } = {}): MachineWithLive[] =>
    getMachines(clientId, filter).map((m) => ({ ...m, live: undefined }))
  const getGateways = (clientId?: string) => (clientId ? f.gateways.filter((g) => g.clientId === clientId) : f.gateways)
  const getClientUsers = (clientId: string) => f.users.filter((u) => u.memberships.some((m) => m.clientId === clientId))
  const getUnits = (clientId: string) => f.units.filter((u) => u.clientId === clientId)

  return {
    agoraIso: () => f.agora,
    getCurrentUser: () => f.usuario,
    getConfigAccess: (clientId) => f.acesso[clientId] ?? SEM_ACESSO,
    getClients: () => f.clients,
    getClientById: (id) => f.clients.find((c) => c.id === id),
    getClientBySlug: (slug) => f.clients.find((c) => c.slug === slug),
    getUnits,
    getUnit: (id) => f.units.find((u) => u.id === id),
    getAreas: (unitId) => f.areas.filter((a) => a.unitId === unitId),
    getLines: (clientId, unitId) => f.lines.filter((l) => l.clientId === clientId && (!unitId || l.unitId === unitId)),
    getLine: (id) => f.lines.find((l) => l.id === id),
    getMachines,
    getMachine: (id) => f.machines.find((m) => m.id === id),
    getMachinesWithLive,
    getClientSummary: (clientId) => {
      const ms = getMachinesWithLive(clientId)
      const gws = getGateways(clientId)
      return {
        units: getUnits(clientId).length,
        machines: ms.length,
        gateways: gws.length,
        gatewaysOnline: gws.filter((g) => g.status === "online" || g.status === "degraded").length,
        gatewaysProblem: gws.filter((g) => g.status === "offline" || g.status === "degraded").length,
        users: getClientUsers(clientId).length,
        oee: mock.aggregateOee(ms),
        running: 0,
      }
    },
    getShiftHistory: () => [],
    getGateways,
    getGateway: (id) => f.gateways.find((g) => g.id === id),
    getDevices: (gatewayId) => f.devices.filter((d) => d.gatewayId === gatewayId),
    getDevice: (id) => f.devices.find((d) => d.id === id),
    getTags: (filter) =>
      f.tags.filter((t) => (!filter.deviceId || t.deviceId === filter.deviceId) && (!filter.machineId || t.machineId === filter.machineId)),
    getProducts: () => [],
    getShifts: (clientId, unitId) => f.shifts.filter((s) => s.clientId === clientId && (!unitId || s.unitId === unitId)),
    getDowntimeReasons: () => [],
    getUsers: () => [...f.platformUsers, ...f.users],
    getPlatformUsers: () => f.platformUsers,
    getClientUsers,
    getAuditLog: (clientId) => [...f.audit.filter((a) => !clientId || a.clientId === clientId)].sort((a, b) => b.at.localeCompare(a.at)),
    getNotifications: () => [],
    getRemoteAccessSessions: () => [],
    getRemoteAccessPolicy: () => undefined,
    getTerminals: () => [],
    getClientBranding: () => undefined,
  }
}
