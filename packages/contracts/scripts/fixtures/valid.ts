/**
 * Fixtures VÁLIDAS (tipadas contra o contrato). Geradas em fixtures/*.json por `build:fixtures`.
 */
import type {
  Command,
  CommandResult,
  ContractSchemaName,
  EnrollRequest,
  EnrollResponse,
  ErrorResponse,
  Event,
  GatewayConfig,
  OtForwardApprovalClaims,
  SyncRequest,
  SyncResponse,
  VpnApprovalClaims,
} from "../../src/index"
import { ID, uuidv7At } from "./ids"
import { signApproval } from "./jws"

export interface ValidFixture {
  readonly schema: ContractSchemaName
  readonly description: string
  readonly data: unknown
}

// ---------------------------------------------------------------------------
// Enroll
// ---------------------------------------------------------------------------

export const enrollRequest = {
  code: "ABCD-1234",
  hostname: "gw-planta1-linhaA",
  agent_version: "1.0.0",
  hw: {
    arch: "arm64",
    model: "reComputer R1000",
    mem_mb: 2048,
    serial_number: "R1000-2611-00427",
    board_revision: "v1.1",
    profile: "recomputer-r1000",
    serial_ports: ["rs485-1", "rs485-2", "rs485-3"],
  },
} satisfies EnrollRequest

export const enrollResponse = {
  gateway_id: ID.gateway,
  token: "gw_live_8f2c4e1a9b7d3f6c0e5a2b8d4f1c7e3a9b6d0f2c5e8a1b4d",
  org: "acme",
  server_time: "2026-11-10T19:42:10.512Z",
} satisfies EnrollResponse

// ---------------------------------------------------------------------------
// Config: 1 CLP Modbus TCP (bloco OEE padrão) + 2 escravos RTU no mesmo barramento
// ---------------------------------------------------------------------------

export const configTcpAndRtuBus = {
  config_version: 42,
  gateway_id: ID.gateway,
  generated_at: "2026-11-11T12:58:00.000Z",
  serial_buses: [
    {
      id: ID.bus1,
      name: "RS-485 1 (sopradoras)",
      port: "rs485-1",
      baud: 19200,
      parity: "E",
      data_bits: 8,
      stop_bits: 1,
    },
  ],
  devices: [
    {
      id: ID.devInj03,
      name: "CLP Injetora 03",
      protocol: "modbus-tcp",
      params: { host: "192.168.10.23", port: 502, unit_id: 1, timeout_ms: 500 },
      blocks: [{ area: "holding_register", start: 1000, count: 14, poll_ms: 500 }],
      tags: [
        {
          id: ID.tagInjHeartbeat,
          name: "Heartbeat do CLP",
          address: { area: "holding_register", offset: 1001 },
          type: "uint16",
          role: "plc.heartbeat",
          machine_id: ID.mchInj03,
        },
        {
          id: ID.tagInjState,
          name: "Estado da máquina",
          address: { area: "holding_register", offset: 1002 },
          type: "uint16",
          role: "state.code",
          machine_id: ID.mchInj03,
        },
        {
          id: ID.tagInjFault,
          name: "Código do alarme",
          address: { area: "holding_register", offset: 1003 },
          type: "uint16",
          role: "fault.code",
          machine_id: ID.mchInj03,
        },
        {
          id: ID.tagInjTotal,
          name: "Contador total",
          address: { area: "holding_register", offset: 1004 },
          type: "uint32",
          word_order: "CDAB",
          role: "count.total",
          machine_id: ID.mchInj03,
        },
        {
          id: ID.tagInjReject,
          name: "Contador de refugo",
          address: { area: "holding_register", offset: 1006 },
          type: "uint32",
          word_order: "CDAB",
          role: "count.reject",
          machine_id: ID.mchInj03,
        },
        {
          id: ID.tagInjProduct,
          name: "Produto / receita",
          address: { area: "holding_register", offset: 1010 },
          type: "uint16",
          role: "product.code",
          machine_id: ID.mchInj03,
        },
        {
          id: ID.tagInjSpeed,
          name: "Velocidade atual",
          address: { area: "holding_register", offset: 1011 },
          type: "uint16",
          scale: { mul: 0.1 },
          role: "speed.actual",
          machine_id: ID.mchInj03,
          sampling: { deadband: 1, min_interval_s: 10, max_interval_s: 300 },
        },
        {
          id: ID.tagInjTemp,
          name: "Temperatura do molde (°C)",
          address: { area: "input_register", offset: 20 },
          type: "float32",
          word_order: "CDAB",
          poll_ms: 1000,
          role: "custom",
          machine_id: ID.mchInj03,
          sampling: { deadband: 0.5, min_interval_s: 5, max_interval_s: 60 },
        },
      ],
    },
    {
      id: ID.devSop01,
      name: "CLP Sopradora 01",
      protocol: "modbus-rtu",
      params: { bus: ID.bus1, unit_id: 1, timeout_ms: 300 },
      tags: [
        {
          id: ID.tagSop01Running,
          address: { area: "coil", offset: 0 },
          type: "bool",
          poll_ms: 250,
          role: "state.running",
          machine_id: ID.mchSop01,
        },
        {
          id: ID.tagSop01Fault,
          address: { area: "holding_register", offset: 110, bit: 3 },
          type: "bool",
          poll_ms: 250,
          role: "state.fault",
          machine_id: ID.mchSop01,
        },
        {
          id: ID.tagSop01Total,
          address: { area: "holding_register", offset: 100 },
          type: "uint32",
          word_order: "CDAB",
          poll_ms: 500,
          role: "count.total",
          machine_id: ID.mchSop01,
        },
      ],
    },
    {
      id: ID.devSop02,
      name: "Módulo I/O Sopradora 02",
      protocol: "modbus-rtu",
      params: { bus: ID.bus1, unit_id: 2, timeout_ms: 300 },
      tags: [
        {
          id: ID.tagSop02Total,
          address: { area: "input_register", offset: 16 },
          type: "uint32",
          word_order: "CDAB",
          poll_ms: 500,
          role: "count.total",
          machine_id: ID.mchSop02,
        },
      ],
    },
  ],
  machines: [
    {
      id: ID.mchInj03,
      name: "Injetora 03",
      state_rules: {
        mode: "state_code",
        map: { "0": "STOPPED", "1": "RUNNING", "2": "FAULT", "3": "SETUP", "4": "STOPPED", "5": "FAULT" },
        default_state: "STOPPED",
        comm_loss_after_s: 10,
        debounce_s: 1,
        heartbeat_timeout_s: 5,
      },
      max_rate_per_s: 2,
    },
    {
      id: ID.mchSop01,
      name: "Sopradora 01",
      state_rules: { mode: "signals", comm_loss_after_s: 10 },
    },
    {
      id: ID.mchSop02,
      name: "Sopradora 02",
      state_rules: { mode: "count_derived", ideal_cycle_s: 6, idle_after_cycles: 3 },
    },
  ],
  uplink: { sync_interval_s: 10, max_batch_items: 2000 },
} satisfies GatewayConfig

