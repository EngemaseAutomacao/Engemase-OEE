/**
 * Comandos nuvem → gateway (entregues na resposta do /sync) e seus resultados
 * (devolvidos no /sync seguinte, em `command_results`). Ver docs/04 e docs/12.
 *
 * Regras para o agente:
 * - deduplicar por `id` (comando repetido não é executado de novo; só reenvia o resultado);
 * - comando com `expires_at` vencido (relógio corrigido pelo server_time) não é executado: status `expired`;
 * - tipo desconhecido: status `rejected` com código `unsupported`, sem rejeitar o /sync inteiro
 *   (valide primeiro com `CommandEnvelopeSchema` e depois o payload do tipo).
 */
import { z } from "zod"
import {
  EntityIdSchema,
  Ipv4Schema,
  JwsCompactSchema,
  NonNegativeIntSchema,
  QualitySchema,
  ShortTextSchema,
  TcpPortSchema,
  UserRefSchema,
  UtcDateTimeSchema,
} from "./common"
import { MAX_COMMAND_TTL_MS, MAX_SCAN_REGISTER_SPAN } from "./limits"
import {
  DataTypeSchema,
  DeviceConnectionSchema,
  ModbusAddressSchema,
  ModbusAreaSchema,
  ModbusOffsetSchema,
  RawReadSchema,
  RtuUnitIdSchema,
  ScaleSchema,
  SerialBusSchema,
  WordOrderSchema,
  checkRawRead,
  checkTypedAddress,
} from "./modbus"
import { addRuleIssue } from "./rules"

/** Tipos de comando do contrato v1. */
export const COMMAND_TYPES = [
  "tag.read",
  "device.test",
  "config.reload",
  "agent.restart",
  "modbus.scan",
  "vpn.enable",
  "vpn.disable",
  "vpn.status",
  "ot.forward.open",
  "ot.forward.close",
] as const
export const CommandTypeSchema = z.enum(COMMAND_TYPES)
export type CommandType = z.infer<typeof CommandTypeSchema>

/** Nome de tipo de comando qualquer (inclusive de versões futuras), ex.: "agent.update". */
export const CommandTypeNameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/, "tipo de comando inválido")

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** tag.read — teste de leitura de um endereço antes de salvar a tag ("Ler agora"). */
export const TagReadPayloadSchema = z
  .object({
    device_id: EntityIdSchema,
    address: ModbusAddressSchema,
    type: DataTypeSchema,
    word_order: WordOrderSchema.optional(),
    scale: ScaleSchema.optional(),
  })
  .superRefine((p, ctx) => checkTypedAddress(p, ctx))
export type TagReadPayload = z.infer<typeof TagReadPayloadSchema>

/**
 * device.test — testa a conexão com um CLP cadastrado na nuvem (ainda que fora da config
 * aplicada). O alvo é sempre um dispositivo cadastrado (docs/15, item 13).
 * Em RTU, `serial_bus` só é enviado quando o barramento ainda não existe na config aplicada
 * ou tem parâmetros diferentes; nesse caso o agente exige `allow_bus_pause: true`.
 */
export const DeviceTestPayloadSchema = z
  .object({
    device_id: EntityIdSchema,
    connection: DeviceConnectionSchema,
    serial_bus: SerialBusSchema.optional(),
    allow_bus_pause: z.boolean().optional(),
    probe: RawReadSchema.optional().describe("Leitura opcional para validar o acesso (padrão: só conectar)"),
  })
  .superRefine((p, ctx) => {
    if (p.serial_bus !== undefined) {
      if (p.connection.protocol !== "modbus-rtu" || p.connection.params.bus !== p.serial_bus.id) {
        addRuleIssue(ctx, "device_test.bus", ["serial_bus"])
      }
    }
    if (p.probe !== undefined) checkRawRead(p.probe, ctx, ["probe"])
  })
export type DeviceTestPayload = z.infer<typeof DeviceTestPayloadSchema>

/** config.reload — força baixar e aplicar a config. */
export const ConfigReloadPayloadSchema = z.object({})
export type ConfigReloadPayload = z.infer<typeof ConfigReloadPayloadSchema>

/** agent.restart — reinicia o serviço (o agente envia o resultado antes de sair). */
export const AgentRestartPayloadSchema = z.object({
  reason: z.string().max(200).optional(),
  delay_s: z.int().min(0).max(300).optional(),
})
export type AgentRestartPayload = z.infer<typeof AgentRestartPayloadSchema>

