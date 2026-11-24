/**
 * `TenantContext` e a decisão de acesso (docs/15, seção 4, item 2): dado QUEM é a pessoa (sessão) e
 * o que o banco diz sobre ela NAQUELE cliente (vínculo, papel, escopo, estado do cliente, concessão
 * ou atribuição da Engemase), decide se entra, com que papel, escopo e permissões.
 *
 * Função pura (sem banco, sem Next.js): `load.ts` lê os dados sob RLS e chama `decideAccess`.
 *
 * Tudo "fail-closed":
 * - vínculo sem `member_access`, inativo, com papel/escopo desconhecido → sem acesso;
 * - escopo `units`/`machines` sem nenhuma unidade/máquina listada → sem acesso (D11);
 * - suporte sem concessão ativa, engenheiro de campo sem atribuição válida → sem acesso;
 * - papel que exige 2FA (D14) sem 2FA ligado → bloqueado até cadastrar.
 * Sem acesso, quem chama responde 404 (não revela que o cliente existe).
 */
import {
  ACCESS_SCOPES,
  type AccessScope,
  CLIENT_ROLES,
  type ClientRole,
  type ClientStatus,
  CLIENT_STATUSES,
  PLATFORM_ROLES,
  type PlatformRole,
} from "@engemase/db"
import { clientRolePermissions, type Permission, platformRolePermissions, requiresTwoFactor } from "./permissions"

/** Escopo efetivo do acesso (D11). Listas nunca vazias: vazio = sem acesso, decidido antes. */
export type Scope =
  | { readonly kind: "all" }
  | { readonly kind: "units"; readonly unitIds: readonly string[] }
  | { readonly kind: "machines"; readonly machineIds: readonly string[] }

/** Como a pessoa entrou no cliente. */
export type TenantAccess =
  | {
      readonly kind: "member"
      readonly role: ClientRole
      readonly memberId: string
      readonly memberAccessId: string
    }
  | {
      /** Equipe Engemase: sempre com registro na auditoria e faixa na tela (D5). */
      readonly kind: "engemase"
      readonly role: PlatformRole
      /** Concessão de suporte usada (papel `support`). */
      readonly supportGrantId: string | null
      /** Atribuição usada (papel `field_engineer`). */
      readonly assignmentId: string | null
    }

/** Pessoa autenticada (vem da sessão do Better Auth, nunca do navegador). */
export interface SessionUser {
  readonly id: string
  readonly name: string
  readonly email: string
  /** `user.role` (texto livre no banco; só vale se estiver em PLATFORM_ROLES). */
  readonly role: string | null
  readonly banned: boolean
  readonly twoFactorEnabled: boolean
}

export interface TenantContext {
  readonly organizationId: string
  readonly slug: string
  readonly clientStatus: ClientStatus
  readonly user: Pick<SessionUser, "id" | "name" | "email">
  /** Sessão usada (para registrar a entrada da Engemase uma vez por sessão). */
  readonly sessionId: string
  readonly access: TenantAccess
  readonly scope: Scope
  readonly permissions: ReadonlySet<Permission>
}

/** O que o banco diz sobre a pessoa no cliente (lido sob RLS, com `app.org_id` = o cliente). */
export interface AccessFacts {
  readonly organization: { readonly id: string; readonly slug: string; readonly status: string } | null
  readonly membership: {
    readonly memberId: string
    readonly memberAccessId: string | null
    readonly role: string | null
    readonly scope: string | null
    readonly active: boolean
    /** Unidades do escopo `units` (só as não excluídas). */
    readonly unitIds: readonly string[]
    /** Máquinas do escopo `machines` (só as não excluídas). */
    readonly machineIds: readonly string[]
  } | null
  /** Concessão de suporte ativa agora, se houver. */
  readonly supportGrantId: string | null
  /** Atribuição de engenheiro de campo válida agora, se houver (sem unidades = cliente inteiro). */
  readonly assignment: { readonly id: string; readonly unitIds: readonly string[] } | null
}

/** Por que o acesso foi negado. Quem chama decide a resposta (404, login, cadastro do 2FA...). */
export type AccessDenial =
  /** Cliente inexistente OU pessoa sem vínculo/escopo/concessão: responder 404 nos dois casos. */
  | "not_found"
  /** Sem sessão válida (ou pessoa bloqueada): ir para o login. */
  | "unauthenticated"
  /** Cliente suspenso ou encerrado: usuários do cliente não entram (docs/15, seção 6). */
  | "client_suspended"
  /** Papel exige 2FA (D14) e a pessoa ainda não cadastrou. */
  | "two_factor_required"
  /** Entrou no cliente, mas o papel não permite a ação. */
  | "forbidden"

export class AccessDeniedError extends Error {
  override readonly name = "AccessDeniedError"
  constructor(readonly reason: AccessDenial) {
    super(`acesso negado: ${reason}`)
  }
}

