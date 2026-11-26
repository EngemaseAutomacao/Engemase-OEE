/**
 * Monta o `TenantContext` lendo o banco SOB RLS (docs/15, seção 4):
 *
 * 1. slug da URL → id do cliente, por `app.resolve_org_slug` (não autoriza nada);
 * 2. dentro de `withTenant(cliente)` (papel `app_user` + `app.org_id`): estado do cliente, vínculo da
 *    pessoa com papel e escopo, concessão de suporte ou atribuição da Engemase — tudo filtrado pela
 *    RLS, então nada de outro cliente pode entrar na decisão;
 * 3. `decideAccess` (função pura) decide;
 * 4. entrada da Engemase fica na auditoria do cliente (uma linha por sessão, D5).
 *
 * Não depende do Next.js: recebe o banco e a pessoa já autenticada (testado com PGlite).
 */
import {
  auditLog,
  clientAccount,
  machine,
  member,
  memberAccess,
  memberMachine,
  memberUnit,
  organization,
  platformAssignment,
  platformAssignmentUnit,
  resolveOrganizationSlug,
  supportAccessGrant,
  unit,
  withTenant,
} from "@engemase/db"
import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm"
import { PLATFORM_ROLE_LABEL } from "@/lib/roles"
import { type GatewayDb, type GatewayTx, rowsExecutor } from "@/lib/server/gateway/types"
import { type AccessDecision, type AccessFacts, decideAccess, type SessionUser, type TenantContext } from "./context"

export interface LoadTenantInput {
  readonly slug: string
  readonly user: SessionUser
  readonly sessionId: string
  readonly now: Date
  readonly ip?: string | null
  readonly userAgent?: string | null
}

/** Lê os fatos de acesso da pessoa no cliente da transação (já com `app.org_id` definido). */
export async function readAccessFacts(tx: GatewayTx, userId: string, now: Date): Promise<AccessFacts> {
  const [org] = await tx
    .select({ id: organization.id, slug: organization.slug, status: clientAccount.status })
    .from(organization)
    .innerJoin(clientAccount, eq(clientAccount.organizationId, organization.id))
    .limit(1)

  const [m] = await tx
    .select({
      memberId: member.id,
      memberAccessId: memberAccess.id,
      role: memberAccess.role,
      scope: memberAccess.scope,
      active: memberAccess.active,
    })
    .from(member)
    .leftJoin(
      memberAccess,
      and(eq(memberAccess.memberId, member.id), eq(memberAccess.organizationId, member.organizationId)),
    )
    .where(eq(member.userId, userId))
    .limit(1)

  let unitIds: string[] = []
  let machineIds: string[] = []
  if (m?.memberAccessId != null && m.scope === "units") {
    const rows = await tx
      .select({ id: memberUnit.unitId })
      .from(memberUnit)
      .innerJoin(unit, and(eq(unit.id, memberUnit.unitId), eq(unit.organizationId, memberUnit.organizationId)))
      .where(and(eq(memberUnit.memberAccessId, m.memberAccessId), isNull(unit.deletedAt)))
    unitIds = rows.map((r) => r.id)
  } else if (m?.memberAccessId != null && m.scope === "machines") {
    const rows = await tx
      .select({ id: memberMachine.machineId })
      .from(memberMachine)
      .innerJoin(
        machine,
        and(eq(machine.id, memberMachine.machineId), eq(machine.organizationId, memberMachine.organizationId)),
      )
      .where(and(eq(memberMachine.memberAccessId, m.memberAccessId), isNull(machine.deletedAt)))
    machineIds = rows.map((r) => r.id)
  }

  const [grant] = await tx
    .select({ id: supportAccessGrant.id })
    .from(supportAccessGrant)
    .where(
      and(
        eq(supportAccessGrant.userId, userId),
        eq(supportAccessGrant.status, "active"),
        isNull(supportAccessGrant.endedAt),
        lte(supportAccessGrant.startsAt, now),
        gt(supportAccessGrant.endsAt, now),
      ),
    )
    .orderBy(desc(supportAccessGrant.endsAt))
    .limit(1)

  const [assignment] = await tx
    .select({ id: platformAssignment.id })
    .from(platformAssignment)
    .where(
      and(
        eq(platformAssignment.userId, userId),
        isNull(platformAssignment.revokedAt),
        lte(platformAssignment.validFrom, now),
        gt(platformAssignment.validUntil, now),
      ),
    )
    .orderBy(desc(platformAssignment.validUntil))
    .limit(1)

  let assignmentFacts: AccessFacts["assignment"] = null
  if (assignment !== undefined) {
    const listed = await tx
      .select({ id: platformAssignmentUnit.unitId, deletedAt: unit.deletedAt })
      .from(platformAssignmentUnit)
      .innerJoin(
        unit,
        and(eq(unit.id, platformAssignmentUnit.unitId), eq(unit.organizationId, platformAssignmentUnit.organizationId)),
      )
      .where(eq(platformAssignmentUnit.assignmentId, assignment.id))
    const live = listed.filter((r) => r.deletedAt === null).map((r) => r.id)
    // Atribuição restrita a unidades que foram todas excluídas: nenhum acesso (não vira "cliente inteiro").
    assignmentFacts = listed.length > 0 && live.length === 0 ? null : { id: assignment.id, unitIds: live }
  }

  return {
    organization: org ?? null,
    membership:
      m === undefined
        ? null
        : {
            memberId: m.memberId,
            memberAccessId: m.memberAccessId,
            role: m.role,
            scope: m.scope,
            active: m.active ?? false,
            unitIds,
            machineIds,
          },
    supportGrantId: grant?.id ?? null,
    assignment: assignmentFacts,
  }
}