/** modbus.scan — varre unit ids de um barramento RS-485 ou uma faixa de registradores de um dispositivo. */
export const ModbusScanPayloadSchema = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal("unit_ids"),
      bus_id: EntityIdSchema,
      unit_from: RtuUnitIdSchema,
      unit_to: RtuUnitIdSchema,
      probe: z
        .object({ area: ModbusAreaSchema, offset: ModbusOffsetSchema })
        .optional()
        .describe("Endereço lido em cada unit id (padrão: holding_register 0)"),
      timeout_ms: z.int().min(50).max(2000).optional(),
    }),
    z.object({
      mode: z.literal("registers"),
      device_id: EntityIdSchema,
      area: ModbusAreaSchema,
      start: ModbusOffsetSchema,
      end: ModbusOffsetSchema,
      timeout_ms: z.int().min(50).max(2000).optional(),
    }),
  ])
  .superRefine((p, ctx) => {
    if (p.mode === "unit_ids" && p.unit_from > p.unit_to) addRuleIssue(ctx, "scan.range", ["unit_to"])
    if (p.mode === "registers" && (p.start > p.end || p.end - p.start + 1 > MAX_SCAN_REGISTER_SPAN)) {
      addRuleIssue(ctx, "scan.range", ["end"])
    }
  })
export type ModbusScanPayload = z.infer<typeof ModbusScanPayloadSchema>

/**
 * vpn.enable — liga a VPN de manutenção (docs/12). Só é aceito com a aprovação assinada
 * pelo fluxo do cliente (`approval`, JWS EdDSA cujas claims seguem `VpnApprovalClaimsSchema`)
 * e se a política local (`remote-access.json` / kill switch) permitir.
 * `auth_key` é segredo de uso único: nunca gravar em disco nem em log.
 */
