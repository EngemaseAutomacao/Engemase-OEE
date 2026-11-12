/**
 * Modelo do assistente "Nova máquina": tipos dos rascunhos, templates de sinais e validações.
 * Funções puras (sem relógio e sem aleatoriedade), seguras em servidor e cliente.
 */
import { isNetworkProtocol, type ByteOrder, type DataType, type GatewayStatus, type MachineState, type ModbusArea, type Protocol, type StateMode, type TagRole } from "@/lib/mock/types"
import {
  DEFAULT_STATE_MAP,
  IPV4_RE,
  REQUIRED_ROLES,
  TAG_ROLE_LABEL,
  is32,
  isBitArea,
  modbusRef,
  registersFor,
  serialSummary,
} from "@/components/config/labels"

// ---------------------------------------------------------------------------
// Dados de entrada (vindos do servidor)
// ---------------------------------------------------------------------------

export interface WizardUnit {
  id: string
  name: string
}
export interface WizardLine {
  id: string
  unitId: string
  areaName: string
  name: string
  code: string
}
export interface WizardGateway {
  id: string
  unitId: string
  name: string
  hostname: string
  status: GatewayStatus
  configVersion: number
  serialPorts: string[]
  ipOt: string | null
}
export interface WizardDevice {
  id: string
  gatewayId: string
  name: string
  protocol: Protocol
  host?: string
  port?: number
  serialPort?: string
  baudRate?: number
  parity?: "N" | "E" | "O"
  dataBits?: 8
  stopBits?: 1 | 2
  unitId: number
}
export interface TagSpec {
  name: string
  role: TagRole
  area: ModbusArea
  address: number
  dataType: DataType
  byteOrder: ByteOrder
  pollMs: number
}
export interface MachineTemplate {
  id: string
  label: string
  description: string
  /** Tipo de máquina de origem (para sugerir templates de "máquina igual"). */
  machineType?: string
  stateMode: StateMode
  idealCycleS?: number
  tags: TagSpec[]
}

// ---------------------------------------------------------------------------
// Rascunhos (estado local do assistente)
// ---------------------------------------------------------------------------

export interface IdentDraft {
  name: string
  code: string
  type: string
  unitId: string
  lineId: string
}

export interface ConnDraft {
  gatewayId: string
  protocol: Protocol
  host: string
  port: string
  tcpUnitId: string
  tcpTimeout: string
  serialPort: string
  baudRate: number
  parity: "N" | "E" | "O"
  dataBits: 8
  stopBits: 1 | 2
  rtuUnitId: string
  rtuTimeout: string
}

export interface TagDraft {
  key: string
  name: string
  role: TagRole
  area: ModbusArea
  address: string
  dataType: DataType
  byteOrder: ByteOrder
  pollMs: number
  lastValue: string | null
  lastLatencyMs: number | null
}

export interface StateMapRow {
  key: string
  code: string
  label: string
  state: Exclude<MachineState, "NO_COMM">
}

export interface RulesDraft {
  stateMode: StateMode
  idealCycleS: string
  microStopS: string
  debounceS: string
  commLossS: string
  idleAfterCycles: string
  stateMap: StateMapRow[]
}

export const emptyIdent = (unitId: string, lineId: string): IdentDraft => ({ name: "", code: "", type: "", unitId, lineId })

export const defaultConn = (gatewayId: string): ConnDraft => ({
  gatewayId,
  protocol: "modbus-tcp",
  host: "",
  port: "502",
  tcpUnitId: "1",
  tcpTimeout: "1000",
  serialPort: "",
  baudRate: 19200,
  parity: "E",
  dataBits: 8,
  stopBits: 1,
  rtuUnitId: "",
  rtuTimeout: "500",
})

export const defaultStateMap = (): StateMapRow[] =>
  DEFAULT_STATE_MAP.map((r) => ({ key: `sm${r.code}`, code: String(r.code), label: r.label, state: r.state }))

export const defaultRules = (): RulesDraft => ({
  stateMode: "signals",
  idealCycleS: "",
  microStopS: "60",
  debounceS: "2",
  commLossS: "10",
  idleAfterCycles: "3",
  stateMap: defaultStateMap(),
})

