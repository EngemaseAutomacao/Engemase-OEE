/**
 * Rótulos, constantes e utilitários PUROS das telas de cadastro (configurações).
 * Podem ser usados em componentes de servidor e de cliente (não acessam o relógio).
 */
import type {
  ByteOrder,
  DataType,
  GatewayStatus,
  MachineState,
  ModbusArea,
  Protocol,
  ReasonCategory,
  StateMode,
  TagRole,
} from "@/lib/mock/types"

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
// Estrutura (unidades e linhas)
// ---------------------------------------------------------------------------

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const

/** Fusos IANA do Brasil mais usados (o cálculo de turnos usa sempre o fuso da unidade). */
export const TIMEZONES: { id: string; label: string }[] = [
  { id: "America/Sao_Paulo", label: "Brasília (UTC−3) · America/Sao_Paulo" },
  { id: "America/Bahia", label: "Salvador (UTC−3) · America/Bahia" },
  { id: "America/Fortaleza", label: "Fortaleza (UTC−3) · America/Fortaleza" },
  { id: "America/Recife", label: "Recife (UTC−3) · America/Recife" },
  { id: "America/Belem", label: "Belém (UTC−3) · America/Belem" },
  { id: "America/Manaus", label: "Manaus (UTC−4) · America/Manaus" },
  { id: "America/Cuiaba", label: "Cuiabá (UTC−4) · America/Cuiaba" },
  { id: "America/Porto_Velho", label: "Porto Velho (UTC−4) · America/Porto_Velho" },
  { id: "America/Rio_Branco", label: "Rio Branco (UTC−5) · America/Rio_Branco" },
  { id: "America/Noronha", label: "Fernando de Noronha (UTC−2) · America/Noronha" },
]

export const timezoneShort = (tz: string) => TIMEZONES.find((t) => t.id === tz)?.label.split(" · ")[0] ?? tz

export const MACHINE_TYPES = [
  "Injetora",
  "Sopradora",
  "Extrusora",
  "Termoformadora",
  "Prensa excêntrica",
  "Prensa hidráulica",
  "Centro de usinagem",
  "Torno CNC",
  "Envasadora",
  "Rotuladora",
  "Seladora",
  "Tear",
]

// ---------------------------------------------------------------------------
// Gateway e Modbus
// ---------------------------------------------------------------------------

export const GATEWAY_STATUS_DOT: Record<GatewayStatus, string> = {
  online: "bg-state-running",
  degraded: "bg-state-stopped",
  offline: "bg-state-fault",
  pending: "bg-state-nocomm",
}

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  "modbus-tcp": "Modbus TCP/IP",
  "modbus-rtu": "Modbus RTU · RS-485",
  "modbus-rtu-over-tcp": "Modbus RTU sobre TCP",
}

export const PROTOCOL_SHORT: Record<Protocol, string> = {
  "modbus-tcp": "TCP",
  "modbus-rtu": "RTU",
  "modbus-rtu-over-tcp": "RTU/TCP",
}

export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const

export const PARITY_LABEL: Record<"N" | "E" | "O", string> = { N: "Nenhuma", E: "Par", O: "Ímpar" }

/**
 * Portas RS-485 isoladas do gateway padrão (reComputer R1000, docs/03): o borne RS485-n
 * corresponde a um dispositivo do Linux. A correspondência final é confirmada em bancada.
 */
export const RS485_TTY = ["/dev/ttyAMA2", "/dev/ttyAMA3", "/dev/ttyAMA5"] as const

/** Dispositivos `/dev/ttyAMA*` disponíveis no gateway conforme a descrição do hardware ("3× RS-485"). */
export function ttyPortsFor(hardware: string): string[] {
  const m = hardware.match(/(\d+)\s*×\s*RS-485/)
  const n = Math.min(RS485_TTY.length, m ? Number(m[1]) : 0)
  return RS485_TTY.slice(0, n)
}

/** Converte o nome lógico antigo "/dev/ttyRS485-1" no dispositivo do Linux ("/dev/ttyAMA2"); "/dev/ttyAMA*" passa direto. */
export function ttyFromSerial(serialPort: string | undefined): string | undefined {
  const m = serialPort?.match(/ttyRS485-(\d+)$/)
  if (!m) return serialPort
  return RS485_TTY[Number(m[1]) - 1] ?? serialPort
}

/** "RS485-1" a partir de "/dev/ttyAMA2". */
export function rs485Label(tty: string): string {
  const i = (RS485_TTY as readonly string[]).indexOf(tty)
  return i >= 0 ? `RS485-${i + 1}` : tty
}

/** Portas seriais RS-485 do gateway a partir da descrição do hardware ("3× RS-485"): mesmos dispositivos de `ttyPortsFor`. */
export function serialPortsFor(hardware: string): string[] {
  return ttyPortsFor(hardware)
}

