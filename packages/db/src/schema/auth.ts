/**
 * Tabelas do Better Auth (núcleo + plugins organization, admin e two-factor), declaradas de
 * forma MÍNIMA só para o resto do schema poder referenciá-las.
 *
 * ATENÇÃO: estas tabelas serão geradas/ajustadas pelo Better Auth (`@better-auth/cli generate`)
 * na épica W5 (docs/17). Ao fazer isso:
 * - manter os ids como `uuid` (o `organization_id` de todas as tabelas de cliente é uuid e a RLS
 *   compara com `current_setting('app.org_id')::uuid`). No Better Auth, configurar
 *   `advanced.database.generateId: false` (o banco gera `uuidv7()`) ou `"uuid"`;
 * - os nomes das propriedades (camelCase) são os que o adapter do Drizzle espera; as colunas
 *   no banco ficam em snake_case;
 * - a tabela `two_factor` (plugin two-factor) ainda não está declarada;
 * - `member` tem `organization_id` e por isso é tabela de cliente com RLS forçada (ver
 *   migrations/0001_rls.sql). O Better Auth acessa estas tabelas pelo papel `auth_service`.
 *
 * A autorização é nossa (docs/15, seção 5): `member.role` do Better Auth NÃO é usado para
 * autorizar; o papel e o escopo valem em `member_access`/`member_unit`.
 */
import { boolean, check, pgTable, text, unique, uuid } from "drizzle-orm/pg-core"
import { createdAt, matchesPattern, pk, tstz, updatedAt } from "./_columns"
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