export const toNum = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(",", ".")))
const isInt = (v: string, min: number, max: number) => {
  const n = toNum(v)
  return Number.isInteger(n) && n >= min && n <= max
}

export function tagFromSpec(spec: TagSpec, key: string): TagDraft {
  return { ...spec, key, address: String(spec.address), lastValue: null, lastLatencyMs: null }
}

// ---------------------------------------------------------------------------
// Templates prontos
// ---------------------------------------------------------------------------

/** Bloco OEE padrão Engemase (docs/11, seção 3): offsets 0–13 lidos numa única transação FC03. */
export const BLOCK_REGISTERS = 14
export const DEFAULT_BLOCK_BASE = 1000
/** Maior endereço base que ainda comporta os 14 registradores. */
export const MAX_BLOCK_BASE = 65535 - (BLOCK_REGISTERS - 1)

/** Layout do bloco: offset, papel, nome e tipo de cada campo. */
export const ENGEMASE_BLOCK_LAYOUT: { offset: number; field: string; name: string; role: TagRole; dataType: DataType }[] = [
  { offset: 0, field: "versao_bloco", name: "Versão do bloco", role: "custom", dataType: "uint16" },
  { offset: 1, field: "heartbeat", name: "Heartbeat do CLP", role: "custom", dataType: "uint16" },
  { offset: 2, field: "estado", name: "Estado da máquina", role: "state.code", dataType: "uint16" },
  { offset: 3, field: "codigo_falha", name: "Código do alarme", role: "fault.code", dataType: "uint16" },
  { offset: 4, field: "contador_total", name: "Contador total", role: "count.total", dataType: "uint32" },
  { offset: 6, field: "contador_refugo", name: "Contador de refugo", role: "count.reject", dataType: "uint32" },
  { offset: 8, field: "contador_bons", name: "Contador de peças boas", role: "count.good", dataType: "uint32" },
  { offset: 10, field: "produto", name: "Produto / receita", role: "product.code", dataType: "uint16" },
  { offset: 11, field: "velocidade", name: "Velocidade atual", role: "speed.actual", dataType: "uint16" },
  { offset: 12, field: "ciclo_ultimo_ms", name: "Duração do último ciclo (ms)", role: "custom", dataType: "uint16" },
  { offset: 13, field: "bits_status", name: "Bits de status", role: "custom", dataType: "uint16" },
]

/** Template do bloco a partir de um endereço base (holding register, base 0). */
export function engemaseBlock(base: number = DEFAULT_BLOCK_BASE): MachineTemplate {
  return {
    id: `tpl_engemase_block_${base}`,
    label: "Bloco OEE padrão Engemase",
    description: `${BLOCK_REGISTERS} holding registers contíguos a partir do HR ${base} (1 leitura por máquina). Modo código de estado.`,
    stateMode: "state_code",
    tags: ENGEMASE_BLOCK_LAYOUT.map((f) => ({
      name: f.name,
      role: f.role,
      area: "holding_register",
      address: base + f.offset,
      dataType: f.dataType,
      byteOrder: is32(f.dataType) ? "CDAB" : "ABCD",
      pollMs: 500,
    })),
  }
}

export const ENGEMASE_BLOCK: MachineTemplate = engemaseBlock(DEFAULT_BLOCK_BASE)

export const DISCRETE_SIGNALS: MachineTemplate = {
  id: "tpl_discrete",
  label: "Sinais discretos + contadores",
  description: "Coils de rodando e falha, contadores de 32 bits em holding registers. Modo sinais do CLP.",
  stateMode: "signals",
  tags: [
    { name: "Máquina em ciclo automático", role: "state.running", area: "coil", address: 0, dataType: "bool", byteOrder: "ABCD", pollMs: 250 },
    { name: "Alarme ativo", role: "state.fault", area: "coil", address: 1, dataType: "bool", byteOrder: "ABCD", pollMs: 250 },
    { name: "Código do alarme", role: "fault.code", area: "holding_register", address: 10, dataType: "uint16", byteOrder: "ABCD", pollMs: 500 },
    { name: "Contador de ciclos", role: "count.total", area: "holding_register", address: 100, dataType: "uint32", byteOrder: "CDAB", pollMs: 500 },
    { name: "Contador de refugo", role: "count.reject", area: "holding_register", address: 102, dataType: "uint32", byteOrder: "CDAB", pollMs: 500 },
  ],
}