/** "19200 bps · 8E1" */
export function serialSummary(p: { baudRate?: number; dataBits?: number; parity?: string; stopBits?: number }): string {
  return `${p.baudRate ?? "—"} bps · ${p.dataBits ?? 8}${p.parity ?? "N"}${p.stopBits ?? 1}`
}

export const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export const MODBUS_AREAS: ModbusArea[] = ["coil", "discrete_input", "input_register", "holding_register"]

export const MODBUS_AREA_LABEL: Record<ModbusArea, string> = {
  coil: "Coil",
  discrete_input: "Discrete input",
  input_register: "Input register",
  holding_register: "Holding register",
}

/** Função Modbus de leitura de cada área. */
export const MODBUS_AREA_FC: Record<ModbusArea, string> = {
  coil: "FC01",
  discrete_input: "FC02",
  input_register: "FC04",
  holding_register: "FC03",
}

export const isBitArea = (a: ModbusArea) => a === "coil" || a === "discrete_input"

/**
 * Referência na convenção clássica de 5 dígitos (endereço base 0 → base 1):
 * coil 0xxxx, discrete input 1xxxx, input register 3xxxx, holding register 4xxxx.
 */
export function modbusRef(area: ModbusArea, address: number): string {
  const base = { coil: 1, discrete_input: 10_001, input_register: 30_001, holding_register: 40_001 }[area]
  return String(base + address).padStart(5, "0")
}

export const DATA_TYPES: DataType[] = ["bool", "int16", "uint16", "int32", "uint32", "float32"]

export const is32 = (t: DataType) => t === "int32" || t === "uint32" || t === "float32"

/** Quantos registradores de 16 bits o tipo ocupa. */
export const registersFor = (t: DataType) => (is32(t) ? 2 : 1)

export const BYTE_ORDERS: { id: ByteOrder; hint: string }[] = [
  { id: "ABCD", hint: "Big-endian (word alta primeiro)" },
  { id: "CDAB", hint: "Word baixa primeiro (comum em CLPs)" },
  { id: "BADC", hint: "Bytes trocados em cada word" },
  { id: "DCBA", hint: "Little-endian completo" },
]

export const POLL_INTERVALS = [250, 500, 1000, 2000, 5000] as const

