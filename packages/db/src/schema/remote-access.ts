/**
 * Acesso remoto aos gateways (VPN de manutenção sob demanda, docs/12): política do cliente,
 * sessões, encaminhamentos para CLP e eventos (só inserção, retenção de 5 anos).
 *
 * A chave de entrada na VPN NUNCA é persistida (vai só no comando) e a CA SSH fica em KMS.
 * `remote_access_recording` (gravações no Blob) fica para a Fase C.
 */
import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { createdAt, oneOf, pk, tstz, updatedAt } from "./_columns"
import { organizationId } from "./_tenant"
import { user } from "./auth"
import { unit } from "./assets"
import { device, gateway } from "./connectivity"
import {
  REMOTE_ACCESS_MODES,
  REMOTE_FORWARD_STATUSES,
  REMOTE_SESSION_LIVE_STATUSES,
  REMOTE_SESSION_STATUSES,
} from "./enums"

/** Janela pré-aprovada (ex.: sábado 8h–12h), no fuso da unidade. */
export interface RemoteAccessWindow {
  readonly daysOfWeek: readonly number[]
  readonly start: string
  readonly end: string
}

/**
 * Política de acesso remoto do cliente, de uma unidade ou de um gateway (vale a mais restritiva).
 * Unidade e gateway nulos = política do cliente inteiro.
 */