/** Registra na auditoria do cliente a entrada da Engemase (uma vez por sessão; D5, docs/15 seção 3). */
async function recordEngemaseEntry(tx: GatewayTx, ctx: TenantContext, input: LoadTenantInput): Promise<void> {
  if (ctx.access.kind !== "engemase") return
  const access = ctx.access
  const action = "engemase.access"
  const [already] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.actorId, ctx.user.id), eq(auditLog.entityId, ctx.sessionId)))
    .limit(1)
  if (already !== undefined) return
  await tx.insert(auditLog).values({
    organizationId: ctx.organizationId,
    actorType: "engemase",
    actorId: ctx.user.id,
    actorLabel: `${ctx.user.name} (${PLATFORM_ROLE_LABEL[access.role].toLowerCase()} Engemase)`,
    action,
    entityType: "session",
    entityId: ctx.sessionId,
    after: { role: access.role, supportGrantId: access.supportGrantId, assignmentId: access.assignmentId },
    accessGrantId: access.supportGrantId ?? access.assignmentId,
    ip: input.ip ?? null,
    userAgent: input.userAgent?.slice(0, 512) ?? null,
    at: input.now,
  })
}

/** Resolve o slug ANTES de saber o cliente (papel `app_user`, sem `app.org_id`). */
async function resolveSlug(db: GatewayDb, slug: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`)
    return resolveOrganizationSlug(rowsExecutor(tx), slug)
  })
}

/** Decide o acesso da pessoa ao cliente do slug. Nunca lança por falta de acesso (devolve o motivo). */
export async function loadTenantContext(db: GatewayDb, input: LoadTenantInput): Promise<AccessDecision> {
  if (input.user.banned) return { ok: false, reason: "unauthenticated" }
  const organizationId = await resolveSlug(db, input.slug)
  if (organizationId === null) return { ok: false, reason: "not_found" }
  return withTenant(db, organizationId, async (tx) => {
    const facts = await readAccessFacts(tx, input.user.id, input.now)
    const decision = decideAccess(input.user, input.sessionId, facts)
    if (decision.ok) await recordEngemaseEntry(tx, decision.context, input)
    return decision
  })
}

/** Roda `fn` sob RLS no cliente do contexto (a única porta para dados de cliente). */
export function withContext<T>(db: GatewayDb, ctx: TenantContext, fn: (tx: GatewayTx) => Promise<T>): Promise<T> {
  return withTenant(db, ctx.organizationId, fn)
}