export const pollLabel = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toLocaleString("pt-BR")} s` : `${ms} ms`)

/** Papéis oferecidos no assistente, na ordem em que aparecem. */
export const WIZARD_TAG_ROLES: TagRole[] = [
  "state.running",
  "state.fault",
  "state.code",
  "fault.code",
  "count.total",
  "count.reject",
  "count.good",
  "product.code",
  "speed.actual",
  "custom",
]

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
  "plc.heartbeat": "Heartbeat do CLP",
  custom: "Personalizado",
}

/** Registro e tipo sugeridos ao escolher um papel. */
export const ROLE_DEFAULTS: Record<TagRole, { area: ModbusArea; dataType: DataType; pollMs: number; name: string }> = {
  "state.running": { area: "coil", dataType: "bool", pollMs: 250, name: "Máquina em ciclo automático" },
  "state.fault": { area: "coil", dataType: "bool", pollMs: 250, name: "Alarme ativo" },
  "state.code": { area: "holding_register", dataType: "uint16", pollMs: 500, name: "Estado da máquina" },
  "fault.code": { area: "holding_register", dataType: "uint16", pollMs: 500, name: "Código do alarme" },
  "count.total": { area: "holding_register", dataType: "uint32", pollMs: 500, name: "Contador de ciclos" },
  "count.good": { area: "holding_register", dataType: "uint32", pollMs: 500, name: "Contador de peças boas" },
  "count.reject": { area: "holding_register", dataType: "uint32", pollMs: 500, name: "Contador de refugo" },
  "product.code": { area: "holding_register", dataType: "uint16", pollMs: 1000, name: "Receita / produto atual" },
  "speed.actual": { area: "holding_register", dataType: "uint16", pollMs: 1000, name: "Velocidade atual" },
  "plc.heartbeat": { area: "holding_register", dataType: "uint16", pollMs: 1000, name: "Heartbeat do CLP" },
  custom: { area: "holding_register", dataType: "uint16", pollMs: 1000, name: "" },
}

// ---------------------------------------------------------------------------
// Regras de OEE
// ---------------------------------------------------------------------------

export const STATE_MODE_LABEL: Record<StateMode, string> = {
  signals: "Sinais do CLP",
  state_code: "Código de estado",
  count_derived: "Derivado da contagem",
}

export const STATE_MODE_HINT: Record<StateMode, string> = {
  signals: "Usa os sinais Rodando e Falha. Falha tem prioridade; nenhum dos dois ativo indica parada.",
  state_code: "Mapeia o registrador de estado do CLP (ex.: 1 = automático, 2 = alarme) para os estados de OEE.",
  count_derived: "Para máquinas só com contador (retrofit com módulo de I/O): produzindo se houve peça nos últimos N ciclos ideais.",
}

/** Papéis exigidos por modo de estado. */
export const REQUIRED_ROLES: Record<StateMode, TagRole[]> = {
  signals: ["state.running", "count.total"],
  state_code: ["state.code", "count.total"],
  count_derived: ["count.total"],
}

/** Mapa padrão do registrador de estado (bloco OEE padrão Engemase, docs/11). */
export const DEFAULT_STATE_MAP: { code: number; label: string; state: Exclude<MachineState, "NO_COMM"> }[] = [
  { code: 0, label: "Parada", state: "STOPPED" },
  { code: 1, label: "Produzindo", state: "RUNNING" },
  { code: 2, label: "Falha", state: "FAULT" },
  { code: 3, label: "Setup", state: "SETUP" },
  { code: 4, label: "Manual", state: "STOPPED" },
  { code: 5, label: "Emergência", state: "FAULT" },
]

/** "≈ 200 pç/h" a partir do ciclo ideal em segundos. */
export function piecesPerHour(cycleS: number): string {
  if (!cycleS || cycleS <= 0) return "—"
  return `≈ ${Math.round(3600 / cycleS).toLocaleString("pt-BR")} pç/h`
}

/** "18 s", "1,2 s" */
export const seconds = (s: number) => `${s.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} s`

// ---------------------------------------------------------------------------
// Motivos de parada
// ---------------------------------------------------------------------------

export const REASON_CATEGORIES: ReasonCategory[] = ["unplanned", "setup", "planned"]

export const REASON_CATEGORY_META: Record<
  ReasonCategory,
  { label: string; effect: string; state: MachineState; chip: string; dot: string; bar: string }
> = {
  unplanned: {
    label: "Não planejada",
    effect: "Reduz a disponibilidade. O operador classifica as paradas acima do limite de micro-parada.",
    state: "STOPPED",
    chip: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
    dot: "bg-state-stopped",
    bar: "border-l-state-stopped",
  },
  setup: {
    label: "Setup",
    effect: "Reduz a disponibilidade e aparece separada nos relatórios para acompanhar o SMED.",
    state: "SETUP",
    chip: "bg-state-setup/12 text-state-setup",
    dot: "bg-state-setup",
    bar: "border-l-state-setup",
  },
  planned: {
    label: "Planejada",
    effect: "Sai do tempo planejado: não penaliza o OEE (refeição, preventiva, sem programação).",
    state: "PLANNED_STOP",
    chip: "bg-state-planned/15 text-state-planned",
    dot: "bg-state-planned",
    bar: "border-l-state-planned",
  },
}

/** Paleta para os grupos de motivo (cores do Pareto). Distinta das cores de estado. */
export const REASON_PALETTE = ["#2563eb", "#0891b2", "#ea580c", "#7c3aed", "#db2777", "#059669", "#ca8a04", "#64748b"]

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------

/** 0 = domingo (igual a Date.getDay). Exibição começando na segunda. */
export const WEEKDAYS: { d: number; short: string; label: string }[] = [
  { d: 1, short: "S", label: "Seg" },
  { d: 2, short: "T", label: "Ter" },
  { d: 3, short: "Q", label: "Qua" },
  { d: 4, short: "Q", label: "Qui" },
  { d: 5, short: "S", label: "Sex" },
  { d: 6, short: "S", label: "Sáb" },
  { d: 0, short: "D", label: "Dom" },
]

/** "06:00" → 360 */
export function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** 360 → "06:00" */
export function minToHm(min: number): string {
  const v = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`
}

/** Duração em minutos de um intervalo de relógio (passa da meia-noite se fim ≤ início). */
export function spanMin(start: string, end: string): number {
  const s = hmToMin(start)
  const e = hmToMin(end)
  return e > s ? e - s : e + 1440 - s
}

/** "7h 30min", "8h", "45 min" */
export function hoursLabel(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}min`
}

/** Resumo dos dias: "Seg a Sex", "Seg a Sáb", "Todos os dias" ou lista. */
export function daysSummary(days: number[]): string {
  const set = new Set(days)
  if (set.size === 7) return "Todos os dias"
  if (set.size === 0) return "Nenhum dia"
  const ordered = WEEKDAYS.filter((w) => set.has(w.d))
  const idx = ordered.map((w) => WEEKDAYS.indexOf(w))
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
  if (contiguous && ordered.length >= 3) return `${ordered[0].label} a ${ordered[ordered.length - 1].label}`
  return ordered.map((w) => w.label).join(", ")
}

/** Cores dos turnos na régua (tons neutros-azulados, legíveis no claro e no escuro). */
export const SHIFT_COLORS = ["bg-sky-500", "bg-indigo-500", "bg-teal-500", "bg-violet-500", "bg-cyan-600", "bg-blue-700"]
