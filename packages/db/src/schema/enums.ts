/**
 * Valores aceitos nas colunas de "enum" (texto + CHECK no banco).
 *
 * Os valores que também existem no contrato gateway ↔ nuvem (`@engemase/contracts`) são
 * repetidos aqui de propósito: o banco não muda sozinho quando o contrato muda.
 * O teste `test/enums.test.ts` falha se houver divergência, e aí é preciso gerar
 * uma nova migração (`pnpm db:generate`) para atualizar os CHECKs.
 */

// --- Contrato gateway ↔ nuvem (espelhados de @engemase/contracts) -------------------------

/** Estados de máquina (docs/07). `NO_COMM` é gerado só pelo gateway. */
export const MACHINE_STATES = ["RUNNING", "STOPPED", "FAULT", "SETUP", "NO_COMM"] as const
export type MachineState = (typeof MACHINE_STATES)[number]

/** Papéis das tags (docs/03). */
export const TAG_ROLES = [
  "state.running",
  "state.fault",
  "state.code",
  "fault.code",
  "count.total",
  "count.good",
  "count.reject",
  "product.code",
  "speed.actual",
  "plc.heartbeat",
  "custom",
] as const
export type TagRole = (typeof TAG_ROLES)[number]

export const DATA_TYPES = ["bool", "int16", "uint16", "int32", "uint32", "float32"] as const
export type DataType = (typeof DATA_TYPES)[number]

export const WORD_ORDERS = ["ABCD", "CDAB", "BADC", "DCBA"] as const
export type WordOrder = (typeof WORD_ORDERS)[number]

export const PROTOCOLS = ["modbus-tcp", "modbus-rtu", "modbus-rtu-over-tcp"] as const
export type Protocol = (typeof PROTOCOLS)[number]

export const PARITIES = ["N", "E", "O"] as const
export type Parity = (typeof PARITIES)[number]

export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const

/** Modos de determinação do estado (docs/03). */
export const STATE_MODES = ["signals", "state_code", "count_derived"] as const
export type StateMode = (typeof STATE_MODES)[number]

export const DEVICE_CONN_STATUSES = ["connected", "degraded", "disconnected", "disabled"] as const
export type DeviceConnStatus = (typeof DEVICE_CONN_STATUSES)[number]

/**
 * Faixa do código de falha do CLP no contrato (`fault_code` em eventos de estado e no live):
 * uint32, de 0 a 4294967295. Não cabe em `integer` (int4): as colunas são `bigint` com CHECK.
 */
export const FAULT_CODE_MIN = 0
export const FAULT_CODE_MAX = 4_294_967_295

/**
 * Formato do slug do cliente (`organization.slug`): o do campo `org` da resposta do /enroll
 * (`EnrollResponseSchema.shape.org`), de 1 a 64 caracteres, minúsculas, dígitos e hífen, sem hífen
 * nas pontas. Vale igual em JavaScript e no Postgres (`~`, expressão regular ARE).
 */
export const ORG_SLUG_PATTERN = "^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$"

// --- Plataforma e acesso (docs/15) ----------------------------------------------------------

/** Ciclo de vida do cliente (docs/15, seção 6). */
export const CLIENT_STATUSES = ["onboarding", "active", "suspended", "closed"] as const
export type ClientStatus = (typeof CLIENT_STATUSES)[number]

/** Papéis do cliente (docs/15, seção 2). */
export const CLIENT_ROLES = ["client_admin", "engineer", "supervisor", "operator", "viewer"] as const
export type ClientRole = (typeof CLIENT_ROLES)[number]

/** Papéis da equipe Engemase, em `user.role` (plugin admin do Better Auth). */
export const PLATFORM_ROLES = ["super_admin", "support", "field_engineer"] as const
export type PlatformRole = (typeof PLATFORM_ROLES)[number]

/** Escopo do vínculo: cliente inteiro ou lista de unidades ("fail-closed"). */
export const ACCESS_SCOPES = ["all", "units"] as const
export type AccessScope = (typeof ACCESS_SCOPES)[number]