export const VpnEnablePayloadSchema = z.object({
  session_id: EntityIdSchema,
  auth_key: z.string().min(16).max(512).describe("Chave de entrada de uso único (segredo)"),
  control_url: z
    .string()
    .max(512)
    .regex(/^https:\/\/[^\s/?#]+(?:\/[^\s]*)?$/, "control_url deve ser https")
    .optional()
    .describe("Servidor de controle alternativo (ex.: Headscale)"),
  node_name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, "nome de nó inválido"),
  session_expires_at: UtcDateTimeSchema,
  idle_timeout_s: z.int().min(60).max(7200).optional().describe("Inatividade máxima (padrão: 900 s)"),
  approval: JwsCompactSchema,
})
export type VpnEnablePayload = z.infer<typeof VpnEnablePayloadSchema>

export const VpnEndReasonSchema = z.enum([
  "requested",
  "expired",
  "idle",
  "revoked",
  "local_lock",
  "token_revoked",
  "agent_restart",
  "error",
])
export type VpnEndReason = z.infer<typeof VpnEndReasonSchema>

/** vpn.disable — fecha encaminhamentos, desconecta e devolve o resumo da sessão. */
export const VpnDisablePayloadSchema = z.object({
  session_id: EntityIdSchema,
  reason: z.enum(["requested", "expired", "revoked"]).optional(),
})
export type VpnDisablePayload = z.infer<typeof VpnDisablePayloadSchema>

/** vpn.status — estado da VPN e dos encaminhamentos. */
export const VpnStatusPayloadSchema = z.object({
  session_id: EntityIdSchema.optional(),
})
export type VpnStatusPayload = z.infer<typeof VpnStatusPayloadSchema>

/**
 * ot.forward.open — abre o encaminhamento de UM IP:porta de um dispositivo cadastrado,
 * com aprovação própria (JWS cujas claims seguem `OtForwardApprovalClaimsSchema`).
 * O gateway continua sem rotear (ip_forward=0).
 */
export const OtForwardOpenPayloadSchema = z.object({
  session_id: EntityIdSchema,
  forward_id: EntityIdSchema,
  device_id: EntityIdSchema,
  host: Ipv4Schema,
  port: TcpPortSchema,
  forward_expires_at: UtcDateTimeSchema,
  max_connections: z.int().min(1).max(8).optional().describe("Padrão: 1"),
  approval: JwsCompactSchema,
})
export type OtForwardOpenPayload = z.infer<typeof OtForwardOpenPayloadSchema>

/** ot.forward.close — fecha um encaminhamento. */
export const OtForwardClosePayloadSchema = z.object({
  session_id: EntityIdSchema,
  forward_id: EntityIdSchema,
  reason: z.enum(["requested", "expired", "revoked"]).optional(),
})
export type OtForwardClosePayload = z.infer<typeof OtForwardClosePayloadSchema>

// ---------------------------------------------------------------------------
// Aprovações assinadas (claims do JWS)
// ---------------------------------------------------------------------------

/**
 * Claims da aprovação de VPN, assinada (JWS compacto, alg EdDSA/Ed25519, `kid` no header)
 * pelo fluxo de aprovação do admin do cliente. O agente verifica a assinatura com a chave
 * pública embutida e confere: `gateway_id` = ele mesmo, `session_id` = o do payload,
 * `not_after` ≥ `session_expires_at` do payload e `not_after` ainda no futuro.
 */
export const VpnApprovalClaimsSchema = z.object({
  typ: z.literal("engemase.vpn_approval.v1"),
  gateway_id: EntityIdSchema,
  session_id: EntityIdSchema,
  requested_by: UserRefSchema,
  approved_by: UserRefSchema,
  approved_at: UtcDateTimeSchema,
  not_after: UtcDateTimeSchema,
  allow_ot_forward: z.boolean(),
})
export type VpnApprovalClaims = z.infer<typeof VpnApprovalClaimsSchema>

/** Claims da aprovação de encaminhamento OT (mesmo formato de assinatura). */
export const OtForwardApprovalClaimsSchema = z.object({
  typ: z.literal("engemase.ot_forward_approval.v1"),
  gateway_id: EntityIdSchema,
  session_id: EntityIdSchema,
  forward_id: EntityIdSchema,
  device_id: EntityIdSchema,
  host: Ipv4Schema,
  port: TcpPortSchema,
  approved_by: UserRefSchema,
  approved_at: UtcDateTimeSchema,
  not_after: UtcDateTimeSchema,
  max_connections: z.int().min(1).max(8),
})
export type OtForwardApprovalClaims = z.infer<typeof OtForwardApprovalClaimsSchema>

// ---------------------------------------------------------------------------
// Comandos (envelope + união por tipo)
// ---------------------------------------------------------------------------

const commandBase = {
  id: EntityIdSchema,
  issued_at: UtcDateTimeSchema.optional(),
  expires_at: UtcDateTimeSchema.describe("Depois disso o comando não é executado (status expired)"),
}

function checkExpiry(c: { issued_at?: string | undefined; expires_at: string }, ctx: z.RefinementCtx): void {
  if (c.issued_at === undefined) return
  const ttl = Date.parse(c.expires_at) - Date.parse(c.issued_at)
  if (ttl <= 0 || ttl > MAX_COMMAND_TTL_MS) addRuleIssue(ctx, "command.expiry", ["expires_at"])
}

function command<T extends CommandType, P extends z.ZodType>(type: T, payload: P) {
  return z.object({ ...commandBase, type: z.literal(type), payload }).superRefine(checkExpiry)
}

export const TagReadCommandSchema = command("tag.read", TagReadPayloadSchema)
export const DeviceTestCommandSchema = command("device.test", DeviceTestPayloadSchema)
export const ConfigReloadCommandSchema = command("config.reload", ConfigReloadPayloadSchema)
export const AgentRestartCommandSchema = command("agent.restart", AgentRestartPayloadSchema)
export const ModbusScanCommandSchema = command("modbus.scan", ModbusScanPayloadSchema)
export const VpnEnableCommandSchema = command("vpn.enable", VpnEnablePayloadSchema)
export const VpnDisableCommandSchema = command("vpn.disable", VpnDisablePayloadSchema)
export const VpnStatusCommandSchema = command("vpn.status", VpnStatusPayloadSchema)
export const OtForwardOpenCommandSchema = command("ot.forward.open", OtForwardOpenPayloadSchema)
export const OtForwardCloseCommandSchema = command("ot.forward.close", OtForwardClosePayloadSchema)

/** Comando tipado (união por `type`). É o que a nuvem gera. */
export const CommandSchema = z.discriminatedUnion("type", [
  TagReadCommandSchema,
  DeviceTestCommandSchema,
  ConfigReloadCommandSchema,
  AgentRestartCommandSchema,
  ModbusScanCommandSchema,
  VpnEnableCommandSchema,
  VpnDisableCommandSchema,
  VpnStatusCommandSchema,
  OtForwardOpenCommandSchema,
  OtForwardCloseCommandSchema,
])
export type Command = z.infer<typeof CommandSchema>
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>

/**
 * Envelope genérico de comando: o que o agente valida antes de olhar o tipo.
 * Aceita tipos futuros, para responder `rejected`/`unsupported` sem travar o /sync.
 */
export const CommandEnvelopeSchema = z
  .object({
    ...commandBase,
    type: CommandTypeNameSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine(checkExpiry)
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>

// ---------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------

/** Códigos de erro na execução de comandos (campo `error.code` do resultado). */
export const COMMAND_ERROR_CODES = {
  unsupported: "Tipo de comando desconhecido para esta versão do agente.",
  invalid_payload: "Payload inválido para o tipo de comando.",
  expired: "O comando chegou depois de expires_at.",
  timeout: "O comando passou do prazo de execução.",
  device_not_found: "Dispositivo não existe na config aplicada nem no comando.",
  bus_not_found: "Barramento não existe na config aplicada.",
  bus_pause_required: "Teste com parâmetros seriais diferentes exige allow_bus_pause.",
  port_unavailable: "Porta serial ausente ou ocupada.",
  connection_failed: "Falha ao conectar ao dispositivo (recusa, timeout de conexão, rota).",
  read_timeout: "O dispositivo não respondeu à leitura dentro do timeout.",
  modbus_exception: "O dispositivo respondeu com exceção Modbus (ver modbus_exception).",
  decode_error: "Resposta recebida, mas não foi possível decodificar o valor.",
  config_fetch_failed: "Falha ao baixar a config.",
  config_invalid: "A config baixada é inválida (schema ou regra semântica).",
  policy_denied: "A política local (kill switch, remote-access.json) não permite.",
  approval_invalid: "Aprovação assinada ausente, inválida, vencida ou de outro gateway/sessão.",
  session_conflict: "Já existe outra sessão ou encaminhamento ativo incompatível.",
  session_not_found: "Sessão ou encaminhamento não existe ou já foi encerrado.",
  vpn_failed: "Falha ao iniciar ou manter a VPN.",
  internal_error: "Erro interno do agente.",
} as const
export const CommandErrorCodeSchema = z.enum(
  Object.keys(COMMAND_ERROR_CODES) as [keyof typeof COMMAND_ERROR_CODES, ...(keyof typeof COMMAND_ERROR_CODES)[]],
)
export type CommandErrorCode = z.infer<typeof CommandErrorCodeSchema>

export const CommandErrorSchema = z.object({
  code: CommandErrorCodeSchema,
  message: ShortTextSchema,
  modbus_exception: z.int().min(1).max(255).optional().describe("Código da exceção Modbus (ex.: 2, 11)"),
  details: z.record(z.string(), z.unknown()).optional(),
})
export type CommandError = z.infer<typeof CommandErrorSchema>

const RegisterWordSchema = z.int().min(0).max(65535)

export const TagReadResultSchema = z.object({
  value: z.union([z.number(), z.boolean()]),
  raw: z.array(RegisterWordSchema).max(2).optional().describe("Words lidas (ou 0/1 para bits)"),
  quality: QualitySchema,
  read_ms: NonNegativeIntSchema,
})
export type TagReadResult = z.infer<typeof TagReadResultSchema>

export const DeviceTestResultSchema = z.object({
  latency_ms: NonNegativeIntSchema,
  probe: z
    .object({
      raw: z.array(RegisterWordSchema).max(2000),
      read_ms: NonNegativeIntSchema,
    })
    .optional(),
})
export type DeviceTestResult = z.infer<typeof DeviceTestResultSchema>

export const ConfigReloadResultSchema = z.object({
  version: NonNegativeIntSchema,
  outcome: z.enum(["applied", "unchanged"]),
})
export type ConfigReloadResult = z.infer<typeof ConfigReloadResultSchema>

export const AgentRestartResultSchema = z.object({
  restart_at: UtcDateTimeSchema,
})
export type AgentRestartResult = z.infer<typeof AgentRestartResultSchema>

const RangeSchema = z.object({ start: ModbusOffsetSchema, count: z.int().min(1).max(65536) })

export const ModbusScanResultSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("unit_ids"),
    found: z.array(
      z.object({
        unit_id: RtuUnitIdSchema,
        latency_ms: NonNegativeIntSchema,
        exception: z.int().min(1).max(255).optional().describe("Respondeu com exceção (o escravo existe)"),
      }),
    ),
    scanned: NonNegativeIntSchema,
    duration_ms: NonNegativeIntSchema,
  }),
  z.object({
    mode: z.literal("registers"),
    readable: z.array(RangeSchema),
    unreadable: z.array(RangeSchema.extend({ exception: z.int().min(1).max(255).optional() })),
    duration_ms: NonNegativeIntSchema,
  }),
])
export type ModbusScanResult = z.infer<typeof ModbusScanResultSchema>