/** Config mínima só com Modbus TCP: módulo de I/O remoto (retrofit) com unit id 255. */
export const configTcpOnlyIo = {
  config_version: 7,
  serial_buses: [],
  devices: [
    {
      id: ID.devIoLinha2,
      name: "I/O remoto Prensa 07",
      protocol: "modbus-tcp",
      params: { host: "io-linha2.local", port: 502, unit_id: 255 },
      blocks: [{ area: "discrete_input", start: 0, count: 8, poll_ms: 200 }],
      tags: [
        {
          id: ID.tagPrensaRunning,
          address: { area: "discrete_input", offset: 0 },
          type: "bool",
          role: "state.running",
          machine_id: ID.mchPrensa07,
        },
        {
          id: ID.tagPrensaTotal,
          name: "Contador rápido (hardware)",
          address: { area: "input_register", offset: 0 },
          type: "uint32",
          word_order: "ABCD",
          poll_ms: 1000,
          role: "count.total",
          machine_id: ID.mchPrensa07,
        },
      ],
    },
  ],
  machines: [{ id: ID.mchPrensa07, state_rules: { mode: "signals" } }],
  uplink: { sync_interval_s: 10, max_batch_items: 500, max_batch_bytes: 524_288 },
} satisfies GatewayConfig

// ---------------------------------------------------------------------------
// /sync — requisição
// ---------------------------------------------------------------------------

const agentHealth = {
  version: "1.2.0",
  uptime_s: 86_400,
  config_version: 42,
  cpu_pct: 7.5,
  mem_mb: 38,
  disk_free_mb: 21_000,
  buffer_pending: 15,
  clock_offset_ms: 12,
} satisfies SyncRequest["agent"]

