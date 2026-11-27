/**
 * Alterar o acesso de um usuário do cliente (papel e escopo) e desativar/reativar o vínculo (D11, D12).
 *
 * Regras (as mesmas do convite, `invite.ts`):
 * - só quem tem `users.manage` no cliente da URL (admin do cliente; super admin);
 * - o vínculo é lido sob a RLS do cliente: id de outro cliente não existe aqui (fail-closed);
 * - ninguém altera nem desativa o PRÓPRIO acesso por aqui (evita o admin se trancar para fora);
 * - pessoas da equipe Engemase (papel de plataforma) não são geridas por aqui, como no convite e no 2FA;
 * - o cliente nunca fica sem admin que consiga entrar: as linhas dos admins ativos são travadas (`FOR UPDATE`)
 *   na mesma transação, e só conta como "outro admin" quem já criou a senha e não está bloqueado. Dois admins
 *   rebaixando um ao outro ao mesmo tempo não zeram os admins (no pior caso o banco aborta um dos dois);
 * - unidades e máquinas do escopo conferidas sob a RLS; admin sempre com o cliente inteiro;
 * - reativar respeita o `limits.users` do contrato (linha do contrato travada para a contagem);
 * - tudo auditado (antes e depois), inclusive o pedido de redefinição de senha feito pelo admin.
 *
 * Desativar é por cliente (`member_access.active = false`): a pessoa continua com os outros clientes, e a
 * camada de acesso lê o vínculo a cada requisição, então o acesso a ESTE cliente cai na hora, sem derrubar a
 * sessão. A conta inteira só é bloqueada pela Engemase (`user.banned`).
 */
import {
  ACCESS_SCOPES,
  account,
  auditLog,
  CLIENT_ROLES,
  clientAccount,
  member,
  memberAccess,
  memberMachine,
  memberUnit,
  PLATFORM_ROLES,
  user,
} from "@engemase/db"
import { and, count, eq, inArray, isNotNull, ne } from "drizzle-orm"
import { z } from "zod"
import { assertPermission, type TenantContext } from "@/lib/server/access/context"
import { withContext } from "@/lib/server/access/load"
import type { RequestResetResult } from "@/lib/server/auth/password-reset"
import type { GatewayTx } from "@/lib/server/gateway/types"
import { auditActor } from "./audit"
import { scopeTargetsExist, type UsersDeps } from "./invite"
import { lockSeats } from "./seats"

export type ManageResult =
  | { readonly status: "ok" }
  | {
      readonly status: "error"
      readonly code: "invalid" | "not_found" | "self" | "last_admin" | "limit" | "no_password" | "throttled"
      readonly message: string
    }

const NOT_FOUND = { status: "error", code: "not_found", message: "Usuário não encontrado neste cliente. Atualize a página." } as const
const SELF = { status: "error", code: "self", message: "Você não pode alterar o próprio acesso. Peça a outro admin do cliente." } as const
const LAST_ADMIN = {
  status: "error",
  code: "last_admin",
  message: "Este é o único admin ativo do cliente. Promova outra pessoa a admin antes.",
} as const

export const AccessChangeInput = z
  .object({
    memberId: z.uuid("Usuário inválido."),
    role: z.enum(CLIENT_ROLES, "Papel inválido."),
    scope: z.enum(ACCESS_SCOPES, "Escopo inválido."),
    unitIds: z.array(z.uuid()).max(500).default([]),
    machineIds: z.array(z.uuid()).max(2000).default([]),
  })
  .superRefine((v, issue) => {
    if (v.role === "client_admin" && v.scope !== "all") {
      issue.addIssue({ code: "custom", path: ["scope"], message: "O admin do cliente sempre tem o cliente inteiro." })
    }
    if (v.scope === "units" && (v.unitIds.length === 0 || v.machineIds.length > 0)) {
      issue.addIssue({ code: "custom", path: ["unitIds"], message: "Escolha ao menos uma unidade." })
    }
    if (v.scope === "machines" && (v.machineIds.length === 0 || v.unitIds.length > 0)) {
      issue.addIssue({ code: "custom", path: ["machineIds"], message: "Escolha ao menos uma máquina." })
    }
    if (v.scope === "all" && (v.unitIds.length > 0 || v.machineIds.length > 0)) {
      issue.addIssue({ code: "custom", path: ["scope"], message: "Escopo inválido." })
    }
  })