export const IO_RETROFIT: MachineTemplate = {
  id: "tpl_io_retrofit",
  label: "Retrofit com módulo de I/O",
  description: "Só o contador de pulsos de hardware do módulo (entrada DI0). Estado derivado da contagem.",
  stateMode: "count_derived",
  tags: [
    { name: "Contador de pulsos (DI0)", role: "count.total", area: "input_register", address: 16, dataType: "uint32", byteOrder: "CDAB", pollMs: 500 },
  ],
}

/** Outros templates prontos (o bloco padrão tem cartão próprio, com endereço base). */
export const BUILTIN_TEMPLATES = [DISCRETE_SIGNALS, IO_RETROFIT]

// ---------------------------------------------------------------------------
// Validações por etapa
// ---------------------------------------------------------------------------

export type Errors = Record<string, string | null>
export const hasErrors = (e: Errors) => Object.values(e).some(Boolean)

export function validateIdent(d: IdentDraft, existingCodes: string[]): Errors {
  const code = d.code.trim().toUpperCase()
  return {
    name: d.name.trim().length < 3 ? "Informe o nome da máquina (mín. 3 caracteres)." : null,
    code: !/^[A-Z0-9][A-Z0-9-]{1,15}$/.test(code)
      ? "Use de 2 a 16 caracteres: letras, números e hífen."
      : existingCodes.some((c) => c.toUpperCase() === code)
        ? "Já existe uma máquina com este código."
        : null,
    type: !d.type ? "Escolha o tipo de máquina." : null,
    unitId: !d.unitId ? "Escolha a unidade." : null,
    lineId: !d.lineId ? "Escolha a linha." : null,
  }
}

export function validateConn(c: ConnDraft, gateway: WizardGateway | undefined, busDevices: WizardDevice[]): Errors {
  if (!gateway) return { gatewayId: "Escolha o gateway da unidade." }
  if (isNetworkProtocol(c.protocol)) {
    const rtuOverTcp = c.protocol === "modbus-rtu-over-tcp"
    return {
      host: !IPV4_RE.test(c.host.trim()) ? "Informe um IPv4 válido (ex.: 192.168.10.25)." : null,
      port: !isInt(c.port, 1, 65535) ? "Porta de 1 a 65535 (padrão 502)." : null,
      // No RTU sobre TCP o unit ID é o endereço do escravo no barramento atrás do conversor.
      tcpUnitId: rtuOverTcp
        ? !isInt(c.tcpUnitId, 1, 247)
          ? "Endereço do escravo de 1 a 247."
          : null
        : !isInt(c.tcpUnitId, 0, 255)
          ? "Unit ID de 0 a 255."
          : null,
      tcpTimeout: !isInt(c.tcpTimeout, 100, 10000) ? "Timeout de 100 a 10.000 ms." : null,
    }
  }
  const taken = busDevices.find((d) => String(d.unitId) === c.rtuUnitId.trim())
  return {
    serialPort: !c.serialPort ? "Escolha a porta RS-485 do gateway." : null,
    rtuUnitId: !isInt(c.rtuUnitId, 1, 247)
      ? "Endereço do escravo de 1 a 247 (0 é broadcast)."
      : taken
        ? `Unit ID ${c.rtuUnitId} já é usado por "${taken.name}" neste barramento.`
        : null,
    rtuTimeout: !isInt(c.rtuTimeout, 50, 5000) ? "Timeout de 50 a 5.000 ms." : null,
  }
}