/** /sync realista: 3 máquinas, eventos, minutos fechados, live, amostras e resultados de comandos. */
export const syncRequestRealistic = {
  batch: { seq_from: 18231, seq_to: 18245, sent_at: "2026-11-11T13:02:05.120Z" },
  agent: {
    ...agentHealth,
    config_status: { version: 42, state: "applied", at: "2026-11-11T12:58:12.000Z" },
    buffer_oldest_s: 113,
    samples_pending: 0,
    quarantined: 0,
    temp_c: 47.5,
    emmc_wear_pct: 3,
    ntp_synced: true,
    boot_id: ID.bootId,
    unclean_boots_24h: 0,
  },
  devices: [
    {
      id: ID.devInj03,
      status: "connected",
      latency_ms: 18,
      errors_1m: 0,
      timeouts_1m: 0,
      last_ok_at: "2026-11-11T13:02:04.900Z",
    },
    { id: ID.devSop01, status: "connected", latency_ms: 24, errors_1m: 0 },
    {
      id: ID.devSop02,
      status: "degraded",
      latency_ms: 41,
      errors_1m: 2,
      timeouts_1m: 2,
      exceptions_1m: { "11": 0 },
      last_ok_at: "2026-11-11T13:02:04.500Z",
      last_error: "Timeout de leitura (300 ms) no unit id 2.",
    },
  ],
  buses: [{ id: ID.bus1, status: "ok", cycle_ms: 380, busy_pct: 42.5, overruns_1m: 0, unsolicited_bytes_1m: 0 }],
  events: [
    {
      id: ID.evtSop01Running,
      seq: 18231,
      type: "state",
      machine_id: ID.mchSop01,
      at: "2026-11-11T13:00:12.250Z",
      state: "RUNNING",
      previous_state: "STOPPED",
    },
    {
      id: ID.evtInjProduct,
      seq: 18232,
      type: "product",
      machine_id: ID.mchInj03,
      at: "2026-11-11T13:00:27.250Z",
      product: "7",
      previous_product: "6",
    },
    {
      id: ID.evtSop02Reset,
      seq: 18233,
      type: "counter_reset",
      machine_id: ID.mchSop02,
      tag_id: ID.tagSop02Total,
      role: "count.total",
      at: "2026-11-11T13:00:42.250Z",
      previous_raw: 50_213,
      raw: 3,
    },
    {
      id: ID.evtInjFault,
      seq: 18240,
      type: "state",
      machine_id: ID.mchInj03,
      at: "2026-11-11T13:01:42.250Z",
      state: "FAULT",
      fault_code: 47,
      previous_state: "RUNNING",
    },
  ],
  minutes: [
    {
      seq: 18234,
      machine_id: ID.mchInj03,
      t: "2026-11-11T13:00:00Z",
      run_s: 60,
      stop_s: 0,
      fault_s: 0,
      setup_s: 0,
      no_comm_s: 0,
      total: 15,
      reject: 0,
      product: "7",
    },
    {
      seq: 18235,
      machine_id: ID.mchSop01,
      t: "2026-11-11T13:00:00Z",
      run_s: 48,
      stop_s: 12,
      fault_s: 0,
      setup_s: 0,
      no_comm_s: 0,
      total: 8,
      reject: 0,
    },
    {
      seq: 18236,
      machine_id: ID.mchSop02,
      t: "2026-11-11T13:00:00Z",
      run_s: 54,
      stop_s: 6,
      fault_s: 0,
      setup_s: 0,
      no_comm_s: 0,
      total: 9,
      reject: 0,
    },
    {
      seq: 18241,
      machine_id: ID.mchInj03,
      t: "2026-11-11T13:01:00Z",
      run_s: 42,
      stop_s: 0,
      fault_s: 18,
      setup_s: 0,
      no_comm_s: 0,
      total: 14,
      reject: 1,
      product: "7",
    },
    {
      seq: 18242,
      machine_id: ID.mchSop01,
      t: "2026-11-11T13:01:00Z",
      run_s: 60,
      stop_s: 0,
      fault_s: 0,
      setup_s: 0,
      no_comm_s: 0,
      total: 10,
      reject: 0,
    },
    {
      seq: 18243,
      machine_id: ID.mchSop02,
      t: "2026-11-11T13:01:00Z",
      run_s: 54,
      stop_s: 0,
      fault_s: 0,
      setup_s: 0,
      no_comm_s: 6,
      total: 9,
      reject: 0,
    },
  ],
  live: [
    {
      machine_id: ID.mchInj03,
      at: "2026-11-11T13:02:05.000Z",
      state: "FAULT",
      state_since: "2026-11-11T13:01:42.250Z",
      fault_code: 47,
      counter_total: 1_048_213,
      product: "7",
      speed: 0,
    },
    {
      machine_id: ID.mchSop01,
      at: "2026-11-11T13:02:05.000Z",
      state: "RUNNING",
      state_since: "2026-11-11T13:00:12.250Z",
      counter_total: 88_123,
    },
    {
      machine_id: ID.mchSop02,
      at: "2026-11-11T13:02:04.500Z",
      state: "RUNNING",
      state_since: "2026-11-11T12:41:03.000Z",
      counter_total: 21,
    },
  ],
  samples: [
    { seq: 18237, tag_id: ID.tagInjTemp, at: "2026-11-11T13:00:30Z", v: 211.9, q: "good" },
    { seq: 18238, tag_id: ID.tagInjSpeed, at: "2026-11-11T13:00:45Z", v: 14.5 },
    { seq: 18239, tag_id: ID.tagInjTemp, at: "2026-11-11T13:01:30Z", v: 212.1 },
    { seq: 18244, tag_id: ID.tagInjSpeed, at: "2026-11-11T13:01:45Z", v: 0 },
    { seq: 18245, tag_id: ID.tagInjTemp, at: "2026-11-11T13:02:00Z", v: 212.4 },
  ],
  command_results: [
    {
      id: ID.cmdTagReadDone,
      type: "tag.read",
      status: "ok",
      finished_at: "2026-11-11T13:01:56.031Z",
      duration_ms: 25,
      result: { value: 1_048_213, raw: [65_173, 15], quality: "good", read_ms: 21 },
    },
    {
      id: ID.cmdDeviceTestDone,
      type: "device.test",
      status: "error",
      finished_at: "2026-11-11T13:01:58.410Z",
      duration_ms: 64,
      error: {
        code: "modbus_exception",
        message: "O dispositivo respondeu com a exceção 02 (endereço inválido) ao ler HR 2000.",
        modbus_exception: 2,
      },
    },
    {
      id: ID.cmdUnknownDone,
      type: "agent.update",
      status: "rejected",
      error: { code: "unsupported", message: "Tipo de comando desconhecido para o agente 1.2.0." },
    },
  ],
} satisfies SyncRequest

