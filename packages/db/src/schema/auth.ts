/**
 * Tabelas do Better Auth (núcleo + plugins organization, admin e two-factor), declaradas de
 * forma MÍNIMA só para o resto do schema poder referenciá-las.
 *
 * W5 (docs/17): o Better Auth (apps/web/lib/server/auth) usa estas tabelas pelo adapter do Drizzle,
 * com `advanced.database.generateId: "uuid"` (ids `uuid`, como o `organization_id` das tabelas de
 * cliente) e `database.validateSchema` ligado: se faltar campo que o Better Auth espera, ele falha
 * na primeira chamada (e o teste de apps/web/test/auth pega).
 * - os nomes das propriedades (camelCase) são os que o adapter do Drizzle espera; as colunas
 *   no banco ficam em snake_case;
 * - plugins em uso: two-factor (`two_factor`, `user.two_factor_enabled`). O plugin admin NÃO é
 *   usado (endpoints a menos); `user.role`/`banned` são lidos pela nossa camada de acesso;
 * - `member` tem `organization_id` e por isso é tabela de cliente com RLS forçada (ver
 *   migrations/0001_rls.sql). O Better Auth acessa estas tabelas pelo papel `auth_service`.
 *
 * A autorização é nossa (docs/15, seção 5): `member.role` do Better Auth NÃO é usado para
 * autorizar; o papel e o escopo valem em `member_access`/`member_unit`.
 */
import { boolean, check, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { createdAt, isSha256Hex, matchesPattern, pk, tstz, updatedAt } from "./_columns"
import { ORG_SLUG_PATTERN } from "./enums"

export const user = pgTable("user", {
  id: pk(),
  name: text("name").notNull(),
  email: text("email").notNull().unique("user_email_uq"),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  // Plugin admin: papel de plataforma (super_admin, support, field_engineer) e banimento.
  role: text("role"),
  banned: boolean("banned").notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: tstz("ban_expires"),
  // Plugin two-factor.
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
})

export const session = pgTable("session", {
  id: pk(),
  expiresAt: tstz("expires_at").notNull(),
  token: text("token").notNull().unique("session_token_uq"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // Plugin organization: só lembra o último cliente; NÃO autoriza nada (docs/15, seção 4).
  activeOrganizationId: uuid("active_organization_id"),
  // Plugin admin (impersonação só na F2, somente leitura).
  impersonatedBy: uuid("impersonated_by"),
  /**
   * "Manter conectado neste dispositivo" (L20): sessão vale até 30 dias. Sem ela (e sempre para a
   * equipe Engemase), a sessão cai depois de 12 h sem uso. Gravado no login (hook do Better Auth).
   */
  rememberMe: boolean("remember_me").notNull().default(false),
  /** Último uso da sessão (atualizado no máximo a cada 5 min pela camada de acesso), para a regra das 12 h. */
  lastActiveAt: tstz("last_active_at"),
})

export const account = pgTable("account", {
  id: pk(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: tstz("access_token_expires_at"),
  refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const verification = pgTable("verification", {
  id: pk(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: tstz("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** Cliente (tenant). O id desta tabela é o `organization_id` de todas as tabelas de cliente. */
export const organization = pgTable(
  "organization",
  {
    id: pk(),
    name: text("name").notNull(),
    /**
     * Identificador da URL; nunca reaproveitado (histórico em `client_account.slug_history`).
     * Formato do contrato (`ORG_SLUG_PATTERN`): o /enroll devolve o slug ao gateway como `org`.
     */
    slug: text("slug").notNull().unique("organization_slug_uq"),
    logo: text("logo"),
    metadata: text("metadata"),
    createdAt: createdAt(),
  },
  (t) => [check("organization_slug_chk", matchesPattern(t.slug, ORG_SLUG_PATTERN))],
)

export const member = pgTable(
  "member",
  {
    id: pk(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Papel do Better Auth (não usado para autorizar; ver `member_access`). */
    role: text("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("member_id_org_uq").on(t.id, t.organizationId),
    unique("member_org_user_uq").on(t.organizationId, t.userId),
  ],
)

/**
 * Plugin two-factor do Better Auth (D14, L20): segredo TOTP e os 10 códigos de recuperação, ambos
 * cifrados pelo Better Auth com `BETTER_AUTH_SECRET`. `failed_verification_count`/`locked_until` são
 * o bloqueio por conta do próprio plugin (5 erros = 15 min, `accountLockout`).
 */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: pk(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: tstz("locked_until"),
    createdAt: createdAt(),
  },
  (t) => [index("two_factor_user_idx").on(t.userId), index("two_factor_secret_idx").on(t.secret)],
)

/**
 * Bloqueio de login por conta (L20): depois de 5 senhas erradas em 15 min, espera de 15 min. A chave
 * é o SHA-256 do e-mail normalizado (não guarda o e-mail; e-mail inexistente é tratado igual, para não
 * revelar quem tem conta). Só o papel `auth_service` lê e grava (migração 0008).
 */
export const authLoginThrottle = pgTable(
  "auth_login_throttle",
  {
    key: text("key").primaryKey(),
    failures: integer("failures").notNull().default(0),
    windowStartedAt: tstz("window_started_at").notNull().defaultNow(),
    lockedUntil: tstz("locked_until"),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("auth_login_throttle_key_chk", isSha256Hex(t.key)),
    check("auth_login_throttle_failures_chk", sql`${t.failures} >= 0`),
  ],
)