/** Avisos (não bloqueiam): formato serial divergente do barramento, IP já usado etc. */
export function connWarnings(c: ConnDraft, gateway: WizardGateway | undefined, gwDevices: WizardDevice[], busDevices: WizardDevice[]): string[] {
  const out: string[] = []
  if (!gateway) return out
  if (gateway.status === "offline") out.push(`${gateway.name} está offline: a configuração fica pendente e o teste de conexão não está disponível.`)
  if (gateway.status === "pending") out.push(`${gateway.name} ainda não foi ativado: a configuração será aplicada quando ele se conectar pela primeira vez.`)
  if (isNetworkProtocol(c.protocol)) {
    const same = gwDevices.find((d) => d.protocol === c.protocol && d.host === c.host.trim() && String(d.unitId) === c.tcpUnitId.trim())
    if (same) out.push(`O IP ${c.host} (unit ID ${c.tcpUnitId}) já é lido para "${same.name}". Confirme se é o mesmo CLP atendendo duas máquinas.`)
    if (gateway.ipOt && IPV4_RE.test(c.host.trim())) {
      const net = gateway.ipOt.split(".").slice(0, 3).join(".")
      if (!c.host.trim().startsWith(`${net}.`)) out.push(`O IP está fora da rede OT do gateway (${net}.0/24). Confira a rota ou o IP do CLP.`)
    }
  } else if (busDevices.length > 0) {
    const ref = busDevices[0]
    if (ref.baudRate !== c.baudRate || ref.parity !== c.parity || ref.dataBits !== c.dataBits || ref.stopBits !== c.stopBits) {
      out.push(`O barramento ${c.serialPort} já opera em ${serialSummary(ref)}. Todos os escravos da mesma porta devem usar a mesma configuração.`)
    }
  }
  return out
}

/** Assinatura da conexão: o teste vale só para os parâmetros testados. */
export function connSignature(c: ConnDraft): string {
  return isNetworkProtocol(c.protocol)
    ? [c.gatewayId, c.protocol, c.host.trim(), c.port, c.tcpUnitId].join("|")
    : [c.gatewayId, c.protocol, c.serialPort, c.baudRate, c.parity, c.dataBits, c.stopBits, c.rtuUnitId].join("|")
}

export function validateTagRow(t: TagDraft): string | null {
  if (!t.name.trim()) return "Dê um nome ao sinal."
  if (!isInt(t.address, 0, 65535)) return "Endereço de 0 a 65535 (base 0)."
  if (isBitArea(t.area) && t.dataType !== "bool") return "Coils e discrete inputs são sempre bool."
  if (!isBitArea(t.area) && t.dataType === "bool") return "Registrador de 16 bits: escolha um tipo numérico."
  if ((t.role === "state.running" || t.role === "state.fault") && t.dataType !== "bool") return `"${TAG_ROLE_LABEL[t.role]}" precisa ser bool.`
  if ((t.role === "count.total" || t.role === "count.reject") && t.dataType === "float32") return "Contadores devem ser inteiros."
  return null
}

/** Registros sobrepostos na mesma área (ex.: uint32 em 100 e outro sinal em 101). */
export function overlaps(tags: TagDraft[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      const a = tags[i]
      const b = tags[j]
      if (a.area !== b.area || !isInt(a.address, 0, 65535) || !isInt(b.address, 0, 65535)) continue
      const a0 = Number(a.address)
      const a1 = a0 + (isBitArea(a.area) ? 1 : registersFor(a.dataType)) - 1
      const b0 = Number(b.address)
      const b1 = b0 + (isBitArea(b.area) ? 1 : registersFor(b.dataType)) - 1
      if (a0 <= b1 && b0 <= a1) {
        out[b.key] = `Sobrepõe "${a.name || TAG_ROLE_LABEL[a.role]}" (${modbusRef(a.area, a0)}).`
      }
    }
  }
  return out
}

export function validateTags(tags: TagDraft[]): { rows: Record<string, string>; global: string | null } {
  const rows: Record<string, string> = { ...overlaps(tags) }
  for (const t of tags) {
    const e = validateTagRow(t)
    if (e) rows[t.key] = e
  }
  const global =
    tags.length === 0
      ? "Mapeie ao menos o contador total da máquina."
      : !tags.some((t) => t.role === "count.total")
        ? "Falta o sinal com papel \"Contador total\": sem ele não há contagem nem performance."
        : null
  return { rows, global }
}