/** Sync só de saúde: nada na fila, sem faixa de seq. */
export const syncRequestHealthOnly = {
  batch: { sent_at: "2026-11-11T13:02:15.118Z" },
  agent: { ...agentHealth, uptime_s: 86_410, buffer_pending: 0 },
  devices: [{ id: ID.devInj03, status: "connected", latency_ms: 17, errors_1m: 0 }],
} satisfies SyncRequest

/** Amostras com fila própria (samples_seq_* e ack_samples_seq). */
export const syncRequestSamplesQueue = {
  batch: {
    seq_from: 501,
    seq_to: 502,
    samples_seq_from: 9001,
    samples_seq_to: 9003,
    sent_at: "2026-11-11T13:03:05.020Z",
  },
  agent: { ...agentHealth, buffer_pending: 2, samples_pending: 3 },
  events: [
    {
      id: uuidv7At("2026-11-11T13:02:31.700Z", "samples-queue-1"),
      seq: 501,
      type: "state",
      machine_id: ID.mchInj03,
      at: "2026-11-11T13:02:31.700Z",
      state: "RUNNING",
    },
  ],
  minutes: [
    {
      seq: 502,
      machine_id: ID.mchInj03,
      t: "2026-11-11T13:02:00Z",
      run_s: 28,
      stop_s: 0,
      fault_s: 32,
      setup_s: 0,
      no_comm_s: 0,
      total: 9,
      reject: 0,
      good: 9,
      product: "7",
    },
  ],
  samples: [
    { seq: 9001, tag_id: ID.tagInjTemp, at: "2026-11-11T13:02:30Z", v: 212.9 },
    { seq: 9002, tag_id: ID.tagInjTemp, at: "2026-11-11T13:03:00Z", v: 213.4 },
    { seq: 9003, tag_id: ID.tagInjSpeed, at: "2026-11-11T13:02:45Z", v: 15.2, q: "good" },
  ],
} satisfies SyncRequest