export type AccessChangeInput = z.input<typeof AccessChangeInput>

const ActiveInput = z.object({ memberId: z.uuid("Usuário inválido."), active: z.boolean() })

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))]
}

interface Target {
  readonly userId: string
  readonly accessId: string
  readonly role: string
  readonly scope: string
  readonly active: boolean
  readonly unitIds: string[]
  readonly machineIds: string[]
}

/** O vínculo, travado para a transação (sob a RLS: de outro cliente, `null`). */
async function lockTarget(tx: GatewayTx, memberId: string): Promise<Target | null> {
  const [row] = await tx
    .select({ userId: member.userId, accessId: memberAccess.id, role: memberAccess.role, scope: memberAccess.scope, active: memberAccess.active })
    .from(member)
    .innerJoin(memberAccess, eq(memberAccess.memberId, member.id))
    .where(eq(member.id, memberId))
    .for("update", { of: memberAccess })
    .limit(1)
  if (row === undefined) return null
  const units = await tx.select({ id: memberUnit.unitId }).from(memberUnit).where(eq(memberUnit.memberAccessId, row.accessId))
  const machines = await tx.select({ id: memberMachine.machineId }).from(memberMachine).where(eq(memberMachine.memberAccessId, row.accessId))
  return { ...row, unitIds: units.map((u) => u.id), machineIds: machines.map((m) => m.id) }
}

/**
 * O que o banco do login diz, lido ANTES da transação do app (nunca dentro dela: não se segura linha travada
 * esperando outro banco). Pessoa do vínculo e quais admins ativos do cliente conseguem entrar (senha criada,
 * conta não bloqueada). `null` = vínculo não existe neste cliente.
 */
interface LoginFacts {
  readonly userId: string
  readonly platformPerson: boolean
  readonly usableAdmins: ReadonlySet<string>
}

async function loginFacts(deps: UsersDeps, ctx: TenantContext, memberId: string): Promise<LoginFacts | null> {
  const app = await withContext(deps.db, ctx, async (tx) => {
    const [row] = await tx.select({ userId: member.userId }).from(member).where(eq(member.id, memberId)).limit(1)
    if (row === undefined) return null
    const admins = await tx
      .select({ userId: member.userId })
      .from(memberAccess)
      .innerJoin(member, eq(member.id, memberAccess.memberId))
      .where(and(eq(memberAccess.role, "client_admin"), eq(memberAccess.active, true)))
    return { userId: row.userId, adminIds: admins.map((a) => a.userId) }
  })
  if (app === null) return null
  const [p] = await deps.authDb.select({ role: user.role }).from(user).where(eq(user.id, app.userId)).limit(1)
  const usable =
    app.adminIds.length === 0
      ? []
      : await deps.authDb
          .select({ id: user.id })
          .from(user)
          .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential"), isNotNull(account.password)))
          .where(and(inArray(user.id, app.adminIds), eq(user.banned, false)))
  return {
    userId: app.userId,
    platformPerson: p?.role != null && (PLATFORM_ROLES as readonly string[]).includes(p.role),
    usableAdmins: new Set(usable.map((u) => u.id)),
  }
}

/**
 * Há outro admin ativo que consiga entrar além deste vínculo? Trava as linhas dos admins ativos até o fim
 * da transação; "consegue entrar" vem de `loginFacts`.
 */