export const SUPPORT_GRANT_STATUSES = ["requested", "active", "denied", "ended", "expired"] as const
export type SupportGrantStatus = (typeof SUPPORT_GRANT_STATUSES)[number]

export const TERMINAL_KINDS = ["tv", "tablet"] as const
export type TerminalKind = (typeof TERMINAL_KINDS)[number]

export const ACCOUNT_TOKEN_PURPOSES = ["set_password", "verify_email", "terminal_pairing"] as const
export type AccountTokenPurpose = (typeof ACCOUNT_TOKEN_PURPOSES)[number]

/** Tipo de ator na auditoria (docs/15, seção 9). */
export const AUDIT_ACTOR_TYPES = ["user", "engemase", "terminal", "gateway", "system"] as const
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number]

// --- Conectividade (docs/03, docs/04) -------------------------------------------------------

/** Ciclo de vida do gateway. "Online/offline" sai de `last_seen_at`, não daqui. */
export const GATEWAY_STATUSES = ["pending_enrollment", "active", "revoked"] as const
export type GatewayStatus = (typeof GATEWAY_STATUSES)[number]

/** Estado de um comando na fila (docs/04). */
export const COMMAND_STATUSES = ["pending", "sent", "ok", "error", "expired", "rejected", "cancelled"] as const
export type CommandStatus = (typeof COMMAND_STATUSES)[number]

// --- Produção (docs/07) ---------------------------------------------------------------------

/** Categoria do motivo de parada. */
export const REASON_CATEGORIES = ["unplanned", "planned", "setup"] as const
export type ReasonCategory = (typeof REASON_CATEGORIES)[number]

/** Origem de um evento de estado. */
export const STATE_EVENT_SOURCES = ["edge", "manual", "system"] as const
export type StateEventSource = (typeof STATE_EVENT_SOURCES)[number]

/** Origem de uma troca de produto/ordem. */
export const PRODUCTION_RUN_SOURCES = ["plc", "operator", "system"] as const
export type ProductionRunSource = (typeof PRODUCTION_RUN_SOURCES)[number]

// --- Alertas e notificações (docs/13) -------------------------------------------------------

export const ALERT_TYPES = [
  "machine_stopped",
  "machine_fault",
  "gateway_offline",
  "no_data",
  "oee_below_target",
  "unclassified_stops",
  "remote_access",
  "engemase_ops",
] as const
export type AlertType = (typeof ALERT_TYPES)[number]

export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]

/** Ciclo de vida de um alerta (docs/13). */
export const ALERT_STATES = ["open", "notified", "acknowledged", "resolved", "auto_resolved"] as const
export type AlertState = (typeof ALERT_STATES)[number]

export const NOTIFICATION_CHANNELS = ["push", "email", "whatsapp", "telegram", "sms"] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const DELIVERY_STATUSES = ["pending", "sent", "failed", "dead"] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

// --- Acesso remoto (docs/12) ----------------------------------------------------------------

export const REMOTE_ACCESS_MODES = ["disabled", "approval", "preapproved_window", "emergency"] as const
export type RemoteAccessMode = (typeof REMOTE_ACCESS_MODES)[number]

/** Estados da sessão de acesso remoto (docs/12, "Fluxo de uma sessão"). */
export const REMOTE_SESSION_STATUSES = [
  "requested",
  "approved",
  "activating",
  "active",
  "stopping",
  "ended",
  "denied",
  "cancelled",
  "expired_unapproved",
  "failed",
  "revoked",
] as const
export type RemoteSessionStatus = (typeof REMOTE_SESSION_STATUSES)[number]

/** Estados "vivos" (no máximo uma sessão viva por gateway e técnico). */
export const REMOTE_SESSION_LIVE_STATUSES = ["requested", "approved", "activating", "active", "stopping"] as const

export const REMOTE_FORWARD_STATUSES = [
  "requested",
  "approved",
  "open",
  "closed",
  "denied",
  "expired",
  "failed",
] as const
export type RemoteForwardStatus = (typeof REMOTE_FORWARD_STATUSES)[number]
