/**
 * Plataforma multi-cliente: conta do cliente, papéis e escopo, acesso da Engemase, terminais,
 * tokens próprios e auditoria (docs/15, seções 2, 3, 6 e 9).
 *
 * Quem grava o quê (D12 e D13, 12/11/2026): o admin do cliente gerencia só os usuários do próprio
 * cliente (`member`, `member_access`, `member_unit`, `member_machine`). Toda a outra configuração
 * (unidades, linhas, máquinas, gateways, tags, terminais, turnos, produtos, motivos, políticas) é
 * da equipe Engemase. O banco isola por cliente; quem pode o quê dentro do cliente é regra da
 * camada de acesso a dados.
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
import { machine, unit } from "./assets"
import {
  ACCESS_SCOPES,
  ACCOUNT_TOKEN_PURPOSES,
  AUDIT_ACTOR_TYPES,
  CLIENT_ROLES,
  CLIENT_STATUSES,
  SUPPORT_GRANT_STATUSES,
  TERMINAL_KINDS,
} from "./enums"

/**
 * Limites do contrato (docs/15, P5), gravados só pela plataforma. A Engemase vende o software como
 * assinatura COBRADA POR MÁQUINA, com planos (D1, 12/11/2026): `machines` é a base da cobrança.
 * Preços e regras de cada plano ficam fora do banco (ainda não definidos); não há tabela de
 * faturamento. Todo valor é um inteiro >= 0 (`client_account_limits_chk`).
 *
 * `machines` é OBRIGATÓRIO (o banco recusa `limits` sem ele, inclusive a organização interna
 * "Engemase Lab"): todo cliente nasce com as máquinas contratadas, e `0` = nenhuma máquina pode ser
 * cadastrada. As outras chaves são opcionais: chave ausente = sem limite para aquele item.
 */
export interface ClientLimits {
  readonly units?: number
  /** Número de máquinas contratadas (cobrança por máquina, D1). Obrigatório. */
  readonly machines: number
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
    /** Plano da assinatura (o protótipo usa starter, pro e enterprise). Nomes e preços ainda abertos (D1). */
    plan: text("plan"),
    /** Sem padrão: quem cria o cliente informa as máquinas contratadas (`ClientLimits`). */
    limits: jsonb("limits").$type<ClientLimits>().notNull(),
    /**
     * Ligado: gateways, conexões, tags e publicação de config são só da equipe Engemase; para o
     * cliente, leitura técnica (D13). No MVP TODO cliente é gerenciado pela Engemase: padrão `true`
     * (a 0005 ligou as linhas que já existiam). A coluna fica para o caso de um dia existir cliente
     * com autogestão técnica.
     */
    managedByEngemase: boolean("managed_by_engemase").notNull().default(true),
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
  (t) => [
    check("client_account_status_chk", oneOf(t.status, CLIENT_STATUSES)),
    // `limits` é um objeto, tem a chave `machines` (D1) e todo valor é inteiro >= 0 (`strict`: um
    // valor em lista não passa). O `true` do fim (silent) troca erro por NULL, e aí o
    // `jsonb_typeof` decide.
    check(
      "client_account_limits_chk",
      sql`jsonb_typeof(${t.limits}) = 'object' AND ${t.limits} ? 'machines' AND NOT jsonb_path_exists(${t.limits}, 'strict $.* ? (@.type() != "number" || @ < 0 || @ != @.floor())', '{}', true)`,
    ),
  ],
)

/**
 * Papel e escopo do vínculo (`member`). Fail-closed (docs/15, seção 2): vínculo sem registro aqui
 * = vínculo inativo; escopo `units` sem nenhuma linha em `member_unit` = nenhum acesso; escopo
 * `machines` sem nenhuma linha em `member_machine` = nenhum acesso. Gravado pelo admin do cliente
 * (D12). O papel `engineer` é leitura técnica (D13): vê saúde de gateways, conexões e tags, sem editar.
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

/** Unidades do vínculo quando o escopo é `units` (nenhuma unidade listada = nenhum acesso). */
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
 * Máquinas do vínculo quando o escopo é `machines` (D11, 12/11/2026). Mesmo padrão de `member_unit`.
 *
 * Regra fail-closed: escopo `machines` sem nenhuma linha aqui = nenhum acesso. As linhas só valem
 * com `member_access.scope = 'machines'` (com outro escopo, a camada de acesso a dados as ignora).
 * Agregados (OEE de linha e de unidade, relatórios, exportações) somam só as máquinas listadas.
 * Máquina nova não entra sozinha neste escopo: o admin do cliente precisa incluí-la.
 */
export const memberMachine = pgTable(
  "member_machine",
  {
    organizationId: organizationId(),
    memberAccessId: uuid("member_access_id").notNull(),
    machineId: uuid("machine_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "member_machine_pk", columns: [t.memberAccessId, t.machineId] }),
    foreignKey({
      name: "member_machine_member_access_fk",
      columns: [t.memberAccessId, t.organizationId],
      foreignColumns: [memberAccess.id, memberAccess.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "member_machine_machine_fk",
      columns: [t.machineId, t.organizationId],
      foreignColumns: [machine.id, machine.organizationId],
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
 * (docs/15, seção 3). Aberta pela própria Engemase e ativa na hora, SEM aprovação do cliente: o
 * acesso da Engemase é sempre liberado com registro (D5, 12/11/2026). Visível ao cliente na
 * auditoria e com faixa na tela. (A aprovação de sessões de acesso remoto ao gateway é outra
 * coisa e continua em `remote_access_*`, docs/12.)
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
    status: text("status", { enum: SUPPORT_GRANT_STATUSES }).notNull().default("active"),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
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
