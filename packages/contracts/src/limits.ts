/**
 * Limites e valores padrão do contrato v1.
 *
 * Os limites são validados pelos schemas. Os valores padrão NÃO são aplicados
 * pelos schemas (o contrato não tem `.default()`): quem consome aplica.
 */

/** Tamanho máximo do corpo JSON de um /sync, **descompactado** (1 MiB). */
export const MAX_SYNC_BODY_BYTES = 1_048_576

/** Máximo de itens de dados (events + minutes + samples) por lote. */
export const MAX_BATCH_ITEMS = 2000

/** Máximo de linhas `live` por /sync (uma por máquina). */
export const MAX_LIVE_ITEMS = 256

/** Máximo de resultados de comando por /sync. */
export const MAX_COMMAND_RESULTS = 50

/** Máximo de comandos entregues numa resposta de /sync. */
export const MAX_COMMANDS_PER_SYNC = 20

/** Limites de configuração por gateway. */
export const MAX_SERIAL_BUSES = 8
export const MAX_DEVICES = 64
export const MAX_MACHINES = 256
export const MAX_TAGS = 2000

/** Modbus: máximo de registradores (FC03/FC04) e de bits (FC01/FC02) por leitura. */
export const MAX_REGISTERS_PER_READ = 125
export const MAX_BITS_PER_READ = 2000

/** Modbus: maior offset (endereço base 0). */
export const MAX_MODBUS_OFFSET = 65535

/** Unit id válido em RTU (1–247; 0 é broadcast e nunca é lido). */
export const MIN_RTU_UNIT_ID = 1
export const MAX_RTU_UNIT_ID = 247

/** Intervalo de leitura mínimo (ms): TCP e RTU. */
export const MIN_POLL_MS_TCP = 100
export const MIN_POLL_MS_RTU = 200
export const MAX_POLL_MS = 3_600_000

/** Soma exata dos segundos por estado em cada minuto fechado. */
export const SECONDS_PER_MINUTE = 60

/** Máximo de peças num único minuto (sanidade). */
export const MAX_COUNT_PER_MINUTE = 1_000_000

/** Tolerância para timestamps no futuro em relação ao `server_time` (2 min). */
export const FUTURE_TOLERANCE_MS = 120_000

/** Varredura de registradores (modbus.scan): maior faixa por comando. */
export const MAX_SCAN_REGISTER_SPAN = 10_000

/** Prazo máximo de validade de um comando (24 h). */
export const MAX_COMMAND_TTL_MS = 24 * 60 * 60 * 1000

/** Valores padrão aplicados pelo agente quando o campo está ausente. */
export const DEFAULTS = {
  /** Intervalo do /sync (s). */
  syncIntervalS: 10,
  /** Itens por lote. */
  maxBatchItems: MAX_BATCH_ITEMS,
  /** Timeout por leitura Modbus TCP (ms). */
  tcpTimeoutMs: 500,
  /** Timeout por leitura Modbus RTU (ms). */
  rtuTimeoutMs: 300,
  /** Intervalo extra entre quadros no RS-485 (ms). */
  rtuTurnaroundMs: 5,
  /** Tempo sem leitura boa até `NO_COMM` (s). */
  commLossAfterS: 10,
  /** Debounce de estado (s). Curto por causa do RNF02 (estado na web em ≤ 5 s). */
  stateDebounceS: 1,
  /** Ciclos sem peça até "parada" no modo count_derived. */
  idleAfterCycles: 3,
  /** Timeout por unit id na varredura (ms). */
  scanTimeoutMs: 200,
  /** Inatividade máxima numa sessão de VPN (s). */
  vpnIdleTimeoutS: 900,
} as const

/**
 * Validade padrão (TTL) de cada tipo de comando, em segundos, a partir da emissão.
 * Um comando expirado não é executado (o agente responde `expired`).
 */
export const DEFAULT_COMMAND_TTL_S = {
  "tag.read": 120,
  "device.test": 120,
  "config.reload": 600,
  "agent.restart": 600,
  "modbus.scan": 600,
  "vpn.enable": 300,
  "vpn.disable": 3600,
  "vpn.status": 120,
  "ot.forward.open": 300,
  "ot.forward.close": 3600,
} as const

/** Prazo de execução de cada tipo de comando no agente, em segundos. */
export const COMMAND_EXEC_TIMEOUT_S = {
  "tag.read": 5,
  "device.test": 10,
  "config.reload": 60,
  "agent.restart": 10,
  "modbus.scan": 120,
  "vpn.enable": 60,
  "vpn.disable": 30,
  "vpn.status": 10,
  "ot.forward.open": 30,
  "ot.forward.close": 30,
} as const

/** Portas sugeridas para a política local de encaminhamento OT (Modbus, S7, EtherNet/IP). */
export const SUGGESTED_OT_FORWARD_PORTS = [502, 102, 44818] as const
