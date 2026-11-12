/**
 * Tipos do domínio usados pelo protótipo de interface.
 * Espelham o modelo de dados de docs/06-banco-de-dados.md (nomes em inglês no código,
 * textos da interface em português).
 */

export type MachineState =
  | "RUNNING" // Produzindo
  | "STOPPED" // Parada não planejada
  | "FAULT" // Falha
  | "SETUP" // Setup / troca
  | "PLANNED_STOP" // Parada planejada
  | "NO_COMM" // Sem comunicação

export type PlatformRole = "super_admin" | "support" | "field_engineer"
export type ClientRole = "client_admin" | "engineer" | "supervisor" | "operator" | "viewer"

export type ClientStatus = "active" | "onboarding" | "suspended"
export type ClientPlan = "starter" | "pro" | "enterprise"

export interface Client {
  id: string
  slug: string
  name: string
  legalName: string
  cnpj: string
  city: string
  state: string
  status: ClientStatus
  /** Assinatura do software cobrada por máquina (D1); `limits.machines` = máquinas contratadas. */
  plan: ClientPlan
  limits: { machines: number; gateways: number; users: number; retentionMonths: number }
  contactName: string
  contactEmail: string
  createdAt: string
}

export interface Unit {
  id: string
  clientId: string
  name: string
  city: string
  state: string
  timezone: string
}

export interface Area {
  id: string
  clientId: string
  unitId: string
  name: string
}

export interface Line {
  id: string
  clientId: string
  unitId: string
  areaId: string
  name: string
  code: string
}

/** "modbus-rtu-over-tcp": quadro RTU (com CRC) dentro de TCP, típico de conversores serial↔Ethernet. */
export type Protocol = "modbus-tcp" | "modbus-rtu" | "modbus-rtu-over-tcp"

/** Protocolos que usam endereço de rede (IP e porta) em vez de porta serial. */
export const isNetworkProtocol = (p: Protocol) => p !== "modbus-rtu"
export type StateMode = "signals" | "state_code" | "count_derived"

export interface Machine {
  id: string
  clientId: string
  unitId: string
  lineId: string
  name: string
  code: string
  type: string
  gatewayId: string | null
  deviceId: string | null
  idealCycleS: number
  microStopThresholdS: number
  stateMode: StateMode
  active: boolean
}

export interface OeeValues {
  availability: number
  performance: number
  quality: number
  oee: number
}

export interface MachineLive {
  machineId: string
  state: MachineState
  stateSince: string
  faultCode?: number
  faultText?: string
  productCode: string
  productName: string
  countShift: number
  rejectShift: number
  targetShift: number
  shift: OeeValues
  /**
   * Base do cálculo do turno (docs/07), para agregar linha/unidade corretamente:
   * OEE agregado = Σ(boas × ciclo ideal) ÷ Σ tempo planejado (nunca média simples).
   */
  basis?: { plannedS: number; runS: number; total: number; good: number; idealS: number; goodIdealS: number }
  lastUpdate: string
  stale: boolean
}

export type GatewayStatus = "online" | "degraded" | "offline" | "pending"

export interface Gateway {
  id: string
  clientId: string
  unitId: string
  name: string
  hostname: string
  hardware: string
  status: GatewayStatus
  lastSeen: string | null
  agentVersion: string | null
  configVersion: number
  configApplied: number | null
  bufferPending: number
  cpuPct: number | null
  memMb: number | null
  diskFreePct: number | null
  clockOffsetMs: number | null
  ipIt: string | null
  ipOt: string | null
  uptimeS: number | null
  enrollmentCode?: string
}

export type DeviceStatus = "connected" | "error" | "disabled"

export interface Device {
  id: string
  gatewayId: string
  name: string
  protocol: Protocol
  /** Modbus TCP: host/port. Modbus RTU: serial. Sempre: unitId (endereço do escravo). */
  params: {
    host?: string
    port?: number
    serialPort?: string
    baudRate?: number
    parity?: "N" | "E" | "O"
    dataBits?: 8
    stopBits?: 1 | 2
    unitId: number
    timeoutMs: number
  }
  status: DeviceStatus
  latencyMs: number | null
  errors1m: number
  lastError?: string
}

export type TagRole =
  | "state.running"
  | "state.fault"
  | "state.code"
  | "fault.code"
  | "count.total"
  | "count.good"
  | "count.reject"
  | "product.code"
  | "speed.actual"
  | "plc.heartbeat"
  | "custom"

export type ModbusArea = "coil" | "discrete_input" | "input_register" | "holding_register"
export type DataType = "bool" | "int16" | "uint16" | "int32" | "uint32" | "float32"
export type ByteOrder = "ABCD" | "CDAB" | "BADC" | "DCBA"

export interface Tag {
  id: string
  deviceId: string
  machineId: string
  name: string
  role: TagRole
  area: ModbusArea
  /** Endereço base 0 (o protocolo). A interface também mostra a convenção 4xxxx/3xxxx. */
  address: number
  dataType: DataType
  byteOrder: ByteOrder
  pollMs: number
  lastValue: string
  quality: "good" | "bad" | "stale"
}

export type UserStatus = "active" | "invited" | "disabled"

/**
 * Escopo do vínculo (docs/15 §2, decisão D11): todo o cliente, algumas unidades ou algumas máquinas.
 * Fail-closed: lista vazia = nenhum acesso. Agregados (OEE de linha/unidade, relatórios,
 * exportações) só somam as máquinas que o escopo permite.
 */
export type MemberScope = { kind: "all" } | { kind: "units"; unitIds: string[] } | { kind: "machines"; machineIds: string[] }

export type MemberScopeKind = MemberScope["kind"]

export interface Membership {
  clientId: string
  role: ClientRole
  scope: MemberScope
}

export interface User {
  id: string
  name: string
  email: string | null
  username: string | null
  platformRole: PlatformRole | null
  memberships: Membership[]
  status: UserStatus
  lastLoginAt: string | null
  twoFactor: boolean
}

export interface Product {
  id: string
  clientId: string
  code: string
  name: string
  idealCycles: { machineId: string; idealCycleS: number }[]
}

export interface Shift {
  id: string
  clientId: string
  unitId: string
  name: string
  start: string // "06:00"
  end: string // "14:00"
  days: number[] // 0 = domingo
  breaks: { name: string; start: string; end: string }[]
}

export type ReasonCategory = "unplanned" | "planned" | "setup"

export interface DowntimeReason {
  id: string
  clientId: string
  parentId: string | null
  name: string
  category: ReasonCategory
}

export interface StateEvent {
  machineId: string
  state: MachineState
  start: string
  end: string
  reasonId: string | null
  faultCode?: number
}

export interface HourlyProduction {
  hour: string // ISO do início da hora
  total: number
  reject: number
  target: number
}

export interface DailyOee extends OeeValues {
  date: string // YYYY-MM-DD
}

export interface ParetoItem {
  reasonId: string
  reasonName: string
  category: ReasonCategory
  minutes: number
  occurrences: number
}

export interface AuditEntry {
  id: string
  clientId: string | null
  actorName: string
  impersonatedBy: string | null
  action: string
  entity: string
  entityName: string
  at: string
  details?: string
}
