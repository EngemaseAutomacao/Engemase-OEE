/**
 * Modbus TCP / RTU: áreas, tipos, endereços estruturados e parâmetros de conexão.
 * Ver docs/11-integracao-modbus.md.
 */
import { z } from "zod"
import { EntityIdSchema, HostSchema, TcpPortSchema } from "./common"
import {
  MAX_BITS_PER_READ,
  MAX_MODBUS_OFFSET,
  MAX_POLL_MS,
  MAX_REGISTERS_PER_READ,
  MAX_RTU_UNIT_ID,
  MIN_POLL_MS_TCP,
  MIN_RTU_UNIT_ID,
} from "./limits"
import { addRuleIssue } from "./rules"

/** Áreas Modbus. Convenção exibida na web: coil 0xxxx, discrete_input 1xxxx, input_register 3xxxx, holding_register 4xxxx. */
export const ModbusAreaSchema = z.enum(["coil", "discrete_input", "input_register", "holding_register"])
export type ModbusArea = z.infer<typeof ModbusAreaSchema>
export const MODBUS_AREAS = ModbusAreaSchema.options

/** Áreas de 1 bit (FC01/FC02). */
export const BitAreaSchema = z.enum(["coil", "discrete_input"])
/** Áreas de registradores de 16 bits (FC03/FC04). */
export const RegisterAreaSchema = z.enum(["input_register", "holding_register"])
export const BIT_AREAS: readonly ModbusArea[] = BitAreaSchema.options
export const REGISTER_AREAS: readonly ModbusArea[] = RegisterAreaSchema.options

export function isBitArea(area: ModbusArea): boolean {
  return area === "coil" || area === "discrete_input"
}

/** Tipos de dado suportados no MVP. */
export const DataTypeSchema = z.enum(["bool", "int16", "uint16", "int32", "uint32", "float32"])
export type DataType = z.infer<typeof DataTypeSchema>
export const DATA_TYPES = DataTypeSchema.options

/** Tipos inteiros (estado, código, contador, produto, heartbeat). */
export const INTEGER_TYPES: readonly DataType[] = ["int16", "uint16", "int32", "uint32"]
/** Tipos numéricos (inteiros e float). */
export const NUMERIC_TYPES: readonly DataType[] = ["int16", "uint16", "int32", "uint32", "float32"]

export function is32BitType(type: DataType): boolean {
  return type === "int32" || type === "uint32" || type === "float32"
}

/** Quantos registradores de 16 bits o tipo ocupa (bool em registrador ocupa 1). */
export function registerCount(type: DataType): 1 | 2 {
  return is32BitType(type) ? 2 : 1
}

/**
 * Ordem dos bytes/words em valores de 32 bits (A = byte mais significativo).
 * CDAB (word baixa primeiro) é o padrão do bloco OEE Engemase.
 */
export const WordOrderSchema = z.enum(["ABCD", "CDAB", "BADC", "DCBA"])
export type WordOrder = z.infer<typeof WordOrderSchema>

/** Offset Modbus em base 0 (o "40001" da convenção é o offset 0 em holding_register). */
export const ModbusOffsetSchema = z
  .int()
  .min(0)
  .max(MAX_MODBUS_OFFSET)
  .describe("Offset Modbus em base 0 (0–65535)")

/** Endereço estruturado: área + offset base 0 (+ bit, para bool dentro de registrador). */
export const ModbusAddressSchema = z.object({
  area: ModbusAreaSchema,
  offset: ModbusOffsetSchema,
  bit: z.int().min(0).max(15).optional().describe("Bit (0 = menos significativo) para type bool em registrador"),
})
export type ModbusAddress = z.infer<typeof ModbusAddressSchema>

/** Unit id em RTU e RTU sobre TCP: 1–247. */
export const RtuUnitIdSchema = z.int().min(MIN_RTU_UNIT_ID).max(MAX_RTU_UNIT_ID).describe("Unit id (1–247)")

/**
 * Unit id em Modbus TCP: 0–255. A especificação Modbus/TCP recomenda 255 (ou 0)
 * para servidores TCP diretos; conversores TCP→RTU usam 1–247.
 */
export const TcpUnitIdSchema = z.int().min(0).max(255).describe("Unit id Modbus TCP (0–255; normalmente 1)")

/** Timeout por leitura (ms). */
export const TimeoutMsSchema = z.int().min(50).max(10_000)

/** Intervalo de leitura (ms). O mínimo de RTU (200) é regra semântica. */
export const PollMsSchema = z.int().min(MIN_POLL_MS_TCP).max(MAX_POLL_MS)

/** Escala linear aplicada após a decodificação: valor = bruto × mul + add. */
export const ScaleSchema = z.object({
  mul: z.number().optional(),
  add: z.number().optional(),
})
export type Scale = z.infer<typeof ScaleSchema>

/** Velocidades seriais aceitas (bps). */
export const BaudRateSchema = z.literal([1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200])
export type BaudRate = z.infer<typeof BaudRateSchema>

/** Paridade: N (nenhuma), E (par) ou O (ímpar). */
export const ParitySchema = z.enum(["N", "E", "O"])
export type Parity = z.infer<typeof ParitySchema>

/**
 * Porta serial: nome lógico do perfil de hardware (preferido, ex.: "rs485-1")
 * ou caminho do dispositivo (ex.: "/dev/ttyAMA2").
 */
export const SerialPortSchema = z
  .string()
  .max(64)
  .regex(/^(?:\/dev\/[A-Za-z0-9._/-]+|[a-z][a-z0-9-]{0,31})$/, "porta serial inválida: use um nome lógico (rs485-1) ou /dev/...")
  .describe("Porta serial lógica (rs485-1) ou caminho /dev/...")