async function anotherActiveAdmin(tx: GatewayTx, accessId: string, usableAdmins: ReadonlySet<string>): Promise<boolean> {
  const others = await tx
    .select({ userId: member.userId })
    .from(memberAccess)
    .innerJoin(member, eq(member.id, memberAccess.memberId))
    .where(and(eq(memberAccess.role, "client_admin"), eq(memberAccess.active, true), ne(memberAccess.id, accessId)))
    .for("update", { of: memberAccess })
  return others.some((o) => usableAdmins.has(o.userId))
}

function snapshot(t: Pick<Target, "role" | "scope" | "active" | "unitIds" | "machineIds">): Record<string, unknown> {
  return { role: t.role, scope: t.scope, active: t.active, unit_ids: t.unitIds, machine_ids: t.machineIds }
}

/** Troca papel e escopo de um vínculo do cliente. */
export async function changeMemberAccess(deps: UsersDeps, ctx: TenantContext, raw: unknown): Promise<ManageResult> {
  assertPermission(ctx, "users.manage")
  const parsed = AccessChangeInput.safeParse(raw)
  if (!parsed.success) return { status: "error", code: "invalid", message: parsed.error.issues[0]?.message ?? "Confira os dados." }
  const input = parsed.data
  const unitIds = unique(input.unitIds)
  const machineIds = unique(input.machineIds)
  const facts = await loginFacts(deps, ctx, input.memberId)
  if (facts === null || facts.platformPerson) return NOT_FOUND
  if (facts.userId === ctx.user.id) return SELF

  return withContext(deps.db, ctx, async (tx): Promise<ManageResult> => {
    const target = await lockTarget(tx, input.memberId)
    if (target === null || target.userId !== facts.userId) return NOT_FOUND
    if (
      target.role === "client_admin" &&
      target.active &&
      input.role !== "client_admin" &&
      !(await anotherActiveAdmin(tx, target.accessId, facts.usableAdmins))
    ) {
      return LAST_ADMIN
    }
    if (!(await scopeTargetsExist(tx, unitIds, machineIds))) {
      return { status: "error", code: "invalid", message: "Unidade ou máquina inválida. Atualize a página e escolha de novo." }
    }
    await tx
      .update(memberAccess)
      .set({ role: input.role, scope: input.scope, updatedAt: deps.now })
      .where(eq(memberAccess.id, target.accessId))
    await tx.delete(memberUnit).where(eq(memberUnit.memberAccessId, target.accessId))
    await tx.delete(memberMachine).where(eq(memberMachine.memberAccessId, target.accessId))
    if (unitIds.length > 0) {
      await tx.insert(memberUnit).values(unitIds.map((unitId) => ({ organizationId: ctx.organizationId, memberAccessId: target.accessId, unitId })))
    }
    if (machineIds.length > 0) {
      await tx
        .insert(memberMachine)
        .values(machineIds.map((machineId) => ({ organizationId: ctx.organizationId, memberAccessId: target.accessId, machineId })))
    }
    await tx.insert(auditLog).values({
      organizationId: ctx.organizationId,
      ...auditActor(ctx),
      action: "user.access_change",
      entityType: "member",
      entityId: input.memberId,
      before: snapshot(target),
      after: snapshot({ role: input.role, scope: input.scope, active: target.active, unitIds, machineIds }),
      at: deps.now,
    })
    return { status: "ok" }
  })
}