const allEventTypes: Event[] = (() => {
  const at = (mm: string) => `2026-11-11T06:${mm}Z`
  const base = (seq: number, time: string) => ({ id: uuidv7At(at(time), `evt-${seq}`), seq, at: at(time) })
  return [
    { ...base(1, "00:00.000"), type: "agent_start", version: "1.2.0", boot_id: ID.bootId, clean_shutdown: false },
    { ...base(2, "00:00.150"), type: "power_restored", down_s: 340 },
    { ...base(3, "00:01.020"), type: "clock_jump", jump_ms: 4200 },
    { ...base(4, "00:02.500"), type: "config_applied", version: 42, previous_version: 41 },
    {
      ...base(5, "00:04.800"),
      type: "state",
      machine_id: ID.mchSop01,
      state: "RUNNING",
      previous_state: "NO_COMM",
    },
    { ...base(6, "00:05.000"), type: "product", machine_id: ID.mchInj03, product: "7", previous_product: "6" },
    {
      ...base(7, "00:05.250"),
      type: "counter_reset",
      machine_id: ID.mchSop02,
      tag_id: ID.tagSop02Total,
      role: "count.total",
      previous_raw: 50_213,
      raw: 3,
    },
    {
      ...base(8, "00:05.500"),
      type: "counter_jump",
      machine_id: ID.mchSop01,
      tag_id: ID.tagSop01Total,
      role: "count.total",
      previous_raw: 88_000,
      raw: 1_088_000,
      discarded_delta: 1_000_000,
    },
    {
      ...base(9, "00:06.000"),
      type: "counter_rebaseline",
      machine_id: ID.mchInj03,
      tag_id: ID.tagInjTotal,
      role: "count.total",
      previous_raw: 1_047_000,
      raw: 12,
    },
    {
      ...base(10, "00:06.100"),
      type: "data_loss",
      reason: "retention_limit",
      lost_seq_from: 100,
      lost_seq_to: 199,
      items: 100,
      period_from: "2026-10-10T08:00:00Z",
      period_to: "2026-10-10T09:39:00Z",
    },
    { ...base(11, "00:06.200"), type: "buffer_corrupted", detail: "buffer.db recriado após falha de integridade." },
    {
      ...base(12, "00:07.000"),
      type: "config_rejected",
      version: 43,
      error: "devices.1.params.unit_id: unit_id repetido no mesmo barramento.",
      reverted_to: 42,
    },
    {
      ...base(13, "10:00.000"),
      type: "remote_access",
      action: "session_started",
      session_id: ID.vpnSession,
      actor: "suporte-engemase:ana",
    },
    { ...base(14, "59:58.000"), type: "power_fail" },
    { ...base(15, "59:59.500"), type: "agent_stop", reason: "shutdown", detail: "Falta de energia (UPS)." },
  ]
})()

/** Um evento de cada tipo, na ordem em que poderiam acontecer. */
export const syncRequestAllEventTypes = {
  batch: { seq_from: 1, seq_to: 15, sent_at: "2026-11-11T07:00:01.000Z" },
  agent: { ...agentHealth, uptime_s: 3601, buffer_pending: 15 },
  events: allEventTypes,
} satisfies SyncRequest

// ---------------------------------------------------------------------------
// Comandos (resposta do /sync) — um de cada tipo
// ---------------------------------------------------------------------------

const ISSUED = "2026-11-11T13:02:05.300Z"
const ttl = (seconds: number) => new Date(Date.parse(ISSUED) + seconds * 1000).toISOString()

export const vpnApprovalClaims = {
  typ: "engemase.vpn_approval.v1",
  gateway_id: ID.gateway,
  session_id: ID.vpnSession,
  requested_by: "u_9QmT4kXr2LpV7cNz",
  approved_by: "u_3HdW8sYb6RfJ1aKe",
  approved_at: "2026-11-11T13:00:30Z",
  not_after: "2026-11-11T16:30:00Z",
  allow_ot_forward: true,
} satisfies VpnApprovalClaims

export const otForwardApprovalClaims = {
  typ: "engemase.ot_forward_approval.v1",
  gateway_id: ID.gateway,
  session_id: ID.vpnSession,
  forward_id: ID.otForward,
  device_id: ID.devInj03,
  host: "192.168.10.23",
  port: 502,
  approved_by: "u_3HdW8sYb6RfJ1aKe",
  approved_at: "2026-11-11T13:01:40Z",
  not_after: "2026-11-11T13:32:00Z",
  max_connections: 1,
} satisfies OtForwardApprovalClaims

const cmdDeviceTestRtu = uuidv7At("2026-11-11T13:02:01.000Z", "device-test-rtu")

