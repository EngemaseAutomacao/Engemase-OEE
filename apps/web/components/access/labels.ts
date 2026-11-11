/**
 * Rótulos e utilitários PUROS das telas de conectividade e acesso
 * (gateways, CLPs, tags, usuários e auditoria). Seguros em servidor e cliente.
 */
import type {
  ClientRole,
  DataType,
  DeviceStatus,
  GatewayStatus,
  ModbusArea,
  PlatformRole,
  Protocol,
  Tag,
  TagRole,
  UserStatus,
} from "@/lib/mock/types"
import type { RemoteAccessPolicy, RemoteAccessStatus } from "@/lib/mock"

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** Normaliza para busca sem acento e sem caixa. */
export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

export const GATEWAY_STATUS_STYLE: Record<GatewayStatus, { dot: string; chip: string; border: string }> = {
  online: { dot: "bg-state-running", chip: "bg-state-running/12 text-state-running", border: "border-t-state-running" },
  degraded: { dot: "bg-state-stopped", chip: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped", border: "border-t-state-stopped" },
  offline: { dot: "bg-state-fault", chip: "bg-state-fault/12 text-state-fault", border: "border-t-state-fault" },
  pending: { dot: "bg-state-nocomm", chip: "bg-muted text-muted-foreground", border: "border-t-state-nocomm" },
}

/** Limite de desvio de relógio a partir do qual a web alerta (docs/03). */
export const CLOCK_ALERT_MS = 2000

export function clockLabel(ms: number | null): string {
  if (ms === null) return "—"
  if (Math.abs(ms) < 1000) return `${ms > 0 ? "+" : ""}${ms} ms`
  return `${ms > 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`
}

export function configLabel(published: number, applied: number | null): { text: string; tone: "ok" | "warn" | "none" } {
  if (applied === null) return { text: `v${published} · não aplicada`, tone: "none" }
  if (applied < published) return { text: `v${applied} aplicada · v${published} publicada`, tone: "warn" }
  return { text: `v${applied} · sincronizada`, tone: "ok" }
}

// ---------------------------------------------------------------------------
// Dispositivos (CLPs) e Modbus
// ---------------------------------------------------------------------------

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  "modbus-tcp": "Modbus TCP/IP",
  "modbus-rtu": "Modbus RTU · RS-485",
}

export const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = {
  connected: "Conectado",
  error: "Com erro",
  disabled: "Desativado",
}

export const DEVICE_STATUS_STYLE: Record<DeviceStatus, { dot: string; chip: string }> = {
  connected: { dot: "bg-state-running", chip: "bg-state-running/12 text-state-running" },
  error: { dot: "bg-state-fault", chip: "bg-state-fault/12 text-state-fault" },
  disabled: { dot: "bg-state-nocomm", chip: "bg-muted text-muted-foreground" },
}

export const PARITY_LABEL: Record<"N" | "E" | "O", string> = { N: "nenhuma", E: "par", O: "ímpar" }

/** "19200 bps · 8E1" */
export function serialSummary(p: { baudRate?: number; dataBits?: number; parity?: string; stopBits?: number }): string {
  return `${p.baudRate ?? "—"} bps · ${p.dataBits ?? 8}${p.parity ?? "N"}${p.stopBits ?? 1}`
}

/** Portas RS-485 do gateway a partir da descrição do hardware ("2× RS-485"). */
export function serialPortsFor(hardware: string): string[] {
  const m = hardware.match(/(\d+)\s*×\s*RS-485/)
  const n = m ? Number(m[1]) : 0
  return Array.from({ length: n }, (_, i) => `/dev/ttyRS485-${i + 1}`)
}

export const MODBUS_AREA_LABEL: Record<ModbusArea, string> = {
  coil: "Coil",
  discrete_input: "Discrete input",
  input_register: "Input register",
  holding_register: "Holding register",
}

export const MODBUS_AREA_SHORT: Record<ModbusArea, string> = {
  coil: "Coil",
  discrete_input: "DI",
  input_register: "IR",
  holding_register: "HR",
}

/** Função Modbus de leitura de cada área. */
export const MODBUS_AREA_FC: Record<ModbusArea, string> = {
  coil: "FC01",
  discrete_input: "FC02",
  input_register: "FC04",
  holding_register: "FC03",
}

/**
 * Referência na convenção clássica de 5 dígitos (endereço base 0 → base 1):
 * coil 0xxxx, discrete input 1xxxx, input register 3xxxx, holding register 4xxxx.
 */
export function modbusRef(area: ModbusArea, address: number): string {
  const base = { coil: 1, discrete_input: 10_001, input_register: 30_001, holding_register: 40_001 }[area]
  return String(base + address).padStart(5, "0")
}

export const is32 = (t: DataType) => t === "int32" || t === "uint32" || t === "float32"

