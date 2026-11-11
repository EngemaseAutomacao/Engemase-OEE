/**
 * Plataforma multi-cliente: conta do cliente, papéis e escopo, acesso da Engemase, terminais,
 * tokens próprios e auditoria (docs/15, seções 2, 3, 6 e 9).
 */
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  index,
  inet,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import { createdAt, isSha256Hex, oneOf, pk, tstz, updatedAt } from "./_columns"
import { organizationId } from "./_tenant"
import { member, organization, user } from "./auth"
import { unit } from "./assets"
import {
  ACCESS_SCOPES,
  ACCOUNT_TOKEN_PURPOSES,
  AUDIT_ACTOR_TYPES,
  CLIENT_ROLES,
  CLIENT_STATUSES,
  SUPPORT_GRANT_STATUSES,
  TERMINAL_KINDS,
} from "./enums"

/** Limites do plano (docs/15, P5). */
export interface ClientLimits {
  readonly units?: number
  readonly machines?: number
  readonly gateways?: number
  readonly users?: number
  readonly terminals?: number
  readonly [key: string]: number | undefined
}

/**
 * Conta do cliente (1:1 com `organization`): estado, plano, limites e modo de gestão.
 * Só a plataforma grava (docs/15, item 16): o papel `app_user` tem apenas SELECT.
 */