export const allCommands: Command[] = [
  {
    id: ID.cmdTagRead,
    type: "tag.read",
    issued_at: ISSUED,
    expires_at: ttl(120),
    payload: {
      device_id: ID.devInj03,
      address: { area: "holding_register", offset: 1004 },
      type: "uint32",
      word_order: "CDAB",
    },
  },
  {
    id: ID.cmdDeviceTest,
    type: "device.test",
    issued_at: ISSUED,
    expires_at: ttl(120),
    payload: {
      device_id: ID.newDevice,
      connection: {
        protocol: "modbus-rtu-over-tcp",
        params: { host: "192.168.10.40", port: 4001, unit_id: 3, timeout_ms: 500 },
      },
      probe: { area: "holding_register", offset: 0, count: 10 },
    },
  },
  {
    id: cmdDeviceTestRtu,
    type: "device.test",
    issued_at: ISSUED,
    expires_at: ttl(120),
    payload: {
      device_id: ID.devSop02,
      connection: { protocol: "modbus-rtu", params: { bus: ID.bus1, unit_id: 2, timeout_ms: 300 } },
      serial_bus: { id: ID.bus1, port: "rs485-1", baud: 9600, parity: "N", data_bits: 8, stop_bits: 2 },
      allow_bus_pause: true,
      probe: { area: "input_register", offset: 16, count: 2 },
    },
  },
  { id: ID.cmdConfigReload, type: "config.reload", issued_at: ISSUED, expires_at: ttl(600), payload: {} },
  {
    id: ID.cmdAgentRestart,
    type: "agent.restart",
    issued_at: ISSUED,
    expires_at: ttl(600),
    payload: { reason: "Teste de reinício pedido pelo suporte", delay_s: 5 },
  },
  {
    id: ID.cmdModbusScan,
    type: "modbus.scan",
    issued_at: ISSUED,
    expires_at: ttl(600),
    payload: {
      mode: "unit_ids",
      bus_id: ID.bus1,
      unit_from: 1,
      unit_to: 32,
      probe: { area: "holding_register", offset: 0 },
      timeout_ms: 200,
    },
  },
  {
    id: ID.cmdVpnEnable,
    type: "vpn.enable",
    issued_at: ISSUED,
    expires_at: ttl(300),
    payload: {
      session_id: ID.vpnSession,
      auth_key: "TEST-ONLY-vpn-auth-key-0000000000000000",
      node_name: "gw-planta1-linhaa",
      session_expires_at: "2026-11-11T16:30:00Z",
      idle_timeout_s: 900,
      approval: signApproval(vpnApprovalClaims),
    },
  },
  {
    id: ID.cmdVpnStatus,
    type: "vpn.status",
    issued_at: ISSUED,
    expires_at: ttl(120),
    payload: { session_id: ID.vpnSession },
  },
  {
    id: ID.cmdOtForwardOpen,
    type: "ot.forward.open",
    issued_at: ISSUED,
    expires_at: ttl(300),
    payload: {
      session_id: ID.vpnSession,
      forward_id: ID.otForward,
      device_id: ID.devInj03,
      host: "192.168.10.23",
      port: 502,
      forward_expires_at: "2026-11-11T13:32:00Z",
      max_connections: 1,
      approval: signApproval(otForwardApprovalClaims),
    },
  },
  {
    id: ID.cmdOtForwardClose,
    type: "ot.forward.close",
    issued_at: ISSUED,
    expires_at: ttl(3600),
    payload: { session_id: ID.vpnSession, forward_id: ID.otForward, reason: "requested" },
  },
  {
    id: ID.cmdVpnDisable,
    type: "vpn.disable",
    issued_at: ISSUED,
    expires_at: ttl(3600),
    payload: { session_id: ID.vpnSession, reason: "requested" },
  },
]

/** Resposta do exemplo do docs/04 (tag.read em modo interativo, next_sync_s = 1). */
export const syncResponseRealistic = {
  ack_seq: 18245,
  server_time: "2026-11-11T13:02:05.410Z",
  config: { latest_version: 43 },
  commands: allCommands.filter((c) => c.type === "tag.read"),
  next_sync_s: 1,
  min_agent_version: "1.0.0",
} satisfies SyncResponse

export const syncResponseAllCommandTypes = {
  ack_seq: 502,
  ack_samples_seq: 9003,
  server_time: "2026-11-11T13:03:05.233Z",
  config: { latest_version: 42 },
  commands: allCommands,
  next_sync_s: 1,
  min_agent_version: "1.0.0",
} satisfies SyncResponse

export const syncResponseIdle = {
  ack_seq: 0,
  server_time: "2026-11-11T13:02:15.402Z",
  config: { latest_version: 42 },
  commands: [],
  next_sync_s: 10,
  min_agent_version: "1.0.0",
} satisfies SyncResponse