/** Desativa (ou reativa) o vínculo da pessoa com este cliente. */
export async function setMemberActive(deps: UsersDeps, ctx: TenantContext, raw: unknown): Promise<ManageResult> {
  assertPermission(ctx, "users.manage")
  const parsed = ActiveInput.safeParse(raw)
  if (!parsed.success) return NOT_FOUND
  const { memberId, active } = parsed.data
  const facts = await loginFacts(deps, ctx, memberId)
  if (facts === null || facts.platformPerson) return NOT_FOUND
  if (facts.userId === ctx.user.id) return SELF

  return withContext(deps.db, ctx, async (tx): Promise<ManageResult> => {
    const target = await lockTarget(tx, memberId)
    if (target === null || target.userId !== facts.userId) return NOT_FOUND
    if (target.active === active) return { status: "ok" }
    if (!active && target.role === "client_admin" && !(await anotherActiveAdmin(tx, target.accessId, facts.usableAdmins))) return LAST_ADMIN
    if (active && (await seatsFull(tx, ctx.organizationId))) {
      return { status: "error", code: "limit", message: "O contrato atingiu o número de usuários. Fale com a Engemase para ampliar." }
    }
    await tx.update(memberAccess).set({ active, updatedAt: deps.now }).where(eq(memberAccess.id, target.accessId))
    await tx.insert(auditLog).values({
      organizationId: ctx.organizationId,
      ...auditActor(ctx),
      action: active ? "user.enable" : "user.disable",
      entityType: "member",
      entityId: memberId,
      before: { active: target.active },
      after: { active },
      at: deps.now,
    })
    return { status: "ok" }
  })
}

/** O contrato tem limite de usuários e ele já foi atingido pelos vínculos ativos? */
export async function seatsFull(tx: GatewayTx, organizationId: string): Promise<boolean> {
  await lockSeats(tx, organizationId)
  const [acct] = await tx.select({ limits: clientAccount.limits }).from(clientAccount).limit(1)
  const maxUsers = acct?.limits.users
  if (typeof maxUsers !== "number") return false
  const [row] = await tx.select({ n: count() }).from(memberAccess).where(eq(memberAccess.active, true))
  return Number(row?.n ?? 0) >= maxUsers
}

/**
 * O admin pede para a pessoa o mesmo e-mail do "Esqueci minha senha" (link de 30 min; a senha atual vale até
 * ela definir outra). Só para vínculo ATIVO deste cliente (sob a RLS), conta não bloqueada, fora da equipe
 * Engemase e que já criou a senha (quem não criou usa "Reenviar e-mail de acesso"). `reset` é o pedido de
 * redefinição com os limites do login; quem chama dá a ele uma chave própria do admin (não o IP do escritório).
 * Auditado, inclusive quando o limite barra o pedido.
 */
export async function requestMemberPasswordReset(
  deps: UsersDeps & { readonly reset: (email: string) => Promise<RequestResetResult> },
  ctx: TenantContext,
  memberId: string,
): Promise<ManageResult> {
  assertPermission(ctx, "users.manage")
  if (!z.uuid().safeParse(memberId).success) return NOT_FOUND
  const target = await withContext(deps.db, ctx, async (tx) => {
    const [row] = await tx
      .select({ userId: member.userId, active: memberAccess.active })
      .from(member)
      .innerJoin(memberAccess, eq(memberAccess.memberId, member.id))
      .where(eq(member.id, memberId))
      .limit(1)
    return row ?? null
  })
  if (target === null || !target.active) return NOT_FOUND
  const [person] = await deps.authDb
    .select({ email: user.email, banned: user.banned, role: user.role })
    .from(user)
    .where(eq(user.id, target.userId))
    .limit(1)
  if (person === undefined || person.banned || (person.role != null && (PLATFORM_ROLES as readonly string[]).includes(person.role))) return NOT_FOUND
  const [credential] = await deps.authDb
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, target.userId), eq(account.providerId, "credential"), isNotNull(account.password)))
    .limit(1)
  if (credential === undefined) {
    return {
      status: "error",
      code: "no_password",
      message: "Esta pessoa ainda não criou a senha. Use \"Reenviar e-mail de acesso\".",
    }
  }
  const result = await deps.reset(person.email)
  await withContext(deps.db, ctx, (tx) =>
    tx.insert(auditLog).values({
      organizationId: ctx.organizationId,
      ...auditActor(ctx),
      action: "user.password_reset_requested",
      entityType: "member",
      entityId: memberId,
      after: { result: result.status },
      at: deps.now,
    }),
  )
  if (result.status === "throttled") return { status: "error", code: "throttled", message: "Muitos pedidos de redefinição. Tente de novo mais tarde." }
  return { status: "ok" }
}
