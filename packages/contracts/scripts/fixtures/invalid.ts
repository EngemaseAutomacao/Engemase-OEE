/**
 * Fixtures INVÁLIDAS, derivadas das válidas por pequenos patches.
 *
 * `layer`:
 * - "schema": o próprio JSON Schema (tolerante) já rejeita;
 * - "semantic": o JSON Schema aceita; só as regras semânticas (`RULES`) rejeitam.
 *   O agente Go precisa implementar essas regras para rejeitar essas fixtures.
 */
import type { ContractSchemaName, RuleId } from "../../src/index"
import { ID } from "./ids"

export type Patch =
  | { readonly op: "set"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string }

export interface InvalidCase {
  readonly schema: ContractSchemaName
  /** Nome da fixture válida de origem (sem .json). */
  readonly base: string
  readonly patch: readonly Patch[]
  readonly layer: "schema" | "semantic"
  /** Caminho (com pontos) do problema esperado. */
  readonly path: string
  /** Regra esperada (obrigatória quando layer = "semantic"). */
  readonly rule?: RuleId
  readonly description: string
}

const set = (path: string, value: unknown): Patch => ({ op: "set", path, value })
const remove = (path: string): Patch => ({ op: "remove", path })

const UNKNOWN_ID = "01a1cab3-0000-7000-8000-000000000bad"
const CONFIG = "gateway-config.valid.tcp-and-rtu-bus"
const SYNC = "sync-request.valid.realistic"
const RESPONSE = "sync-response.valid.all-command-types"

