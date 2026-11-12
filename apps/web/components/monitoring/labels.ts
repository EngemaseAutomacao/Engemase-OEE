/**
 * Rótulos e utilitários PUROS das telas de monitoramento.
 * Podem ser usados em componentes de servidor e de cliente (não acessam o relógio).
 */
import type {
  DeviceStatus,
  DowntimeReason,
  GatewayStatus,
  MachineState,
  ModbusArea,
  Protocol,
  ReasonCategory,
  StateMode,
  TagRole,
} from "@/lib/mock/types"
import { dec, num } from "@/lib/format"

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  "modbus-tcp": "Modbus TCP/IP",
  "modbus-rtu": "Modbus RTU · RS-485",
  "modbus-rtu-over-tcp": "Modbus RTU sobre TCP",
}

export const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = {
  connected: "Conectado",
  error: "Com erro",
  disabled: "Desativado",
}

export const DEVICE_STATUS_DOT: Record<DeviceStatus, string> = {
  connected: "bg-state-running",
  error: "bg-state-fault",
  disabled: "bg-state-nocomm",
}

export const GATEWAY_STATUS_DOT: Record<GatewayStatus, string> = {
  online: "bg-state-running",
  degraded: "bg-state-stopped",
  offline: "bg-state-fault",
  pending: "bg-state-nocomm",
}

export const STATE_MODE_LABEL: Record<StateMode, string> = {
  signals: "Sinais do CLP (rodando / falha)",
  state_code: "Código de estado do CLP",
  count_derived: "Derivado da contagem de pulsos",
}

export const TAG_ROLE_LABEL: Record<TagRole, string> = {
  "state.running": "Rodando",
  "state.fault": "Falha",
  "state.code": "Código de estado",
  "fault.code": "Código de alarme",
  "count.total": "Contagem total",
  "count.good": "Peças boas",
  "count.reject": "Refugo",
  "product.code": "Produto / receita",
  "speed.actual": "Velocidade",
  "plc.heartbeat": "Heartbeat do CLP",
  custom: "Personalizada",
}

export const MODBUS_AREA_LABEL: Record<ModbusArea, string> = {
  coil: "Coil",
  discrete_input: "Entrada discreta",
  input_register: "Input register",
  holding_register: "Holding register",
}

export const TAG_QUALITY_LABEL = { good: "Boa", bad: "Sem leitura", stale: "Desatualizada" } as const

export const REASON_CATEGORY_LABEL: Record<ReasonCategory, string> = {
  unplanned: "Não planejada",
  setup: "Setup",
  planned: "Planejada",
}

/** Estados que contam como parada (aparecem na tabela de paradas). */
export const STOP_STATES: MachineState[] = ["STOPPED", "FAULT", "SETUP", "PLANNED_STOP", "NO_COMM"]

/**
 * Referência Modbus na convenção clássica de 5 dígitos (endereço base 0 → 1-based):
 * coil 0xxxx, entrada discreta 1xxxx, input register 3xxxx, holding register 4xxxx.
 */
export function modbusRef(area: ModbusArea, address: number): string {
  const base = { coil: 1, discrete_input: 10_001, input_register: 30_001, holding_register: 40_001 }[area]
  return String(base + address).padStart(5, "0")
}

/** "19200 bps · 8E1" */
export function serialSummary(p: { baudRate?: number; dataBits?: number; parity?: string; stopBits?: number }): string {
  return `${p.baudRate ?? "—"} bps · ${p.dataBits ?? 8}${p.parity ?? "N"}${p.stopBits ?? 1}`
}

/** Valor bruto da tag formatado para leitura humana. */
export function formatTagValue(value: string, dataType: string, role?: TagRole): string {
  if (value === "—" || value === "") return "—"
  if (role === "product.code" || role === "state.code" || role === "fault.code") return value
  if (dataType === "bool") return value === "1" ? "1 · ligado" : "0 · desligado"
  const n = Number(value)
  if (Number.isNaN(n)) return value
  if (dataType === "float32") return dec(n)
  return num(n)
}

/** Caminho do motivo na árvore: "Mecânica › Quebra / ajuste de molde". */
export function reasonPathMap(reasons: DowntimeReason[]): Record<string, string> {
  const byId = new Map(reasons.map((r) => [r.id, r]))
  const out: Record<string, string> = {}
  for (const r of reasons) {
    const parent = r.parentId ? byId.get(r.parentId) : undefined
    out[r.id] = parent ? `${parent.name} › ${r.name}` : r.name
  }
  return out
}

/** Chave estável de um evento de estado (máquina + início). */
export const eventKey = (e: { machineId: string; start: string }) => `${e.machineId}@${e.start}`