/** Barramento RS-485: um mestre (o gateway) e vários escravos com a mesma configuração serial. */
export const SerialBusSchema = z.object({
  id: EntityIdSchema,
  name: z.string().max(120).optional(),
  port: SerialPortSchema,
  baud: BaudRateSchema,
  parity: ParitySchema,
  /** Modbus RTU exige 8 bits de dados (7 bits é Modbus ASCII, fora do MVP). */
  data_bits: z.literal(8).describe("Modbus RTU usa sempre 8 bits de dados"),
  stop_bits: z.literal([1, 2]),
})
export type SerialBus = z.infer<typeof SerialBusSchema>

/** Parâmetros de um dispositivo Modbus TCP. */
export const ModbusTcpParamsSchema = z.object({
  host: HostSchema,
  port: TcpPortSchema.describe("Porta TCP (padrão Modbus: 502)"),
  unit_id: TcpUnitIdSchema,
  timeout_ms: TimeoutMsSchema.optional(),
})
export type ModbusTcpParams = z.infer<typeof ModbusTcpParamsSchema>

/** Parâmetros de um escravo Modbus RTU num barramento RS-485 do gateway. */
export const ModbusRtuParamsSchema = z.object({
  bus: EntityIdSchema.describe("id do barramento em serial_buses"),
  unit_id: RtuUnitIdSchema,
  timeout_ms: TimeoutMsSchema.optional(),
  turnaround_ms: z.int().min(0).max(1000).optional().describe("Intervalo extra entre quadros para este escravo (ms)"),
})
export type ModbusRtuParams = z.infer<typeof ModbusRtuParamsSchema>

/** Parâmetros de RTU sobre TCP (conversor serial↔Ethernet transparente). */
export const ModbusRtuOverTcpParamsSchema = z.object({
  host: HostSchema,
  port: TcpPortSchema,
  unit_id: RtuUnitIdSchema,
  timeout_ms: TimeoutMsSchema.optional(),
})
export type ModbusRtuOverTcpParams = z.infer<typeof ModbusRtuOverTcpParamsSchema>

export const ProtocolSchema = z.enum(["modbus-tcp", "modbus-rtu", "modbus-rtu-over-tcp"])
export type Protocol = z.infer<typeof ProtocolSchema>
export const PROTOCOLS = ProtocolSchema.options

/** Conexão de um dispositivo (protocolo + parâmetros). */
export const DeviceConnectionSchema = z.discriminatedUnion("protocol", [
  z.object({ protocol: z.literal("modbus-tcp"), params: ModbusTcpParamsSchema }),
  z.object({ protocol: z.literal("modbus-rtu"), params: ModbusRtuParamsSchema }),
  z.object({ protocol: z.literal("modbus-rtu-over-tcp"), params: ModbusRtuOverTcpParamsSchema }),
])
export type DeviceConnection = z.infer<typeof DeviceConnectionSchema>

/** Quantidade por leitura em registradores: 1–125 (FC03/FC04). */
export const RegisterCountSchema = z.int().min(1).max(MAX_REGISTERS_PER_READ)
/** Quantidade por leitura em bits: 1–2000 (FC01/FC02). */
export const BitCountSchema = z.int().min(1).max(MAX_BITS_PER_READ)

/** Leitura bruta de N registradores/bits a partir de um endereço (teste de conexão). */
export const RawReadSchema = z.discriminatedUnion("area", [
  z.object({ area: RegisterAreaSchema, offset: ModbusOffsetSchema, count: RegisterCountSchema }),
  z.object({ area: BitAreaSchema, offset: ModbusOffsetSchema, count: BitCountSchema }),
])
export type RawRead = z.infer<typeof RawReadSchema>

/** Quantos registradores/bits o tipo ocupa a partir do offset, para checar a faixa. */
export function addressSpan(address: ModbusAddress, type: DataType): number {
  return isBitArea(address.area) ? 1 : registerCount(type)
}

/**
 * Regras de endereço tipado (tag e tag.read): área × tipo × bit × word_order × faixa.
 * `path` é o caminho do objeto que contém `address`, `type` e `word_order`.
 */
export function checkTypedAddress(
  value: { address: ModbusAddress; type: DataType; word_order?: WordOrder | undefined },
  ctx: z.RefinementCtx,
  path: PropertyKey[] = [],
): void {
  const { address, type } = value
  if (isBitArea(address.area)) {
    if (type !== "bool" || address.bit !== undefined || value.word_order !== undefined) {
      addRuleIssue(ctx, "address.bit_area", [...path, "type"])
    }
    return
  }
  if (type === "bool" && address.bit === undefined) {
    addRuleIssue(ctx, "address.register_bool_bit", [...path, "address", "bit"])
  }
  if (type !== "bool" && address.bit !== undefined) {
    addRuleIssue(ctx, "address.bit_only_bool", [...path, "address", "bit"])
  }
  if (is32BitType(type) !== (value.word_order !== undefined)) {
    addRuleIssue(ctx, "address.word_order", [...path, "word_order"])
  }
  if (address.offset + addressSpan(address, type) - 1 > MAX_MODBUS_OFFSET) {
    addRuleIssue(ctx, "address.range", [...path, "address", "offset"])
  }
}

/** Regra de uma leitura bruta: o último endereço lido não pode passar de 65535. */
export function checkRawRead(read: RawRead, ctx: z.RefinementCtx, path: PropertyKey[] = []): void {
  if (read.offset + read.count - 1 > MAX_MODBUS_OFFSET) {
    addRuleIssue(ctx, "probe.range", [...path, "count"])
  }
}