// ---------------------------------------------------------------------------
// Resultados de comando — um de cada tipo (sucesso) + falhas
// ---------------------------------------------------------------------------

const done = (id: string, ms: number) => ({ id, finished_at: ttl(ms / 1000 + 2), duration_ms: ms })

export const allCommandResults: CommandResult[] = [
  {
    ...done(ID.cmdTagRead, 25),
    type: "tag.read",
    status: "ok",
    result: { value: 1_048_213, raw: [65_173, 15], quality: "good", read_ms: 21 },
  },
  {
    ...done(ID.cmdDeviceTest, 140),
    type: "device.test",
    status: "ok",
    result: { latency_ms: 38, probe: { raw: [1, 0, 2, 47, 15, 0, 0, 0, 7, 120], read_ms: 31 } },
  },
  {
    ...done(cmdDeviceTestRtu, 5000),
    type: "device.test",
    status: "error",
    error: { code: "read_timeout", message: "Sem resposta do unit id 2 em 300 ms (9600 8N2)." },
  },
  { ...done(ID.cmdConfigReload, 820), type: "config.reload", status: "ok", result: { version: 42, outcome: "unchanged" } },
  {
    ...done(ID.cmdAgentRestart, 3),
    type: "agent.restart",
    status: "ok",
    result: { restart_at: "2026-11-11T13:03:12.000Z" },
  },
  {
    ...done(ID.cmdModbusScan, 6900),
    type: "modbus.scan",
    status: "ok",
    result: {
      mode: "unit_ids",
      found: [
        { unit_id: 1, latency_ms: 22 },
        { unit_id: 2, latency_ms: 25 },
        { unit_id: 9, latency_ms: 31, exception: 2 },
      ],
      scanned: 32,
      duration_ms: 6880,
    },
  },
  {
    ...done(ID.cmdVpnEnable, 4200),
    type: "vpn.enable",
    status: "ok",
    result: {
      session_id: ID.vpnSession,
      state: "active",
      node_ip: "100.101.12.7",
      connection: "relay",
      session_expires_at: "2026-11-11T16:30:00Z",
    },
  },
  {
    ...done(ID.cmdVpnStatus, 12),
    type: "vpn.status",
    status: "ok",
    result: {
      state: "active",
      session_id: ID.vpnSession,
      node_ip: "100.101.12.7",
      connection: "relay",
      session_expires_at: "2026-11-11T16:30:00Z",
      idle_s: 42,
      active_connections: 1,
      forwards: [
        {
          forward_id: ID.otForward,
          device_id: ID.devInj03,
          host: "192.168.10.23",
          port: 502,
          listen_port: 15020,
          forward_expires_at: "2026-11-11T13:32:00Z",
          connections: 1,
        },
      ],
      local_policy: { allowed: true, allow_ot_forward: true, locked: false },
    },
  },
  {
    ...done(ID.cmdOtForwardOpen, 35),
    type: "ot.forward.open",
    status: "ok",
    result: { forward_id: ID.otForward, listen_port: 15020, forward_expires_at: "2026-11-11T13:32:00Z" },
  },
  {
    ...done(ID.cmdOtForwardClose, 20),
    type: "ot.forward.close",
    status: "ok",
    result: {
      forward_id: ID.otForward,
      closed_at: "2026-11-11T13:20:41.000Z",
      connections_total: 3,
      bytes_in: 48_220,
      bytes_out: 1_204_331,
    },
  },
  {
    ...done(ID.cmdVpnDisable, 900),
    type: "vpn.disable",
    status: "ok",
    result: {
      session_id: ID.vpnSession,
      started_at: "2026-11-11T13:02:09.000Z",
      ended_at: "2026-11-11T13:21:00.000Z",
      end_reason: "requested",
      bytes_in: 312_400,
      bytes_out: 2_901_133,
      ssh_logins: 1,
      forwards_opened: 1,
    },
  },
  {
    id: ID.cmdTagReadDone,
    type: "tag.read",
    status: "expired",
    error: { code: "expired", message: "Comando recebido depois de expires_at (2026-11-11T12:59:00Z)." },
  },
  {
    id: uuidv7At("2026-11-11T13:20:30.000Z", "vpn-denied"),
    type: "vpn.enable",
    status: "rejected",
    error: { code: "policy_denied", message: "Acesso remoto bloqueado localmente (remote-access off --lock)." },
  },
]

export const syncRequestAllCommandResults = {
  batch: { sent_at: "2026-11-11T13:21:05.000Z" },
  agent: { ...agentHealth, buffer_pending: 0 },
  command_results: allCommandResults,
} satisfies SyncRequest

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