export type AccessDecision =
  | { readonly ok: true; readonly context: TenantContext }
  | { readonly ok: false; readonly reason: AccessDenial }

function isOneOf<T extends string>(values: readonly T[], value: string | null | undefined): value is T {
  return value !== null && value !== undefined && (values as readonly string[]).includes(value)
}

/** Papel de plataforma da pessoa, ou `null` (texto desconhecido não vale nada). */
export function platformRoleOf(user: Pick<SessionUser, "role">): PlatformRole | null {
  return isOneOf(PLATFORM_ROLES, user.role) ? user.role : null
}

function engemaseAccess(
  role: PlatformRole,
  facts: AccessFacts,
): { readonly access: TenantAccess; readonly scope: Scope } | null {
  switch (role) {
    case "super_admin":
      return { access: { kind: "engemase", role, supportGrantId: null, assignmentId: null }, scope: { kind: "all" } }
    case "support":
      if (facts.supportGrantId === null) return null
      return {
        access: { kind: "engemase", role, supportGrantId: facts.supportGrantId, assignmentId: null },
        scope: { kind: "all" },
      }
    case "field_engineer": {
      const assignment = facts.assignment
      if (assignment === null) return null
      return {
        access: { kind: "engemase", role, supportGrantId: null, assignmentId: assignment.id },
        scope: assignment.unitIds.length > 0 ? { kind: "units", unitIds: [...assignment.unitIds] } : { kind: "all" },
      }
    }
  }
}

function memberScope(scope: AccessScope, unitIds: readonly string[], machineIds: readonly string[]): Scope | null {
  switch (scope) {
    case "all":
      return { kind: "all" }
    case "units":
      return unitIds.length > 0 ? { kind: "units", unitIds: [...unitIds] } : null
    case "machines":
      return machineIds.length > 0 ? { kind: "machines", machineIds: [...machineIds] } : null
  }
}

function memberAccess(
  facts: AccessFacts,
): { readonly access: TenantAccess; readonly scope: Scope } | null {
  const m = facts.membership
  if (m === null || m.memberAccessId === null || !m.active) return null
  if (!isOneOf(CLIENT_ROLES, m.role) || !isOneOf(ACCESS_SCOPES, m.scope)) return null
  // O banco já garante (member_access_admin_scope_chk); conferimos de novo por segurança.
  if (m.role === "client_admin" && m.scope !== "all") return null
  const scope = memberScope(m.scope, m.unitIds, m.machineIds)
  if (scope === null) return null
  return { access: { kind: "member", role: m.role, memberId: m.memberId, memberAccessId: m.memberAccessId }, scope }
}

/**
 * Decide o acesso de `user` ao cliente descrito por `facts`. A equipe Engemase entra pelo papel de
 * plataforma (super admin, concessão de suporte ou atribuição); se não tiver, cai no vínculo comum
 * (só existe na organização interna "Engemase Lab").
 */
export function decideAccess(user: SessionUser, sessionId: string, facts: AccessFacts): AccessDecision {
  if (user.banned) return { ok: false, reason: "unauthenticated" }
  const org = facts.organization
  if (org === null || !isOneOf(CLIENT_STATUSES, org.status)) return { ok: false, reason: "not_found" }

  const platformRole = platformRoleOf(user)
  const viaEngemase = platformRole === null ? null : engemaseAccess(platformRole, facts)
  const resolved = viaEngemase ?? memberAccess(facts)
  if (resolved === null) return { ok: false, reason: "not_found" }

  const { access, scope } = resolved
  // Cliente suspenso ou encerrado: usuários do cliente não entram; a Engemase continua, com registro.
  if (access.kind === "member" && (org.status === "suspended" || org.status === "closed")) {
    return { ok: false, reason: "client_suspended" }
  }
  const clientRole = access.kind === "member" ? access.role : null
  if (requiresTwoFactor({ platformRole, clientRole }) && !user.twoFactorEnabled) {
    return { ok: false, reason: "two_factor_required" }
  }

  const permissions = access.kind === "member" ? clientRolePermissions(access.role) : platformRolePermissions(access.role)
  return {
    ok: true,
    context: {
      organizationId: org.id,
      slug: org.slug,
      clientStatus: org.status,
      user: { id: user.id, name: user.name, email: user.email },
      sessionId,
      access,
      scope,
      permissions,
    },
  }
}

export function hasPermission(ctx: TenantContext, permission: Permission): boolean {
  return ctx.permissions.has(permission)
}

/** Lança `AccessDeniedError("forbidden")` se o papel não tiver a permissão. */
export function assertPermission(ctx: TenantContext, permission: Permission): void {
  if (!hasPermission(ctx, permission)) throw new AccessDeniedError("forbidden")
}