export const INVALID_CASES: Readonly<Record<string, InvalidCase>> = {
  // -------------------------------------------------------------------------
  // GET /config
  // -------------------------------------------------------------------------
  "gateway-config.invalid.rtu-unit-id-zero": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.1.params.unit_id", 0)],
    layer: "schema",
    path: "devices.1.params.unit_id",
    description: "Unit id 0 em RTU (0 é broadcast; faixa 1–247).",
  },
  "gateway-config.invalid.rtu-unit-id-248": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.2.params.unit_id", 248)],
    layer: "schema",
    path: "devices.2.params.unit_id",
    description: "Unit id 248 em RTU (máximo 247).",
  },
  "gateway-config.invalid.offset-out-of-range": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.0.tags.7.address.offset", 65536)],
    layer: "schema",
    path: "devices.0.tags.7.address.offset",
    description: "Offset 65536 (base 0, máximo 65535).",
  },
  "gateway-config.invalid.block-126-registers": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.0.blocks.0.count", 126)],
    layer: "schema",
    path: "devices.0.blocks.0.count",
    description: "Bloco de holding registers com 126 registradores (máximo 125 por leitura).",
  },
  "gateway-config.invalid.data-bits-7": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("serial_buses.0.data_bits", 7)],
    layer: "schema",
    path: "serial_buses.0.data_bits",
    description: "7 bits de dados (Modbus RTU exige 8; 7 bits é Modbus ASCII).",
  },
  "gateway-config.invalid.illustrative-id": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.0.id", "dev_inj03")],
    layer: "schema",
    path: "devices.0.id",
    description: "Id com prefixo dos exemplos da documentação (a API usa UUID).",
  },
  "gateway-config.invalid.unknown-protocol": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.0.protocol", "s7")],
    layer: "schema",
    path: "devices.0.protocol",
    description: "Protocolo fora do MVP.",
  },
  "gateway-config.invalid.state-map-no-comm": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("machines.0.state_rules.map.6", "NO_COMM")],
    layer: "schema",
    path: "machines.0.state_rules.map.6",
    description: "NO_COMM no mapa de state_code (NO_COMM é só do gateway).",
  },
  "gateway-config.invalid.uint32-without-word-order": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [remove("devices.0.tags.3.word_order")],
    layer: "semantic",
    rule: "address.word_order",
    path: "devices.0.tags.3.word_order",
    description: "uint32 sem word_order.",
  },
  "gateway-config.invalid.coil-not-bool": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.1.tags.0.type", "uint16")],
    layer: "semantic",
    rule: "address.bit_area",
    path: "devices.1.tags.0.type",
    description: "Coil lida como uint16.",
  },
  "gateway-config.invalid.register-bool-without-bit": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [remove("devices.1.tags.1.address.bit")],
    layer: "semantic",
    rule: "address.register_bool_bit",
    path: "devices.1.tags.1.address.bit",
    description: "bool em holding register sem indicar o bit.",
  },
  "gateway-config.invalid.role-type": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.0.tags.3.type", "float32")],
    layer: "semantic",
    rule: "tag.role_type",
    path: "devices.0.tags.3.type",
    description: "Contador (count.total) declarado como float32.",
  },
  "gateway-config.invalid.bus-unit-id-duplicate": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.2.params.unit_id", 1)],
    layer: "semantic",
    rule: "bus.unit_unique",
    path: "devices.2.params.unit_id",
    description: "Dois escravos com unit id 1 no mesmo barramento.",
  },
  "gateway-config.invalid.bus-ref-missing": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.1.params.bus", UNKNOWN_ID)],
    layer: "semantic",
    rule: "bus.ref",
    path: "devices.1.params.bus",
    description: "Dispositivo RTU apontando para barramento inexistente.",
  },
  "gateway-config.invalid.tag-partial-block": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.0.tags.4.address.offset", 1013)],
    layer: "semantic",
    rule: "tag.block_partial",
    path: "devices.0.tags.4.address.offset",
    description: "uint32 em HR 1013–1014 com o bloco terminando em 1013.",
  },
  "gateway-config.invalid.tag-without-poll": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [remove("devices.2.tags.0.poll_ms")],
    layer: "semantic",
    rule: "tag.poll_source",
    path: "devices.2.tags.0.poll_ms",
    description: "Tag fora de bloco sem poll_ms.",
  },
  "gateway-config.invalid.tag-in-block-with-poll": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.0.tags.1.poll_ms", 500)],
    layer: "semantic",
    rule: "tag.poll_source",
    path: "devices.0.tags.1.poll_ms",
    description: "Tag dentro de bloco com poll_ms próprio (ambíguo).",
  },
  "gateway-config.invalid.rtu-poll-too-fast": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.1.tags.0.poll_ms", 100)],
    layer: "semantic",
    rule: "poll.rtu_min",
    path: "devices.1.tags.0.poll_ms",
    description: "poll_ms 100 em RTU (mínimo 200).",
  },
  "gateway-config.invalid.block-overlap": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [
      set("devices.0.blocks", [
        { area: "holding_register", start: 1000, count: 14, poll_ms: 500 },
        { area: "holding_register", start: 1010, count: 10, poll_ms: 1000 },
      ]),
    ],
    layer: "semantic",
    rule: "block.overlap",
    path: "devices.0.blocks.1",
    description: "Dois blocos de holding registers sobrepostos (1000–1013 e 1010–1019).",
  },
  "gateway-config.invalid.duplicate-tag-id": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.2.tags.0.id", ID.tagSop01Total)],
    layer: "semantic",
    rule: "ids.unique",
    path: "devices.2.tags.0.id",
    description: "Id de tag repetido em dispositivos diferentes.",
  },
  "gateway-config.invalid.tag-machine-unknown": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("devices.2.tags.0.machine_id", UNKNOWN_ID)],
    layer: "semantic",
    rule: "tag.machine_ref",
    path: "devices.2.tags.0.machine_id",
    description: "Tag ligada a máquina que não está em machines.",
  },
  "gateway-config.invalid.machine-missing-role": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("machines.2.state_rules", { mode: "signals" })],
    layer: "semantic",
    rule: "machine.mode_roles",
    path: "machines.2.state_rules.mode",
    description: "Modo signals numa máquina sem tag state.running.",
  },
  "gateway-config.invalid.comm-loss-too-short": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("machines.1.state_rules.comm_loss_after_s", 1)],
    layer: "semantic",
    rule: "machine.comm_loss",
    path: "machines.1.state_rules.comm_loss_after_s",
    description: "comm_loss_after_s de 1 s com tags lidas a cada 500 ms (mínimo 3 × poll).",
  },
  "gateway-config.invalid.heartbeat-without-tag": {
    schema: "gateway-config",
    base: CONFIG,
    patch: [set("machines.1.state_rules.heartbeat_timeout_s", 5)],
    layer: "semantic",
    rule: "machine.heartbeat",
    path: "machines.1.state_rules.heartbeat_timeout_s",
    description: "heartbeat_timeout_s numa máquina sem tag plc.heartbeat.",
  },

  // -------------------------------------------------------------------------
  // POST /sync — requisição
  // -------------------------------------------------------------------------
  "sync-request.invalid.event-id-not-v7": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("events.0.id", "3b241101-e2bb-4255-8caf-4136c566a962")],
    layer: "schema",
    path: "events.0.id",
    description: "Id de evento UUIDv4 (o contrato exige UUIDv7).",
  },
  "sync-request.invalid.timestamp-with-offset": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("events.3.at", "2026-11-11T10:01:42.250-03:00")],
    layer: "schema",
    path: "events.3.at",
    description: "Timestamp com fuso -03:00 (o contrato exige UTC com 'Z').",
  },
  "sync-request.invalid.timestamp-without-zone": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("live.0.at", "2026-11-11T13:02:05.000")],
    layer: "schema",
    path: "live.0.at",
    description: "Timestamp sem fuso.",
  },
  "sync-request.invalid.minute-not-aligned": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("minutes.0.t", "2026-11-11T13:00:30Z")],
    layer: "schema",
    path: "minutes.0.t",
    description: "Minuto que não começa no segundo zero.",
  },
  "sync-request.invalid.minute-without-setup": {
    schema: "sync-request",
    base: SYNC,
    patch: [remove("minutes.0.setup_s")],
    layer: "schema",
    path: "minutes.0.setup_s",
    description: "Minuto sem setup_s.",
  },
  "sync-request.invalid.negative-count": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("minutes.0.total", -1)],
    layer: "schema",
    path: "minutes.0.total",
    description: "Contagem negativa no minuto.",
  },
  "sync-request.invalid.cpu-over-100": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("agent.cpu_pct", 140)],
    layer: "schema",
    path: "agent.cpu_pct",
    description: "cpu_pct acima de 100.",
  },
  "sync-request.invalid.unknown-event-type": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("events.1.type", "product_change")],
    layer: "schema",
    path: "events.1.type",
    description: "Tipo de evento desconhecido.",
  },
  "sync-request.invalid.command-result-without-type": {
    schema: "sync-request",
    base: SYNC,
    patch: [remove("command_results.0.type")],
    layer: "schema",
    path: "command_results.0.type",
    description: "Resultado de comando sem type (formato antigo do exemplo do docs/04).",
  },
  "sync-request.invalid.minute-seconds-sum": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("minutes.0.run_s", 59)],
    layer: "semantic",
    rule: "minute.seconds_sum",
    path: "minutes.0.run_s",
    description: "Segundos do minuto somando 59 (deve ser 60).",
  },
  "sync-request.invalid.seq-out-of-range": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("events.0.seq", 18230)],
    layer: "semantic",
    rule: "batch.seq_range",
    path: "events.0.seq",
    description: "seq fora da faixa seq_from–seq_to do lote.",
  },
  "sync-request.invalid.seq-duplicate": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("minutes.1.seq", 18234)],
    layer: "semantic",
    rule: "batch.seq_unique",
    path: "minutes.1.seq",
    description: "Dois itens com o mesmo seq.",
  },
  "sync-request.invalid.seq-range-missing": {
    schema: "sync-request",
    base: SYNC,
    patch: [remove("batch.seq_from"), remove("batch.seq_to")],
    layer: "semantic",
    rule: "batch.seq_required",
    path: "batch.seq_from",
    description: "Lote com itens e sem seq_from/seq_to.",
  },
  "sync-request.invalid.duplicate-event-id": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("events.1.id", ID.evtSop01Running)],
    layer: "semantic",
    rule: "event.id_unique",
    path: "events.1.id",
    description: "Dois eventos com o mesmo id.",
  },
  "sync-request.invalid.duplicate-minute": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("minutes.3.t", "2026-11-11T13:00:00Z")],
    layer: "semantic",
    rule: "minute.unique",
    path: "minutes.3.t",
    description: "Mesmo minuto (machine_id, t) duas vezes no lote.",
  },
  "sync-request.invalid.live-since-after-at": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("live.0.state_since", "2026-11-11T13:02:06.000Z")],
    layer: "semantic",
    rule: "live.since",
    path: "live.0.state_since",
    description: "state_since posterior a at.",
  },
  "sync-request.invalid.live-duplicate": {
    schema: "sync-request",
    base: SYNC,
    patch: [set("live.1.machine_id", ID.mchInj03)],
    layer: "semantic",
    rule: "live.unique",
    path: "live.1.machine_id",
    description: "Duas linhas live da mesma máquina.",
  },

  // -------------------------------------------------------------------------
  // POST /sync — resposta (comandos)
  // -------------------------------------------------------------------------
  "sync-response.invalid.command-without-expiry": {
    schema: "sync-response",
    base: RESPONSE,
    patch: [remove("commands.0.expires_at")],
    layer: "schema",
    path: "commands.0.expires_at",
    description: "Comando sem expires_at (todo comando expira).",
  },
  "sync-response.invalid.next-sync-zero": {
    schema: "sync-response",
    base: RESPONSE,
    patch: [set("next_sync_s", 0)],
    layer: "schema",
    path: "next_sync_s",
    description: "next_sync_s = 0 (mínimo 1).",
  },
  "sync-response.invalid.unknown-command-type": {
    schema: "sync-response",
    base: RESPONSE,
    patch: [set("commands.3.type", "agent.update")],
    layer: "schema",
    path: "commands.3.type",
    description: "Tipo de comando fora do v1 na resposta tipada (o envelope aceitaria).",
  },
  "sync-response.invalid.scan-unit-zero": {
    schema: "sync-response",
    base: RESPONSE,
    patch: [set("commands.5.payload.unit_from", 0)],
    layer: "schema",
    path: "commands.5.payload.unit_from",
    description: "Varredura a partir do unit id 0.",
  },
  "sync-response.invalid.probe-126-registers": {
    schema: "sync-response",
    base: RESPONSE,
    patch: [set("commands.1.payload.probe.count", 126)],
    layer: "schema",
    path: "commands.1.payload.probe.count",
    description: "Leitura de teste de 126 registradores (máximo 125).",
  },
  "sync-response.invalid.approval-not-jws": {
    schema: "sync-response",
    base: RESPONSE,
    patch: [set("commands.6.payload.approval", "aprovado")],
    layer: "schema",
    path: "commands.6.payload.approval",
    description: "vpn.enable sem aprovação assinada (JWS).",
  },
  "sync-response.invalid.tag-read-without-word-order": {
    schema: "sync-response",
    base: RESPONSE,
    patch: [remove("commands.0.payload.word_order")],
    layer: "semantic",
    rule: "address.word_order",
    path: "commands.0.payload.word_order",
    description: "tag.read de uint32 sem word_order.",
  },
  "sync-response.invalid.scan-range-inverted": {
    schema: "sync-response",
    base: RESPONSE,
    patch: [set("commands.5.payload.unit_from", 40)],
    layer: "semantic",
    rule: "scan.range",
    path: "commands.5.payload.unit_to",
    description: "Varredura com unit_from (40) maior que unit_to (32).",
  },
  "sync-response.invalid.device-test-bus-mismatch": {
    schema: "sync-response",
    base: RESPONSE,
    patch: [set("commands.2.payload.serial_bus.id", UNKNOWN_ID)],
    layer: "semantic",
    rule: "device_test.bus",
    path: "commands.2.payload.serial_bus",
    description: "device.test com serial_bus de id diferente de params.bus.",
  },
  "sync-response.invalid.expiry-before-issue": {
    schema: "sync-response",
    base: RESPONSE,
    patch: [set("commands.0.expires_at", "2026-11-11T13:02:05.000Z")],
    layer: "semantic",
    rule: "command.expiry",
    path: "commands.0.expires_at",
    description: "expires_at anterior a issued_at.",
  },
  "sync-response.invalid.duplicate-command-id": {
    schema: "sync-response",
    base: RESPONSE,
    patch: [set("commands.1.id", ID.cmdTagRead)],
    layer: "semantic",
    rule: "command.unique",
    path: "commands.1.id",
    description: "Dois comandos com o mesmo id.",
  },

  // -------------------------------------------------------------------------
  // Enroll, envelope, erros e aprovações
  // -------------------------------------------------------------------------
  "enroll-request.invalid.code-format": {
    schema: "enroll-request",
    base: "enroll-request.valid",
    patch: [set("code", "ABCD-12345")],
    layer: "schema",
    path: "code",
    description: "Código de ativação com 9 caracteres.",
  },
  "enroll-request.invalid.arch": {
    schema: "enroll-request",
    base: "enroll-request.valid",
    patch: [set("hw.arch", "mips")],
    layer: "schema",
    path: "hw.arch",
    description: "Arquitetura não suportada.",
  },
  "enroll-response.invalid.token-format": {
    schema: "enroll-response",
    base: "enroll-response.valid",
    patch: [set("token", "8f2c4e1a")],
    layer: "schema",
    path: "token",
    description: "Token sem o prefixo gw_live_/gw_test_.",
  },
  "command-envelope.invalid.type-name": {
    schema: "command-envelope",
    base: "command-envelope.valid.future-type",
    patch: [set("type", "Agent Update")],
    layer: "schema",
    path: "type",
    description: "Nome de tipo de comando fora do padrão (minúsculas separadas por ponto).",
  },
  "error-response.invalid.unknown-code": {
    schema: "error-response",
    base: "error-response.valid.rate-limited",
    patch: [set("error.code", "teapot")],
    layer: "schema",
    path: "error.code",
    description: "Código de erro fora da tabela.",
  },
  "vpn-approval-claims.invalid.typ": {
    schema: "vpn-approval-claims",
    base: "vpn-approval-claims.valid",
    patch: [set("typ", "engemase.ot_forward_approval.v1")],
    layer: "schema",
    path: "typ",
    description: "Claims de outro tipo de aprovação (impede reaproveitar a assinatura).",
  },
}