export const errorInvalidPayload = {
  error: {
    code: "invalid_payload",
    message: "Payload inválido.",
    issues: [
      {
        path: ["minutes", 0, "run_s"],
        message: "A soma dos segundos do minuto é 61 (deve ser 60).",
        rule: "minute.seconds_sum",
      },
    ],
    request_id: "req_7f3a9c21",
  },
} satisfies ErrorResponse

export const errorRateLimited = {
  error: { code: "rate_limited", message: "Limite de taxa. Tente de novo em 30 s.", retry_after_s: 30 },
} satisfies ErrorResponse

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

export const VALID_FIXTURES: Readonly<Record<string, ValidFixture>> = {
  "enroll-request.valid": {
    schema: "enroll-request",
    description: "Enroll de um reComputer R1000 com dados de bancada (hw.json).",
    data: enrollRequest,
  },
  "enroll-response.valid": {
    schema: "enroll-response",
    description: "Resposta 201 do enroll.",
    data: enrollResponse,
  },
  "gateway-config.valid.tcp-and-rtu-bus": {
    schema: "gateway-config",
    description:
      "Config do docs/03: 1 CLP Modbus TCP com o bloco OEE padrão (HR 1000, 14 registradores) e 2 escravos RTU (unit 1 e 2) no mesmo barramento RS-485; modos state_code, signals e count_derived.",
    data: configTcpAndRtuBus,
  },
  "gateway-config.valid.tcp-only-io": {
    schema: "gateway-config",
    description: "Config mínima só TCP: I/O remoto (unit id 255) com bloco de discrete inputs e contador fora de bloco.",
    data: configTcpOnlyIo,
  },
  "sync-request.valid.realistic": {
    schema: "sync-request",
    description: "/sync realista: 3 máquinas, eventos (estado, produto, reset), 6 minutos fechados, live, amostras e 3 resultados de comando.",
    data: syncRequestRealistic,
  },
  "sync-request.valid.health-only": {
    schema: "sync-request",
    description: "Sync só de saúde (fila vazia, sem faixa de seq).",
    data: syncRequestHealthOnly,
  },
  "sync-request.valid.samples-queue": {
    schema: "sync-request",
    description: "Amostras com fila própria (samples_seq_from/samples_seq_to).",
    data: syncRequestSamplesQueue,
  },
  "sync-request.valid.all-event-types": {
    schema: "sync-request",
    description: "Um evento de cada tipo.",
    data: syncRequestAllEventTypes,
  },
  "sync-request.valid.all-command-results": {
    schema: "sync-request",
    description: "Um resultado de sucesso de cada tipo de comando, mais falhas (error, expired, rejected).",
    data: syncRequestAllCommandResults,
  },
  "sync-response.valid.realistic": {
    schema: "sync-response",
    description: "Resposta do docs/04: ack, nova versão de config e um tag.read em modo interativo.",
    data: syncResponseRealistic,
  },
  "sync-response.valid.all-command-types": {
    schema: "sync-response",
    description: "Um comando de cada tipo (inclusive vpn.* e ot.forward.* com aprovação assinada) e ack da fila de amostras.",
    data: syncResponseAllCommandTypes,
  },
  "sync-response.valid.idle": {
    schema: "sync-response",
    description: "Resposta sem comandos, ritmo normal (10 s).",
    data: syncResponseIdle,
  },
  "command-envelope.valid.future-type": {
    schema: "command-envelope",
    description: "Tipo de comando de versão futura (agent.update): o envelope aceita; o agente responde rejected/unsupported.",
    data: {
      id: ID.cmdUnknownDone,
      type: "agent.update",
      issued_at: ISSUED,
      expires_at: ttl(900),
      payload: { version: "1.3.0", channel: "stable" },
    },
  },
  "error-response.valid.invalid-payload": {
    schema: "error-response",
    description: "400 com o problema e o id da regra.",
    data: errorInvalidPayload,
  },
  "error-response.valid.rate-limited": {
    schema: "error-response",
    description: "429 com retry_after_s.",
    data: errorRateLimited,
  },
  "vpn-approval-claims.valid": {
    schema: "vpn-approval-claims",
    description: "Claims (payload decodificado) do JWS de aprovação de vpn.enable.",
    data: vpnApprovalClaims,
  },
  "ot-forward-approval-claims.valid": {
    schema: "ot-forward-approval-claims",
    description: "Claims (payload decodificado) do JWS de aprovação de ot.forward.open.",
    data: otForwardApprovalClaims,
  },
}