export const pollLabel = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toLocaleString("pt-BR")} s` : `${ms} ms`)

export const TAG_ROLE_LABEL: Record<TagRole, string> = {
  "state.running": "Rodando",
  "state.fault": "Falha",
  "state.code": "Código de estado",
  "fault.code": "Código de falha",
  "count.total": "Contador total",
  "count.good": "Contador de boas",
  "count.reject": "Contador de refugo",
  "product.code": "Produto",
  "speed.actual": "Velocidade",
  custom: "Personalizado",
}

export const TAG_QUALITY_LABEL: Record<Tag["quality"], string> = {
  good: "Boa",
  bad: "Ruim",
  stale: "Desatualizada",
}

export const TAG_QUALITY_STYLE: Record<Tag["quality"], string> = {
  good: "bg-state-running/12 text-state-running",
  bad: "bg-state-fault/12 text-state-fault",
  stale: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
}

/** Valor de tag formatado em pt-BR (números grandes com separador, float com vírgula). */
export function formatTagValue(value: string, dataType: DataType): string {
  if (value === "—" || value === "") return "—"
  if (dataType === "bool") return value === "1" ? "1 (ligado)" : "0 (desligado)"
  const n = Number(value)
  if (Number.isNaN(n)) return value
  if (dataType === "float32") return n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })
  return n.toLocaleString("pt-BR")
}

// ---------------------------------------------------------------------------
// Comandos do gateway (docs/04)
// ---------------------------------------------------------------------------

export type CommandType = "tag.read" | "device.test" | "config.reload" | "agent.restart"
export type CommandStatus = "queued" | "sent" | "done" | "failed" | "expired"

export const COMMAND_TYPE_LABEL: Record<CommandType, string> = {
  "tag.read": "Leitura de tag",
  "device.test": "Teste de conexão",
  "config.reload": "Recarregar configuração",
  "agent.restart": "Reiniciar agente",
}

export const COMMAND_STATUS_LABEL: Record<CommandStatus, string> = {
  queued: "Na fila",
  sent: "Enviado",
  done: "Concluído",
  failed: "Falhou",
  expired: "Expirado",
}

export const COMMAND_STATUS_STYLE: Record<CommandStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  sent: "bg-primary/10 text-primary",
  done: "bg-state-running/12 text-state-running",
  failed: "bg-state-fault/12 text-state-fault",
  expired: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
}

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------

export const USER_STATUS_STYLE: Record<UserStatus, string> = {
  active: "bg-state-running/12 text-state-running",
  invited: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
  disabled: "bg-muted text-muted-foreground",
}

export const CLIENT_ROLE_ORDER: ClientRole[] = ["client_admin", "engineer", "supervisor", "operator", "viewer"]

/** Rótulo curto do papel de plataforma para menções ("suporte Engemase"). */
export const PLATFORM_ROLE_MENTION: Record<PlatformRole, string> = {
  super_admin: "super admin Engemase",
  support: "suporte Engemase",
  field_engineer: "engenheiro de campo Engemase",
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** "Ana Ribeiro" → "ana.ribeiro"; prefixo opcional ("op."). */
export function slugUser(name: string, prefix = "op."): string {
  const base = norm(name)
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 24)
  return base ? `${prefix}${base}` : ""
}

// ---------------------------------------------------------------------------
// Código de ativação (determinístico a partir de uma semente; sem Math.random)
// ---------------------------------------------------------------------------

/** Alfabeto sem caracteres ambíguos (sem 0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

/** "KX7P-42QD": 8 caracteres de uso único (docs/04), gerados de forma determinística a partir da semente. */
export function activationCode(seed: string): string {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let a = h >>> 0
  let out = ""
  for (let i = 0; i < 8; i++) {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    out += CODE_ALPHABET[Math.floor(r * CODE_ALPHABET.length)]
    if (i === 3) out += "-"
  }
  return out
}

/** Versão atual do agente distribuída pela plataforma. */
export const LATEST_AGENT = "1.2.0"

/** true se `v` for anterior a `ref` (comparação numérica por partes: 1.10.0 > 1.9.0). */
export function isOlderVersion(v: string, ref: string = LATEST_AGENT): boolean {
  const a = v.split(".").map(Number)
  const b = ref.split(".").map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d < 0
  }
  return false
}

// ---------------------------------------------------------------------------
// Acesso remoto (VPN de manutenção, docs/12)
// ---------------------------------------------------------------------------

/** Status de sessão na interface: os do mock + "cancelada" (pedido retirado por quem pediu, docs/12). */
export type SessionStatus = RemoteAccessStatus | "cancelled"

export const REMOTE_STATUS_LABEL: Record<SessionStatus, string> = {
  requested: "Aguardando aprovação",
  cancelled: "Cancelada",
  approved: "Aprovada",
  active: "Ativa",
  ended: "Encerrada",
  rejected: "Recusada",
  expired_unapproved: "Expirou sem aprovação",
  revoked: "Revogada",
}

export const REMOTE_STATUS_STYLE: Record<SessionStatus, string> = {
  requested: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
  cancelled: "bg-muted text-muted-foreground",
  approved: "bg-primary/10 text-primary",
  active: "bg-state-running/12 text-state-running",
  ended: "bg-muted text-muted-foreground",
  rejected: "bg-state-fault/12 text-state-fault",
  expired_unapproved: "bg-muted text-muted-foreground",
  revoked: "bg-state-fault/12 text-state-fault",
}

export const REMOTE_POLICY_LABEL: Record<RemoteAccessPolicy["mode"], string> = {
  disabled: "Desativado",
  approval_required: "Com aprovação do cliente",
  preapproved_window: "Janela pré-aprovada",
}

/** Portas permitidas para encaminhamento a um CLP (lista fechada por protocolo). */
export const FORWARD_PORTS: { port: number; label: string }[] = [
  { port: 502, label: "502 · Modbus TCP" },
  { port: 102, label: "102 · Siemens S7" },
  { port: 44818, label: "44818 · EtherNet/IP" },
]

export const WEEKDAY_LABEL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"]

/** 30 → "30 min", 60 → "1 h", 90 → "1 h 30 min" */
export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** 4812000 → "4,8 MB" */
export function bytesLabel(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—"
  if (n < 1_000) return `${n} B`
  if (n < 1_000_000) return `${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kB`
  return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
}

/** 3725 → "01:02:05" (contagem regressiva) */
export function clockCountdown(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return [h, m, ss].map((x) => String(x).padStart(2, "0")).join(":")
}