const VpnConnectionTypeSchema = z.enum(["direct", "relay"])

export const VpnEnableResultSchema = z.object({
  session_id: EntityIdSchema,
  state: z.literal("active"),
  node_ip: Ipv4Schema.optional(),
  connection: VpnConnectionTypeSchema.optional(),
  session_expires_at: UtcDateTimeSchema,
})
export type VpnEnableResult = z.infer<typeof VpnEnableResultSchema>

export const VpnSessionSummarySchema = z.object({
  session_id: EntityIdSchema,
  started_at: UtcDateTimeSchema.optional(),
  ended_at: UtcDateTimeSchema,
  end_reason: VpnEndReasonSchema,
  bytes_in: NonNegativeIntSchema.optional(),
  bytes_out: NonNegativeIntSchema.optional(),
  ssh_logins: NonNegativeIntSchema.optional(),
  forwards_opened: NonNegativeIntSchema.optional(),
})
export type VpnSessionSummary = z.infer<typeof VpnSessionSummarySchema>

export const OtForwardStatusSchema = z.object({
  forward_id: EntityIdSchema,
  device_id: EntityIdSchema,
  host: Ipv4Schema,
  port: TcpPortSchema,
  listen_port: TcpPortSchema,
  forward_expires_at: UtcDateTimeSchema,
  connections: NonNegativeIntSchema,
})
export type OtForwardStatus = z.infer<typeof OtForwardStatusSchema>

