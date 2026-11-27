/**
 * Gestão da equipe Engemase no banco (console; docs/15, seção 3): concessões de suporte, atribuições e as
 * ações sobre os membros (papel, desativar, convite, 2FA).
 *
 * Quem pode:
 * - Concessão de suporte: o técnico abre para si mesmo (motivo, chamado, até 4 h; o banco recusa mais);
 *   o super admin pode abrir para qualquer técnico ativo. Encerrar: o super admin ou o próprio técnico.
 * - Atribuições e ações sobre membros: só o super admin. Ninguém age sobre si mesmo (papel, desativar,
 *   2FA) e o último super admin ativo não é rebaixado nem desativado.
 *
 * Toda pessoa e todo cliente são achados no servidor pelos ids, conferidos de novo aqui (nunca se confia
 * no que a tela diz sobre papel ou status). Tudo vai para a auditoria: concessões e atribuições na do
 * cliente (visível a ele); o resto na da Engemase Lab.
 */
import {
  account,
  accountToken,
  auditLog,
  newAccountToken,
  organization,
  PLATFORM_ROLES,
  type PlatformRole,
  platformAssignment,
  platformAssignmentUnit,
  session,
  SET_PASSWORD_TOKEN_TTL_MS,
  setPasswordUrl,
  supportAccessGrant,
  twoFactor,
  unit,
  user,
  withTenant,
} from "@engemase/db"
import { and, count, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { z } from "zod"
import type { ThrottleDb } from "@/lib/server/auth/throttle"
import { type EmailSender, sendSafely } from "@/lib/server/email"
import { setPasswordEmail } from "@/lib/server/email/templates"
import type { GatewayDb } from "@/lib/server/gateway/types"
import { ASSIGNMENT_DAYS, ENGEMASE_LAB_SLUG } from "./add-member"

export interface TeamDeps {
  readonly db: GatewayDb
  readonly authDb: ThrottleDb
  readonly now: Date
  readonly baseURL: string
  readonly sendEmail: EmailSender
}

/** Quem age (sessão do servidor). */
export interface TeamActorWithRole {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: PlatformRole
}

export type TeamResult<T = undefined> = { readonly status: "ok"; readonly data: T } | { readonly status: "error"; readonly message: string }

const ok = <T>(data: T): TeamResult<T> => ({ status: "ok", data })
const err = (message: string): TeamResult<never> => ({ status: "error", message })
const ONLY_SUPER = err("Só o super admin da Engemase pode fazer isso.")

/** Durações aceitas para a concessão (minutos); o banco recusa mais de 4 h. */
export const GRANT_MINUTES = [30, 60, 120, 240] as const

function label(actor: TeamActorWithRole): string {
  return `${actor.name} (${actor.role === "super_admin" ? "super admin" : "técnico"} Engemase)`
}

async function technician(deps: TeamDeps, userId: string) {
  const [p] = await deps.authDb.select({ id: user.id, name: user.name, role: user.role, banned: user.banned }).from(user).where(eq(user.id, userId)).limit(1)
  return p !== undefined && p.role === "technician" && !p.banned ? p : null
}

async function clientOf(deps: TeamDeps, clientId: string) {
  const [c] = await deps.authDb.select({ id: organization.id, name: organization.name, slug: organization.slug }).from(organization).where(eq(organization.id, clientId)).limit(1)
  return c !== undefined && c.slug !== ENGEMASE_LAB_SLUG ? c : null
}

async function labId(deps: TeamDeps): Promise<string> {
  const [lab] = await deps.authDb.select({ id: organization.id }).from(organization).where(eq(organization.slug, ENGEMASE_LAB_SLUG)).limit(1)
  if (lab === undefined) throw new Error("Engemase Lab não existe")
  return lab.id
}

async function auditLab(deps: TeamDeps, actor: TeamActorWithRole, action: string, entityId: string, after: Record<string, unknown>) {
  const orgId = await labId(deps)
  await withTenant(deps.db, orgId, (tx) =>
    tx.insert(auditLog).values({ organizationId: orgId, actorType: "engemase", actorId: actor.id, actorLabel: label(actor), action, entityType: "user", entityId, after, at: deps.now }),
  )
}

// ---------------------------------------------------------------------------------------------
// Concessões de suporte
// ---------------------------------------------------------------------------------------------

const OpenGrantInput = z.object({
  clientId: z.uuid("Cliente inválido."),
  /** Técnico da concessão; sem ele, a própria pessoa (técnico abrindo para si). */
  userId: z.uuid().nullable().default(null),
  ticket: z
    .string()
    .trim()
    .regex(/^#?\d{1,8}$/, "Informe o número do chamado (ex.: #1060).")
    .transform((t) => (t.startsWith("#") ? t : `#${t}`)),
  reason: z.string().trim().min(10, "Descreva o motivo (pelo menos 10 caracteres).").max(500),
  minutes: z.coerce.number().refine((m) => (GRANT_MINUTES as readonly number[]).includes(m), "Prazo inválido (até 4 h)."),
})

export async function openSupportGrant(deps: TeamDeps, actor: TeamActorWithRole, input: unknown): Promise<TeamResult<{ id: string; endsAt: Date }>> {
  const parsed = OpenGrantInput.safeParse(input)
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Confira os dados.")
  const d = parsed.data
  const targetId = d.userId ?? actor.id
  if (actor.role !== "super_admin" && targetId !== actor.id) return err("O técnico só abre concessão para si mesmo.")
  const person = await technician(deps, targetId)
  if (person === null) return err("A concessão de suporte é só para técnicos ativos da equipe.")
  const client = await clientOf(deps, d.clientId)
  if (client === null) return err("Cliente não encontrado.")
  const endsAt = new Date(deps.now.getTime() + d.minutes * 60_000)
  const id = await withTenant(deps.db, client.id, async (tx) => {
    const [g] = await tx
      .insert(supportAccessGrant)
      .values({ organizationId: client.id, userId: person.id, reason: d.reason, ticket: d.ticket, startsAt: deps.now, endsAt, createdAt: deps.now })
      .returning({ id: supportAccessGrant.id })
    if (g === undefined) throw new Error("concessão não gravada")
    await tx.insert(auditLog).values({
      organizationId: client.id,
      actorType: "engemase",
      actorId: actor.id,
      actorLabel: label(actor),
      action: "support.grant_open",
      entityType: "support_access_grant",
      entityId: g.id,
      after: { technician: person.name, ticket: d.ticket, reason: d.reason, minutes: d.minutes },
      at: deps.now,
    })
    return g.id
  })
  return ok({ id, endsAt })
}

const RefInput = z.object({ id: z.uuid("Registro inválido."), clientId: z.uuid("Cliente inválido.") })

export async function endSupportGrant(deps: TeamDeps, actor: TeamActorWithRole, input: unknown): Promise<TeamResult> {
  const parsed = RefInput.safeParse(input)
  if (!parsed.success) return err("Concessão inválida.")
  const { id, clientId } = parsed.data
  const client = await clientOf(deps, clientId)
  if (client === null) return err("Cliente não encontrado.")
  return withTenant(deps.db, client.id, async (tx) => {
    const [g] = await tx.select().from(supportAccessGrant).where(eq(supportAccessGrant.id, id)).limit(1)
    if (g === undefined) return err("Concessão não encontrada.")
    if (actor.role !== "super_admin" && g.userId !== actor.id) return err("Só o super admin ou o próprio técnico encerram a concessão.")
    if (g.status !== "active" || g.endedAt !== null || g.endsAt <= deps.now) return err("Esta concessão já terminou.")
    await tx.update(supportAccessGrant).set({ status: "ended", endedAt: deps.now, endedBy: actor.id }).where(eq(supportAccessGrant.id, id))
    await tx.insert(auditLog).values({
      organizationId: client.id,
      actorType: "engemase",
      actorId: actor.id,
      actorLabel: label(actor),
      action: "support.grant_end",
      entityType: "support_access_grant",
      entityId: id,
      after: { ticket: g.ticket },
      at: deps.now,
    })
    return ok(undefined)
  })
}

// ---------------------------------------------------------------------------------------------
// Atribuições (só super admin)
// ---------------------------------------------------------------------------------------------

const AssignmentInput = z.object({
  userId: z.uuid("Escolha o técnico."),
  clientId: z.uuid("Escolha o cliente."),
  /** `null` ou vazio: cliente inteiro. */
  unitIds: z.array(z.uuid()).max(500).nullable().default(null),
  days: z.coerce.number().refine((n) => (ASSIGNMENT_DAYS as readonly number[]).includes(n), "Validade inválida."),
  reason: z.string().trim().min(5, "Descreva o motivo (pelo menos 5 caracteres).").max(300),
})

export async function createAssignment(deps: TeamDeps, actor: TeamActorWithRole, input: unknown): Promise<TeamResult<{ id: string }>> {
  if (actor.role !== "super_admin") return ONLY_SUPER
  const parsed = AssignmentInput.safeParse(input)
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Confira os dados.")
  const d = parsed.data
  const person = await technician(deps, d.userId)
  if (person === null) return err("Atribuição só para técnicos ativos da equipe.")
  const client = await clientOf(deps, d.clientId)
  if (client === null) return err("Cliente não encontrado.")
  const unitIds = [...new Set(d.unitIds ?? [])]
  return withTenant(deps.db, client.id, async (tx) => {
    // Unidades conferidas sob a RLS do cliente: id de outro cliente (ou excluída) não existe aqui.
    if (unitIds.length > 0) {
      const found = await tx.select({ id: unit.id }).from(unit).where(and(inArray(unit.id, unitIds), isNull(unit.deletedAt)))
      if (found.length !== unitIds.length) return err("Alguma unidade não pertence a este cliente.")
    }
    const [dup] = await tx
      .select({ id: platformAssignment.id })
      .from(platformAssignment)
      .where(and(eq(platformAssignment.userId, person.id), isNull(platformAssignment.revokedAt), sql`${platformAssignment.validUntil} > ${deps.now}`))
      .limit(1)
    if (dup !== undefined) return err(`${person.name} já tem uma atribuição vigente neste cliente. Renove ou revogue a atual.`)
    const [a] = await tx
      .insert(platformAssignment)
      .values({
        organizationId: client.id,
        userId: person.id,
        reason: d.reason,
        validFrom: deps.now,
        validUntil: new Date(deps.now.getTime() + d.days * 86_400_000),
        createdBy: actor.id,
        createdAt: deps.now,
      })
      .returning({ id: platformAssignment.id })
    if (a === undefined) throw new Error("atribuição não gravada")
    if (unitIds.length > 0) {
      await tx.insert(platformAssignmentUnit).values(unitIds.map((unitId) => ({ organizationId: client.id, assignmentId: a.id, unitId })))
    }
    await tx.insert(auditLog).values({
      organizationId: client.id,
      actorType: "engemase",
      actorId: actor.id,
      actorLabel: label(actor),
      action: "platform.assignment_create",
      entityType: "platform_assignment",
      entityId: a.id,
      after: { technician: person.name, days: d.days, units: unitIds.length > 0 ? unitIds.length : "all", reason: d.reason },
      at: deps.now,
    })
    return ok({ id: a.id })
  })
}

async function changeAssignment(
  deps: TeamDeps,
  actor: TeamActorWithRole,
  input: unknown,
  kind: "renew" | "revoke",
): Promise<TeamResult> {
  if (actor.role !== "super_admin") return ONLY_SUPER
  const parsed = RefInput.safeParse(input)
  if (!parsed.success) return err("Atribuição inválida.")
  const { id, clientId } = parsed.data
  const client = await clientOf(deps, clientId)
  if (client === null) return err("Cliente não encontrado.")
  return withTenant(deps.db, client.id, async (tx) => {
    const [a] = await tx.select().from(platformAssignment).where(eq(platformAssignment.id, id)).limit(1)
    if (a === undefined || a.revokedAt !== null) return err("Atribuição não encontrada ou já revogada.")
    if (kind === "revoke") {
      await tx.update(platformAssignment).set({ revokedAt: deps.now, revokedBy: actor.id }).where(eq(platformAssignment.id, id))
    } else {
      await tx.update(platformAssignment).set({ validUntil: new Date(deps.now.getTime() + 90 * 86_400_000) }).where(eq(platformAssignment.id, id))
    }
    await tx.insert(auditLog).values({
      organizationId: client.id,
      actorType: "engemase",
      actorId: actor.id,
      actorLabel: label(actor),
      action: kind === "revoke" ? "platform.assignment_revoke" : "platform.assignment_renew",
      entityType: "platform_assignment",
      entityId: id,
      after: kind === "renew" ? { days: 90 } : {},
      at: deps.now,
    })
    return ok(undefined)
  })
}

export const renewAssignment = (deps: TeamDeps, actor: TeamActorWithRole, input: unknown) => changeAssignment(deps, actor, input, "renew")
export const revokeAssignment = (deps: TeamDeps, actor: TeamActorWithRole, input: unknown) => changeAssignment(deps, actor, input, "revoke")

// ---------------------------------------------------------------------------------------------
// Membros (só super admin)
// ---------------------------------------------------------------------------------------------

const MemberRef = z.object({ userId: z.uuid("Pessoa inválida.") })

interface Member {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: PlatformRole
  readonly banned: boolean
}

/** Membro da equipe (papel de plataforma) que não é quem age. */
async function otherMember(
  deps: TeamDeps,
  actor: TeamActorWithRole,
  input: unknown,
): Promise<{ readonly error: TeamResult<never> } | { readonly person: Member }> {
  if (actor.role !== "super_admin") return { error: ONLY_SUPER }
  const parsed = MemberRef.safeParse(input)
  if (!parsed.success) return { error: err("Pessoa inválida.") }
  if (parsed.data.userId === actor.id) return { error: err("Ninguém altera o próprio acesso por aqui.") }
  const [p] = await deps.authDb
    .select({ id: user.id, name: user.name, email: user.email, role: user.role, banned: user.banned })
    .from(user)
    .where(eq(user.id, parsed.data.userId))
    .limit(1)
  if (p === undefined || p.role === null || !(PLATFORM_ROLES as readonly string[]).includes(p.role)) return { error: err("Esta pessoa não é da equipe Engemase.") }
  return { person: { ...p, role: p.role as PlatformRole } }
}

async function isLastActiveSuper(deps: TeamDeps, userId: string): Promise<boolean> {
  const [r] = await deps.authDb
    .select({ n: count() })
    .from(user)
    .where(and(eq(user.role, "super_admin"), eq(user.banned, false), ne(user.id, userId)))
  return (r?.n ?? 0) === 0
}

export async function changeMemberRole(deps: TeamDeps, actor: TeamActorWithRole, input: unknown): Promise<TeamResult> {
  const role = z.object({ role: z.enum(PLATFORM_ROLES, "Papel inválido.") }).safeParse(input)
  if (!role.success) return err("Papel inválido.")
  const found = await otherMember(deps, actor, input)
  if ("error" in found) return found.error
  const p = found.person
  if (p.role === role.data.role) return ok(undefined)
  if (p.role === "super_admin" && !p.banned && (await isLastActiveSuper(deps, p.id))) return err("Não dá para rebaixar o último super admin ativo.")
  await deps.authDb.update(user).set({ role: role.data.role, updatedAt: deps.now }).where(eq(user.id, p.id))
  // Sessões abertas com o papel antigo caem: a próxima entrada já usa o novo.
  await deps.authDb.delete(session).where(eq(session.userId, p.id))
  await auditLab(deps, actor, "platform.user_role_change", p.id, { from: p.role, to: role.data.role })
  return ok(undefined)
}

export async function setMemberDisabled(deps: TeamDeps, actor: TeamActorWithRole, input: unknown, disabled: boolean): Promise<TeamResult> {
  const found = await otherMember(deps, actor, input)
  if ("error" in found) return found.error
  const p = found.person
  if (disabled && p.role === "super_admin" && !p.banned && (await isLastActiveSuper(deps, p.id))) return err("Não dá para desativar o último super admin ativo.")
  await deps.authDb.update(user).set({ banned: disabled, updatedAt: deps.now }).where(eq(user.id, p.id))
  if (disabled) await deps.authDb.delete(session).where(eq(session.userId, p.id))
  await auditLab(deps, actor, disabled ? "platform.user_disable" : "platform.user_enable", p.id, {})
  return ok(undefined)
}

export async function resendTeamInvite(deps: TeamDeps, actor: TeamActorWithRole, input: unknown): Promise<TeamResult<{ link: string; expiresAt: Date; emailSent: boolean }>> {
  const found = await otherMember(deps, actor, input)
  if ("error" in found) return found.error
  const p = found.person
  if (p.banned) return err("Reative o acesso antes de reenviar o convite.")
  const [credential] = await deps.authDb.select({ id: account.id }).from(account).where(and(eq(account.userId, p.id), eq(account.providerId, "credential"))).limit(1)
  if (credential !== undefined) return err("Esta pessoa já definiu a senha: ela pode usar \"Esqueci minha senha\" no login.")
  const orgId = await labId(deps)
  const fresh = newAccountToken()
  const expiresAt = new Date(deps.now.getTime() + SET_PASSWORD_TOKEN_TTL_MS)
  await withTenant(deps.db, orgId, async (tx) => {
    await tx
      .update(accountToken)
      .set({ usedAt: deps.now })
      .where(and(eq(accountToken.organizationId, orgId), eq(accountToken.userId, p.id), eq(accountToken.purpose, "set_password"), isNull(accountToken.usedAt)))
    await tx.insert(accountToken).values({ organizationId: orgId, purpose: "set_password", tokenHash: fresh.hash, userId: p.id, expiresAt, createdBy: actor.id, createdAt: deps.now })
    await tx.insert(auditLog).values({ organizationId: orgId, actorType: "engemase", actorId: actor.id, actorLabel: label(actor), action: "platform.user_invite_resend", entityType: "user", entityId: p.id, after: {}, at: deps.now })
  })
  const link = setPasswordUrl(deps.baseURL, fresh.token)
  const sent = await sendSafely(
    deps.sendEmail,
    setPasswordEmail({ to: p.email, name: p.name, clientName: "equipe Engemase", invitedBy: actor.name, url: link, ttlMs: SET_PASSWORD_TOKEN_TTL_MS }),
    "convite da equipe Engemase (reenvio)",
  )
  return ok({ link, expiresAt, emailSent: sent.status === "sent" })
}

export async function resetMemberTwoFactorStaff(deps: TeamDeps, actor: TeamActorWithRole, input: unknown): Promise<TeamResult> {
  const found = await otherMember(deps, actor, input)
  if ("error" in found) return found.error
  const p = found.person
  await deps.authDb.delete(twoFactor).where(eq(twoFactor.userId, p.id))
  await deps.authDb.update(user).set({ twoFactorEnabled: false, updatedAt: deps.now }).where(eq(user.id, p.id))
  await deps.authDb.delete(session).where(eq(session.userId, p.id))
  await auditLab(deps, actor, "platform.user_2fa_reset", p.id, {})
  return ok(undefined)
}