export const remoteAccessPolicy = pgTable(
  "remote_access_policy",
  {
    id: pk(),
    organizationId: organizationId(),
    unitId: uuid("unit_id"),
    gatewayId: uuid("gateway_id"),
    mode: text("mode", { enum: REMOTE_ACCESS_MODES }).notNull().default("approval"),
    /** Usuários que podem aprovar (vazio = admins do cliente). */
    approverUserIds: uuid("approver_user_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    maxDurationMin: integer("max_duration_min").notNull().default(240),
    idleTimeoutMin: integer("idle_timeout_min").notNull().default(15),
    allowOtForward: boolean("allow_ot_forward").notNull().default(false),
    requireSiteContact: boolean("require_site_contact").notNull().default(true),
    requirePhysicalKey: boolean("require_physical_key").notNull().default(false),
    windows: jsonb("windows").$type<RemoteAccessWindow[]>().notNull().default([]),
    updatedBy: uuid("updated_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("remote_access_policy_scope_uq").on(t.organizationId, t.unitId, t.gatewayId).nullsNotDistinct(),
    foreignKey({
      name: "remote_access_policy_unit_fk",
      columns: [t.unitId, t.organizationId],
      foreignColumns: [unit.id, unit.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "remote_access_policy_gateway_fk",
      columns: [t.gatewayId, t.organizationId],
      foreignColumns: [gateway.id, gateway.organizationId],
    }).onDelete("cascade"),
    check("remote_access_policy_mode_chk", oneOf(t.mode, REMOTE_ACCESS_MODES)),
    check(
      "remote_access_policy_limits_chk",
      sql`${t.maxDurationMin} BETWEEN 1 AND 480 AND ${t.idleTimeoutMin} BETWEEN 1 AND ${t.maxDurationMin}`,
    ),
  ],
)

/**
 * Sessão de acesso remoto: pedido, decisão, execução e encerramento.
 * No máximo uma sessão "viva" por gateway e técnico.
 */
export const remoteAccessSession = pgTable(
  "remote_access_session",
  {
    id: pk(),
    organizationId: organizationId(),
    gatewayId: uuid("gateway_id").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => user.id),
    reason: text("reason").notNull(),
    ticket: text("ticket"),
    requestedDurationMin: integer("requested_duration_min").notNull(),
    status: text("status", { enum: REMOTE_SESSION_STATUSES }).notNull().default("requested"),
    decidedBy: uuid("decided_by"),
    decidedAt: tstz("decided_at"),
    decisionNote: text("decision_note"),
    approvedDurationMin: integer("approved_duration_min"),
    startsAt: tstz("starts_at"),
    expiresAt: tstz("expires_at"),
    /** Execução: nó da VPN, IP e certificado SSH de curta duração. */
    vpnNodeId: text("vpn_node_id"),
    vpnIp: inet("vpn_ip"),
    sshCertSerial: text("ssh_cert_serial"),
    endedAt: tstz("ended_at"),
    endedBy: uuid("ended_by"),
    endReason: text("end_reason"),
    bytesIn: bigint("bytes_in", { mode: "number" }),
    bytesOut: bigint("bytes_out", { mode: "number" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("remote_access_session_id_org_uq").on(t.id, t.organizationId),
    unique("remote_access_session_id_gateway_org_uq").on(t.id, t.gatewayId, t.organizationId),
    foreignKey({
      name: "remote_access_session_gateway_fk",
      columns: [t.gatewayId, t.organizationId],
      foreignColumns: [gateway.id, gateway.organizationId],
    }),
    uniqueIndex("remote_access_session_live_uq")
      .on(t.gatewayId, t.requestedBy)
      .where(sql`${oneOf(t.status, REMOTE_SESSION_LIVE_STATUSES)}`),
    index("remote_access_session_org_created_idx").on(t.organizationId, t.createdAt),
    check("remote_access_session_status_chk", oneOf(t.status, REMOTE_SESSION_STATUSES)),
    check("remote_access_session_duration_chk", sql`${t.requestedDurationMin} BETWEEN 1 AND 480`),
    // Quem pede nunca aprova (docs/12, princípio 2).
    check("remote_access_session_self_approval_chk", sql`${t.decidedBy} IS NULL OR ${t.decidedBy} <> ${t.requestedBy}`),
  ],
)

/**
 * Encaminhamento para um CLP (um único IP:porta), com aprovação própria. O alvo precisa ser
 * um dispositivo cadastrado NO MESMO gateway da sessão (FKs compostas com o gateway).
 */
export const remoteAccessForward = pgTable(
  "remote_access_forward",
  {
    id: pk(),
    organizationId: organizationId(),
    sessionId: uuid("session_id").notNull(),
    gatewayId: uuid("gateway_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    targetHost: text("target_host").notNull(),
    targetPort: integer("target_port").notNull(),
    status: text("status", { enum: REMOTE_FORWARD_STATUSES }).notNull().default("requested"),
    siteContact: text("site_contact"),
    requestedBy: uuid("requested_by").notNull(),
    requestedDurationMin: integer("requested_duration_min").notNull(),
    decidedBy: uuid("decided_by"),
    decidedAt: tstz("decided_at"),
    opensAt: tstz("opens_at"),
    expiresAt: tstz("expires_at"),
    maxConnections: integer("max_connections").notNull().default(1),
    closedAt: tstz("closed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("remote_access_forward_id_org_uq").on(t.id, t.organizationId),
    foreignKey({
      name: "remote_access_forward_session_fk",
      columns: [t.sessionId, t.gatewayId, t.organizationId],
      foreignColumns: [remoteAccessSession.id, remoteAccessSession.gatewayId, remoteAccessSession.organizationId],
    }),
    foreignKey({
      name: "remote_access_forward_device_fk",
      columns: [t.deviceId, t.gatewayId, t.organizationId],
      foreignColumns: [device.id, device.gatewayId, device.organizationId],
    }),
    check("remote_access_forward_status_chk", oneOf(t.status, REMOTE_FORWARD_STATUSES)),
    check("remote_access_forward_port_chk", sql`${t.targetPort} BETWEEN 1 AND 65535`),
    check("remote_access_forward_duration_chk", sql`${t.requestedDurationMin} BETWEEN 1 AND 480`),
    check("remote_access_forward_connections_chk", sql`${t.maxConnections} BETWEEN 1 AND 16`),
    check("remote_access_forward_self_approval_chk", sql`${t.decidedBy} IS NULL OR ${t.decidedBy} <> ${t.requestedBy}`),
  ],
)

/** Eventos da sessão (pedido, aprovação, conexões, bytes, encerramento). Só inserção. */
export const remoteAccessEvent = pgTable(
  "remote_access_event",
  {
    id: pk(),
    organizationId: organizationId(),
    sessionId: uuid("session_id").notNull(),
    forwardId: uuid("forward_id"),
    type: text("type").notNull(),
    actorType: text("actor_type"),
    actorId: uuid("actor_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "remote_access_event_session_fk",
      columns: [t.sessionId, t.organizationId],
      foreignColumns: [remoteAccessSession.id, remoteAccessSession.organizationId],
    }),
    foreignKey({
      name: "remote_access_event_forward_fk",
      columns: [t.forwardId, t.organizationId],
      foreignColumns: [remoteAccessForward.id, remoteAccessForward.organizationId],
    }),
    index("remote_access_event_session_at_idx").on(t.sessionId, t.at),
  ],
)
