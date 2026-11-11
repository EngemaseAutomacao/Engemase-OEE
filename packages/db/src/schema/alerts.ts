/**
 * Alertas e notificações (docs/13): regras, alertas (com deduplicação), central de notificações,
 * entregas por canal, inscrições de Web Push e preferências.
 */
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { createdAt, deletedAt, oneOf, pk, tstz, updatedAt } from "./_columns"
import { organizationId } from "./_tenant"
import { user } from "./auth"
import { line, machine, unit } from "./assets"
import { gateway } from "./connectivity"
import { terminal } from "./access"
import { ALERT_SEVERITIES, ALERT_STATES, ALERT_TYPES, DELIVERY_STATUSES, NOTIFICATION_CHANNELS } from "./enums"

/** Destinatários de uma regra: papéis do cliente e/ou usuários. */
export interface AlertRecipients {
  readonly roles?: readonly string[]
  readonly userIds?: readonly string[]
  readonly includeEngemaseSupport?: boolean
}

/** Escalonamento: depois de N minutos sem reconhecimento, próximo nível/canal. */
export interface AlertEscalationStep {
  readonly afterMin: number
  readonly roles?: readonly string[]
  readonly userIds?: readonly string[]
  readonly channels?: readonly string[]
}

/** Regra de alerta, com escopo opcional (unidade, linha ou máquina). */
export const alertRule = pgTable(
  "alert_rule",
  {
    id: pk(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    type: text("type", { enum: ALERT_TYPES }).notNull(),
    unitId: uuid("unit_id"),
    lineId: uuid("line_id"),
    machineId: uuid("machine_id"),
    /** Limites e duração mínima (ex.: { "minDurationMin": 10 }). */
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    severity: text("severity", { enum: ALERT_SEVERITIES }).notNull(),
    recipients: jsonb("recipients").$type<AlertRecipients>().notNull().default({}),
    escalation: jsonb("escalation").$type<AlertEscalationStep[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("alert_rule_id_org_uq").on(t.id, t.organizationId),
    foreignKey({
      name: "alert_rule_unit_fk",
      columns: [t.unitId, t.organizationId],
      foreignColumns: [unit.id, unit.organizationId],
    }),
    foreignKey({
      name: "alert_rule_line_fk",
      columns: [t.lineId, t.organizationId],
      foreignColumns: [line.id, line.organizationId],
    }),
    foreignKey({
      name: "alert_rule_machine_fk",
      columns: [t.machineId, t.organizationId],
      foreignColumns: [machine.id, machine.organizationId],
    }),
    check("alert_rule_type_chk", oneOf(t.type, ALERT_TYPES)),
    check("alert_rule_severity_chk", oneOf(t.severity, ALERT_SEVERITIES)),
  ],
)

/**
 * Alerta (ocorrência). Deduplicação: um alerta aberto por (regra, alvo) — `dedup_key` é o alvo
 * (ex.: id da máquina ou do gateway, ou "linha:<id>" no agrupamento).
 */
export const alertEvent = pgTable(
  "alert_event",
  {
    id: pk(),
    organizationId: organizationId(),
    ruleId: uuid("rule_id").notNull(),
    machineId: uuid("machine_id"),
    gatewayId: uuid("gateway_id"),
    dedupKey: text("dedup_key").notNull(),
    state: text("state", { enum: ALERT_STATES }).notNull().default("open"),
    severity: text("severity", { enum: ALERT_SEVERITIES }).notNull(),
    openedAt: tstz("opened_at").notNull().defaultNow(),
    lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
    acknowledgedAt: tstz("acknowledged_at"),
    acknowledgedBy: uuid("acknowledged_by"),
    resolvedAt: tstz("resolved_at"),
    resolvedBy: uuid("resolved_by"),
    escalationLevel: integer("escalation_level").notNull().default(0),
    /** Dados do momento (estado, código de falha, OEE do turno...). */
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    unique("alert_event_id_org_uq").on(t.id, t.organizationId),
    foreignKey({
      name: "alert_event_rule_fk",
      columns: [t.ruleId, t.organizationId],
      foreignColumns: [alertRule.id, alertRule.organizationId],
    }),
    foreignKey({
      name: "alert_event_machine_fk",
      columns: [t.machineId, t.organizationId],
      foreignColumns: [machine.id, machine.organizationId],
    }),
    foreignKey({
      name: "alert_event_gateway_fk",
      columns: [t.gatewayId, t.organizationId],
      foreignColumns: [gateway.id, gateway.organizationId],
    }),
    uniqueIndex("alert_event_open_dedup_uq")
      .on(t.ruleId, t.dedupKey)
      .where(sql`${t.resolvedAt} IS NULL`),
    index("alert_event_org_opened_idx").on(t.organizationId, t.openedAt),
    check("alert_event_state_chk", oneOf(t.state, ALERT_STATES)),
    check("alert_event_severity_chk", oneOf(t.severity, ALERT_SEVERITIES)),
    check(
      "alert_event_resolved_chk",
      sql`(${t.state} IN ('resolved', 'auto_resolved')) = (${t.resolvedAt} IS NOT NULL)`,
    ),
  ],
)

/** Item da central de notificações (o sino é a fonte da verdade, docs/13). */
export const notification = pgTable(
  "notification",
  {
    id: pk(),
    organizationId: organizationId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    alertEventId: uuid("alert_event_id"),
    /** Tipo do evento (ex.: alert, remote_access.requested, support_access.started). */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: tstz("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("notification_id_org_uq").on(t.id, t.organizationId),
    foreignKey({
      name: "notification_alert_event_fk",
      columns: [t.alertEventId, t.organizationId],
      foreignColumns: [alertEvent.id, alertEvent.organizationId],
    }),
    index("notification_user_unread_idx")
      .on(t.userId, t.createdAt)
      .where(sql`${t.readAt} IS NULL`),
    check("notification_link_chk", sql`${t.link} IS NULL OR ${t.link} LIKE '/%'`),
  ],
)

/**
 * Inscrição de Web Push: do usuário ou de um dispositivo de quiosque (terminal).
 * Por cliente: a mesma URL de push pode existir em mais de um cliente para quem tem vários vínculos.
 */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: pk(),
    organizationId: organizationId(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    terminalId: uuid("terminal_id"),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    deviceName: text("device_name"),
    createdAt: createdAt(),
    lastSeenAt: tstz("last_seen_at"),
    lastSuccessAt: tstz("last_success_at"),
  },
  (t) => [
    unique("push_subscription_id_org_uq").on(t.id, t.organizationId),
    unique("push_subscription_org_endpoint_uq").on(t.organizationId, t.endpoint),
    foreignKey({
      name: "push_subscription_terminal_fk",
      columns: [t.terminalId, t.organizationId],
      foreignColumns: [terminal.id, terminal.organizationId],
    }).onDelete("cascade"),
    check("push_subscription_owner_chk", sql`(${t.userId} IS NULL) <> (${t.terminalId} IS NULL)`),
    check("push_subscription_endpoint_chk", sql`${t.endpoint} LIKE 'https://%'`),
  ],
)

/** Entrega de uma notificação por canal, com tentativas e erro (docs/13, "Pipeline"). */
export const notificationDelivery = pgTable(
  "notification_delivery",
  {
    id: pk(),
    organizationId: organizationId(),
    notificationId: uuid("notification_id").notNull(),
    channel: text("channel", { enum: NOTIFICATION_CHANNELS }).notNull(),
    pushSubscriptionId: uuid("push_subscription_id"),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: tstz("next_attempt_at"),
    sentAt: tstz("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "notification_delivery_notification_fk",
      columns: [t.notificationId, t.organizationId],
      foreignColumns: [notification.id, notification.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "notification_delivery_push_subscription_fk",
      columns: [t.pushSubscriptionId, t.organizationId],
      foreignColumns: [pushSubscription.id, pushSubscription.organizationId],
    }).onDelete("cascade"),
    index("notification_delivery_pending_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    check("notification_delivery_channel_chk", oneOf(t.channel, NOTIFICATION_CHANNELS)),
    check("notification_delivery_status_chk", oneOf(t.status, DELIVERY_STATUSES)),
    check("notification_delivery_push_chk", sql`${t.channel} <> 'push' OR ${t.pushSubscriptionId} IS NOT NULL`),
  ],
)

/** Horário de silêncio, no fuso indicado. */
export interface QuietHours {
  readonly start: string
  readonly end: string
  readonly timezone: string
  readonly allowCritical?: boolean
}

/** Escopo das preferências (sempre dentro do escopo de acesso do usuário). */
export interface NotificationScope {
  readonly unitIds?: readonly string[]
  readonly lineIds?: readonly string[]
  readonly machineIds?: readonly string[]
}

/** Preferências de notificação do usuário dentro de um cliente. */
export const notificationPreference = pgTable(
  "notification_preference",
  {
    id: pk(),
    organizationId: organizationId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Tipos de alerta desejados; vazio = padrão do papel. */
    alertTypes: text("alert_types")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    scope: jsonb("scope").$type<NotificationScope>().notNull().default({}),
    channels: text("channels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    quietHours: jsonb("quiet_hours").$type<QuietHours>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("notification_preference_org_user_uq").on(t.organizationId, t.userId),
    check(
      "notification_preference_channels_chk",
      sql`${t.channels} <@ ARRAY[${sql.raw(NOTIFICATION_CHANNELS.map((c) => `'${c}'`).join(", "))}]::text[]`,
    ),
    check(
      "notification_preference_alert_types_chk",
      sql`${t.alertTypes} <@ ARRAY[${sql.raw(ALERT_TYPES.map((c) => `'${c}'`).join(", "))}]::text[]`,
    ),
  ],
)