export const VpnStatusResultSchema = z.object({
  state: z.enum(["off", "activating", "active", "stopping", "error"]),
  session_id: EntityIdSchema.optional(),
  node_ip: Ipv4Schema.optional(),
  connection: VpnConnectionTypeSchema.optional(),
  session_expires_at: UtcDateTimeSchema.optional(),
  idle_s: NonNegativeIntSchema.optional(),
  active_connections: NonNegativeIntSchema.optional(),
  forwards: z.array(OtForwardStatusSchema),
  local_policy: z.object({
    allowed: z.boolean(),
    allow_ot_forward: z.boolean(),
    locked: z.boolean().describe("Kill switch local ativo"),
  }),
})
export type VpnStatusResult = z.infer<typeof VpnStatusResultSchema>

export const OtForwardOpenResultSchema = z.object({
  forward_id: EntityIdSchema,
  listen_port: TcpPortSchema.describe("Porta no endereço da VPN do gateway"),
  forward_expires_at: UtcDateTimeSchema,
})
export type OtForwardOpenResult = z.infer<typeof OtForwardOpenResultSchema>

export const OtForwardCloseResultSchema = z.object({
  forward_id: EntityIdSchema,
  closed_at: UtcDateTimeSchema,
  connections_total: NonNegativeIntSchema.optional(),
  bytes_in: NonNegativeIntSchema.optional(),
  bytes_out: NonNegativeIntSchema.optional(),
})
export type OtForwardCloseResult = z.infer<typeof OtForwardCloseResultSchema>

const resultBase = {
  id: EntityIdSchema.describe("id do comando"),
  finished_at: UtcDateTimeSchema.optional(),
  duration_ms: NonNegativeIntSchema.optional(),
}

function success<T extends CommandType, R extends z.ZodType>(type: T, result: R) {
  return z.object({ ...resultBase, type: z.literal(type), status: z.literal("ok"), result })
}

/** Resultado de sucesso, tipado por `type`. */
export const CommandSuccessSchema = z.discriminatedUnion("type", [
  success("tag.read", TagReadResultSchema),
  success("device.test", DeviceTestResultSchema),
  success("config.reload", ConfigReloadResultSchema),
  success("agent.restart", AgentRestartResultSchema),
  success("modbus.scan", ModbusScanResultSchema),
  success("vpn.enable", VpnEnableResultSchema),
  success("vpn.disable", VpnSessionSummarySchema),
  success("vpn.status", VpnStatusResultSchema),
  success("ot.forward.open", OtForwardOpenResultSchema),
  success("ot.forward.close", OtForwardCloseResultSchema),
])
export type CommandSuccess = z.infer<typeof CommandSuccessSchema>

/**
 * Resultado de falha: `error` (falhou ao executar), `expired` (não executado por prazo)
 * ou `rejected` (recusado antes de executar: tipo desconhecido, payload inválido, política).
 * `type` aceita qualquer nome, para responder a tipos que o agente não conhece.
 */
export const CommandFailureSchema = z.object({
  ...resultBase,
  type: CommandTypeNameSchema,
  status: z.enum(["error", "expired", "rejected"]),
  error: CommandErrorSchema,
})
export type CommandFailure = z.infer<typeof CommandFailureSchema>

/** Resultado de comando (devolvido em `command_results` do /sync). */
export const CommandResultSchema = z.discriminatedUnion("status", [CommandSuccessSchema, CommandFailureSchema])
export type CommandResult = z.infer<typeof CommandResultSchema>
export type CommandResultStatus = CommandResult["status"]