export function missingRoles(tags: TagDraft[], mode: StateMode): TagRole[] {
  return REQUIRED_ROLES[mode].filter((r) => !tags.some((t) => t.role === r))
}

export function validateRules(r: RulesDraft, tags: TagDraft[]): Errors {
  const missing = missingRoles(tags, r.stateMode)
  const codes = r.stateMap.map((m) => m.code.trim())
  return {
    stateMode: missing.length ? `Este modo exige o(s) sinal(is): ${missing.map((m) => TAG_ROLE_LABEL[m]).join(", ")} (etapa 3).` : null,
    idealCycleS: !(toNum(r.idealCycleS) > 0) ? "Informe o ciclo ideal em segundos (ex.: 18 ou 1,2)." : null,
    microStopS: !isInt(r.microStopS, 0, 3600) ? "De 0 a 3.600 s." : null,
    debounceS: !(toNum(r.debounceS) >= 0 && toNum(r.debounceS) <= 60) ? "De 0 a 60 s." : null,
    commLossS: !isInt(r.commLossS, 3, 600) ? "De 3 a 600 s." : null,
    idleAfterCycles: r.stateMode === "count_derived" && !isInt(r.idleAfterCycles, 1, 100) ? "De 1 a 100 ciclos." : null,
    stateMap:
      r.stateMode === "state_code" &&
      (r.stateMap.length === 0 || codes.some((c) => !isInt(c, 0, 65535)) || new Set(codes).size !== codes.length)
        ? "Cada valor do CLP deve ser um inteiro único."
        : null,
  }
}

/** Faixa ocupada: "40101" ou "40101–40102". */
export function refRange(t: TagDraft): string {
  if (!isInt(t.address, 0, 65535)) return "—"
  const a = Number(t.address)
  const first = modbusRef(t.area, a)
  if (isBitArea(t.area) || !is32(t.dataType)) return first
  return `${first}–${modbusRef(t.area, a + 1)}`
}

// ---------------------------------------------------------------------------
// Leitura de teste simulada (protótipo: sem gateway real)
// ---------------------------------------------------------------------------

/** Hash simples e determinístico (mesma entrada → mesmo valor). */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Latência simulada de uma transação Modbus (RTU é mais lento que TCP). */
export function simulatedLatency(protocol: Protocol, seed: string): number {
  const h = hash(seed)
  return protocol === "modbus-tcp" ? 8 + (h % 18) : protocol === "modbus-rtu-over-tcp" ? 22 + (h % 20) : 28 + (h % 26)
}

/**
 * Valor lido de um sinal, coerente com o papel (máquina produzindo, sem alarme).
 * `tick` muda a cada leitura para o heartbeat e os contadores avançarem.
 */
export function simulatedValue(t: TagDraft, stateMap: StateMapRow[], tick: number): string {
  const h = hash(`${t.area}:${t.address}:${t.name}`)
  // Mesma base para total, refugo e boas (coerentes entre si); avança a cada leitura.
  const counter = 523_418 + tick * 3
  switch (t.role) {
    case "state.running":
      return "1"
    case "state.fault":
      return "0"
    case "state.code": {
      const running = stateMap.find((r) => r.state === "RUNNING")
      return running ? `${running.code} · ${running.label || "Produzindo"}` : "1"
    }
    case "fault.code":
      return "0 · sem alarme"
    case "count.total":
      return counter.toLocaleString("pt-BR")
    case "count.reject":
      return Math.round(counter * 0.018).toLocaleString("pt-BR")
    case "count.good":
      return (counter - Math.round(counter * 0.018)).toLocaleString("pt-BR")
    case "product.code":
      return String(1200 + (h % 12))
    case "speed.actual":
      return String(160 + (h % 60))
    default: {
      const n = t.name.toLowerCase()
      if (n.includes("versão")) return "1"
      if (n.includes("heartbeat")) return String((h % 30_000) + tick)
      if (n.includes("ciclo")) return String(17_200 + (h % 1_400))
      if (n.includes("bits")) return "0x0001 · automático"
      if (t.dataType === "bool") return "0"
      if (t.dataType === "float32") return (180 + (h % 600) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })
      return String(h % 1000)
    }
  }
}