export const clientAccount = pgTable(
  "client_account",
  {
    id: pk(),
    organizationId: organizationId().unique("client_account_org_uq"),
    status: text("status", { enum: CLIENT_STATUSES }).notNull().default("onboarding"),
    plan: text("plan"),
    limits: jsonb("limits").$type<ClientLimits>().notNull().default({}),
    /** Ligado: gateways, conexões, tags e publicação de config ficam só leitura para o cliente. */
    managedByEngemase: boolean("managed_by_engemase").notNull().default(false),
    /** Slugs anteriores (slug nunca é reaproveitado). */
    slugHistory: text("slug_history")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    suspendedAt: tstz("suspended_at"),
    closedAt: tstz("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("client_account_status_chk", oneOf(t.status, CLIENT_STATUSES))],
)

/**
 * Papel e escopo do vínculo (`member`). Fail-closed (docs/15, seção 2): vínculo sem registro aqui
 * = vínculo inativo; escopo `units` sem nenhuma linha em `member_unit` = nenhum acesso.
 */
export const memberAccess = pgTable(
  "member_access",
  {
    id: pk(),
    organizationId: organizationId(),
    memberId: uuid("member_id").notNull(),
    role: text("role", { enum: CLIENT_ROLES }).notNull(),
    scope: text("scope", { enum: ACCESS_SCOPES }).notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("member_access_id_org_uq").on(t.id, t.organizationId),
    unique("member_access_member_uq").on(t.memberId),
    foreignKey({
      name: "member_access_member_fk",
      columns: [t.memberId, t.organizationId],
      foreignColumns: [member.id, member.organizationId],
    }).onDelete("cascade"),
    check("member_access_role_chk", oneOf(t.role, CLIENT_ROLES)),
    check("member_access_scope_chk", oneOf(t.scope, ACCESS_SCOPES)),
    // Admin do cliente tem sempre o cliente inteiro (MVP).
    check("member_access_admin_scope_chk", sql`${t.role} <> 'client_admin' OR ${t.scope} = 'all'`),
  ],
)

/** Unidades do vínculo quando o escopo é `units`. */
export const memberUnit = pgTable(
  "member_unit",
  {
    organizationId: organizationId(),
    memberAccessId: uuid("member_access_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "member_unit_pk", columns: [t.memberAccessId, t.unitId] }),
    foreignKey({
      name: "member_unit_member_access_fk",
      columns: [t.memberAccessId, t.organizationId],
      foreignColumns: [memberAccess.id, memberAccess.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "member_unit_unit_fk",
      columns: [t.unitId, t.organizationId],
      foreignColumns: [unit.id, unit.organizationId],
    }).onDelete("cascade"),
  ],
)

/**
 * Atribuição de engenheiro de campo da Engemase a um cliente, com validade (docs/15, seção 3).
 * Sem linhas em `platform_assignment_unit` = cliente inteiro.
 */
export const platformAssignment = pgTable(
  "platform_assignment",
  {
    id: pk(),
    organizationId: organizationId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    reason: text("reason").notNull(),
    validFrom: tstz("valid_from").notNull().defaultNow(),
    validUntil: tstz("valid_until").notNull(),
    createdBy: uuid("created_by").notNull(),
    revokedAt: tstz("revoked_at"),
    revokedBy: uuid("revoked_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("platform_assignment_id_org_uq").on(t.id, t.organizationId),
    index("platform_assignment_user_idx").on(t.userId, t.validUntil),
    check("platform_assignment_validity_chk", sql`${t.validUntil} > ${t.validFrom}`),
  ],
)

export const platformAssignmentUnit = pgTable(
  "platform_assignment_unit",
  {
    organizationId: organizationId(),
    assignmentId: uuid("assignment_id").notNull(),
    unitId: uuid("unit_id").notNull(),
  },
  (t) => [
    primaryKey({ name: "platform_assignment_unit_pk", columns: [t.assignmentId, t.unitId] }),
    foreignKey({
      name: "platform_assignment_unit_assignment_fk",
      columns: [t.assignmentId, t.organizationId],
      foreignColumns: [platformAssignment.id, platformAssignment.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "platform_assignment_unit_unit_fk",
      columns: [t.unitId, t.organizationId],
      foreignColumns: [unit.id, unit.organizationId],
    }).onDelete("cascade"),
  ],
)

/**
 * Concessão de suporte: usuário de plataforma × cliente, com motivo, chamado e prazo de até 4 h
 * (docs/15, seção 3). Visível ao cliente na auditoria.
 */
export const supportAccessGrant = pgTable(
  "support_access_grant",
  {
    id: pk(),
    organizationId: organizationId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    reason: text("reason").notNull(),
    ticket: text("ticket"),
    status: text("status", { enum: SUPPORT_GRANT_STATUSES }).notNull(),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    /** Preenchido quando a política do cliente exige aprovação. */
    approvedBy: uuid("approved_by"),
    approvedAt: tstz("approved_at"),
    endedAt: tstz("ended_at"),
    endedBy: uuid("ended_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("support_access_grant_user_idx").on(t.userId, t.endsAt),
    index("support_access_grant_org_idx").on(t.organizationId, t.endsAt),
    check("support_access_grant_status_chk", oneOf(t.status, SUPPORT_GRANT_STATUSES)),
    check(
      "support_access_grant_window_chk",
      sql`${t.endsAt} > ${t.startsAt} AND ${t.endsAt} <= ${t.startsAt} + interval '4 hours'`,
    ),
  ],
)

/**
 * Terminal pareado (TV Andon ou tablet): dispositivo, não pessoa (docs/15, seção 1).
 * Escopo em listas de ids (validadas na camada de dados; leituras já são isoladas por RLS).
 */
export const terminal = pgTable(
  "terminal",
  {
    id: pk(),
    organizationId: organizationId(),
    unitId: uuid("unit_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: TERMINAL_KINDS }).notNull(),
    lineIds: uuid("line_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    machineIds: uuid("machine_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** SHA-256 (hex) do token de dispositivo; nulo até o pareamento. */
    tokenHash: text("token_hash").unique("terminal_token_hash_uq"),
    pairedBy: uuid("paired_by"),
    pairedAt: tstz("paired_at"),
    /** Prazo absoluto do token (docs/15, item 11). */
    expiresAt: tstz("expires_at"),
    revokedAt: tstz("revoked_at"),
    revokedBy: uuid("revoked_by"),
    lastSeenAt: tstz("last_seen_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("terminal_id_org_uq").on(t.id, t.organizationId),
    foreignKey({
      name: "terminal_unit_fk",
      columns: [t.unitId, t.organizationId],
      foreignColumns: [unit.id, unit.organizationId],
    }),
    check("terminal_kind_chk", oneOf(t.kind, TERMINAL_KINDS)),
    check("terminal_token_hash_chk", sql`${t.tokenHash} IS NULL OR ${isSha256Hex(t.tokenHash)}`),
    check(
      "terminal_paired_chk",
      sql`${t.tokenHash} IS NULL OR (${t.pairedAt} IS NOT NULL AND ${t.expiresAt} IS NOT NULL)`,
    ),
  ],
)

/**
 * Tokens próprios de uso único (definir senha, verificar e-mail, pareamento de terminal),
 * guardados só como hash (docs/15, seção 5).
 */
export const accountToken = pgTable(
  "account_token",
  {
    id: pk(),
    organizationId: organizationId(),
    purpose: text("purpose", { enum: ACCOUNT_TOKEN_PURPOSES }).notNull(),
    tokenHash: text("token_hash").notNull().unique("account_token_token_hash_uq"),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    terminalId: uuid("terminal_id"),
    expiresAt: tstz("expires_at").notNull(),
    usedAt: tstz("used_at"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "account_token_terminal_fk",
      columns: [t.terminalId, t.organizationId],
      foreignColumns: [terminal.id, terminal.organizationId],
    }).onDelete("cascade"),
    check("account_token_purpose_chk", oneOf(t.purpose, ACCOUNT_TOKEN_PURPOSES)),
    check("account_token_hash_chk", isSha256Hex(t.tokenHash)),
    check(
      "account_token_target_chk",
      sql`(${t.purpose} = 'terminal_pairing' AND ${t.terminalId} IS NOT NULL)
        OR (${t.purpose} <> 'terminal_pairing' AND ${t.userId} IS NOT NULL)`,
    ),
    check("account_token_expiry_chk", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
)

/**
 * Auditoria única (docs/15, seção 9). `organization_id` nulo SÓ aqui, para eventos de plataforma
 * (invisíveis ao papel `app_user`). Só inserção: `app_user` não tem UPDATE nem DELETE.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: pk(),
    organizationId: uuid("organization_id").references(() => organization.id),
    actorType: text("actor_type", { enum: AUDIT_ACTOR_TYPES }).notNull(),
    actorId: uuid("actor_id"),
    /** Nome do ator no momento do evento (ex.: "Carlos Mendes (suporte Engemase)"). */
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    /** Unidade afetada (filtro de escopo da auditoria, docs/15 item 14). */
    unitId: uuid("unit_id"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    /** Concessão de suporte ou atribuição usada pela Engemase, quando houver. */
    accessGrantId: uuid("access_grant_id"),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_org_at_idx").on(t.organizationId, t.at),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    check("audit_log_actor_type_chk", oneOf(t.actorType, AUDIT_ACTOR_TYPES)),
  ],
)
