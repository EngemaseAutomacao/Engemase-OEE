/**
 * Entrada de usuário no cliente (docs/15, seção 5, "um único fluxo"; D11, D12) e reenvio do convite.
 *
 * Regras de segurança:
 * - a pessoa é achada pelo E-MAIL DIGITADO, no servidor; nunca se aceita `user_id` do navegador (achado da
 *   revisão W11, §3.2: o `app_user` consegue gravar `member` com qualquer `user_id`);
 * - só quem tem `users.manage` no cliente da URL (admin do cliente; super admin) convida;
 * - unidades e máquinas do escopo são conferidas sob a RLS do cliente: id de outro cliente (ou excluído)
 *   não existe aqui e o convite é recusado (fail-closed, D11);
 * - pessoa da equipe Engemase não vira membro de cliente (docs/15, seção 3);
 * - `limits.users` do contrato, se existir, é respeitado.
 *
 * Gravação: a conta (sem senha) nasce no banco do login (`auth_service`), se ainda não existir; vínculo,
 * papel, escopo, token "definir senha" e auditoria vão juntos numa transação do cliente (`app_user`). Uma
 * conta criada sem vínculo (falha no meio) não dá acesso a nada e é reaproveitada na nova tentativa.
 * O e-mail sai depois da gravação; falha no envio não desfaz o convite (reenviar pela tela).
 */
import {
  ACCESS_SCOPES,
  accountToken,
  account,
  auditLog,
  CLIENT_ROLES,
  clientAccount,
  machine,
  member,
  memberAccess,
  memberMachine,
  memberUnit,
  newAccountToken,
  organization,
  PLATFORM_ROLES,
  SET_PASSWORD_TOKEN_TTL_MS,
  setPasswordUrl,
  unit,
  user,
} from "@engemase/db"
import { ehEmailDaEngemase } from "@/lib/server/access/engemase-email"
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { assertPermission, type TenantContext } from "@/lib/server/access/context"
import { withContext } from "@/lib/server/access/load"
import type { ThrottleDb } from "@/lib/server/auth/throttle"
import { type EmailSender, sendSafely } from "@/lib/server/email"
import { accessGrantedEmail, setPasswordEmail } from "@/lib/server/email/templates"
import type { GatewayDb, GatewayTx } from "@/lib/server/gateway/types"
import { actorDisplayName, auditActor } from "./audit"
import { lockSeats } from "./seats"

export interface UsersDeps {
  /** Banco do app (`app_user`, RLS). */
  readonly db: GatewayDb
  /** Banco do login (`auth_service`). */
  readonly authDb: ThrottleDb
  readonly now: Date
  /** Endereço canônico (`BETTER_AUTH_URL`), base dos links. */
  readonly baseURL: string
  readonly sendEmail: EmailSender
}

export const InviteInput = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email("E-mail inválido. Confira se digitou corretamente.")),
    name: z.string().trim().min(2, "Informe o nome da pessoa.").max(120, "Nome muito longo."),
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
export type InviteInput = z.input<typeof InviteInput>

export type InviteResult =
  | {
      readonly status: "ok"
      readonly memberId: string
      /** `set_password`: conta nova (ou sem senha) recebeu o link; `access_granted`: já tinha senha. */
      readonly kind: "set_password" | "access_granted"
      readonly emailSent: boolean
    }
  | { readonly status: "error"; readonly code: "invalid" | "conflict" | "refused" | "limit"; readonly message: string }

const GENERIC_REFUSAL = "Não foi possível convidar esta pessoa por aqui. Fale com o suporte Engemase."

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))]
}

/** Confere, sob a RLS do cliente, que todas as unidades/máquinas existem (e não foram excluídas). */
export async function scopeTargetsExist(tx: GatewayTx, unitIds: readonly string[], machineIds: readonly string[]): Promise<boolean> {
  if (unitIds.length > 0) {
    const [row] = await tx.select({ n: count() }).from(unit).where(and(inArray(unit.id, [...unitIds]), isNull(unit.deletedAt)))
    if (Number(row?.n ?? 0) !== unitIds.length) return false
  }
  if (machineIds.length > 0) {
    const [row] = await tx
      .select({ n: count() })
      .from(machine)
      .where(and(inArray(machine.id, [...machineIds]), isNull(machine.deletedAt)))
    if (Number(row?.n ?? 0) !== machineIds.length) return false
  }
  return true
}

/** Novo token "definir senha" (o anterior, não usado, deixa de valer). Devolve o valor para o link. */
async function issueSetPasswordToken(tx: GatewayTx, ctx: TenantContext, userId: string, now: Date): Promise<{ token: string; expiresAt: Date }> {
  await tx
    .update(accountToken)
    .set({ usedAt: now })
    .where(and(eq(accountToken.userId, userId), eq(accountToken.purpose, "set_password"), isNull(accountToken.usedAt)))
  const fresh = newAccountToken()
  const expiresAt = new Date(now.getTime() + SET_PASSWORD_TOKEN_TTL_MS)
  await tx.insert(accountToken).values({
    organizationId: ctx.organizationId,
    purpose: "set_password",
    tokenHash: fresh.hash,
    userId,
    expiresAt,
    createdBy: ctx.user.id,
    createdAt: now,
  })
  return { token: fresh.token, expiresAt }
}

async function hasPassword(authDb: ThrottleDb, userId: string): Promise<boolean> {
  const [row] = await authDb
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential"), sql`${account.password} IS NOT NULL`))
    .limit(1)
  return row !== undefined
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  while (current instanceof Error || (typeof current === "object" && current !== null)) {
    if ((current as { code?: unknown }).code === "23505") return true
    current = (current as { cause?: unknown }).cause
    if (current === undefined) break
  }
  return false
}

/** Convida (ou dá acesso a) uma pessoa no cliente do contexto. */
export async function inviteMember(deps: UsersDeps, ctx: TenantContext, raw: unknown): Promise<InviteResult> {
  assertPermission(ctx, "users.manage")
  const parsed = InviteInput.safeParse(raw)
  if (!parsed.success) return { status: "error", code: "invalid", message: parsed.error.issues[0]?.message ?? "Confira os dados." }
  const input = parsed.data
  const unitIds = unique(input.unitIds)
  const machineIds = unique(input.machineIds)

  // 1. Escopo e limite, sob a RLS do cliente.
  const precheck = await withContext(deps.db, ctx, async (tx) => {
    if (!(await scopeTargetsExist(tx, unitIds, machineIds))) return "invalid_scope" as const
    // Vagas travadas (`lockSeats`): dois convites (ou convite e reativação) ao mesmo tempo não passam do limite.
    await lockSeats(tx, ctx.organizationId)
    const [acct] = await tx.select({ limits: clientAccount.limits }).from(clientAccount).limit(1)
    const maxUsers = acct?.limits.users
    if (typeof maxUsers === "number") {
      const [active] = await tx.select({ n: count() }).from(memberAccess).where(eq(memberAccess.active, true))
      if (Number(active?.n ?? 0) >= maxUsers) return "limit" as const
    }
    return "ok" as const
  })
  if (precheck === "invalid_scope") return { status: "error", code: "invalid", message: "Unidade ou máquina inválida. Atualize a página e escolha de novo." }
  if (precheck === "limit") {
    return { status: "error", code: "limit", message: "O contrato atingiu o número de usuários. Fale com a Engemase para ampliar." }
  }

  // 2. A pessoa, pelo e-mail, no banco do login (vê todas as contas).
  const [found] = await deps.authDb
    .select({ id: user.id, name: user.name, role: user.role, banned: user.banned })
    .from(user)
    .where(sql`lower(${user.email}) = ${input.email}`)
    .limit(1)
  if ((found !== undefined && found.role !== null && (PLATFORM_ROLES as readonly string[]).includes(found.role)) || ehEmailDaEngemase(input.email)) {
    return { status: "error", code: "refused", message: "Pessoas da equipe Engemase não entram como usuários do cliente." }
  }
  if (found?.banned === true) return { status: "error", code: "refused", message: GENERIC_REFUSAL }
  let userId = found?.id
  let personName = found?.name ?? input.name
  if (userId === undefined) {
    await deps.authDb.insert(user).values({ name: input.name, email: input.email, emailVerified: false }).onConflictDoNothing()
    const [created] = await deps.authDb
      .select({ id: user.id, name: user.name, role: user.role })
      .from(user)
      .where(sql`lower(${user.email}) = ${input.email}`)
      .limit(1)
    if (created === undefined || created.role !== null) return { status: "error", code: "refused", message: GENERIC_REFUSAL }
    userId = created.id
    personName = created.name
  }
  const personId: string = userId
  const needsPassword = !(await hasPassword(deps.authDb, personId))

  // 3. Vínculo + papel + escopo + token + auditoria, numa transação do cliente.
  const actor = auditActor(ctx)
  let written: { memberId: string; clientName: string; token: { token: string; expiresAt: Date } | null } | "conflict"
  try {
    written = await withContext(deps.db, ctx, async (tx) => {
      const [already] = await tx.select({ id: member.id }).from(member).where(eq(member.userId, personId)).limit(1)
      if (already !== undefined) return "conflict" as const
      const [mem] = await tx.insert(member).values({ organizationId: ctx.organizationId, userId: personId }).returning({ id: member.id })
      if (mem === undefined) throw new Error("vínculo não gravado")
      const [ma] = await tx
        .insert(memberAccess)
        .values({ organizationId: ctx.organizationId, memberId: mem.id, role: input.role, scope: input.scope, createdBy: ctx.user.id })
        .returning({ id: memberAccess.id })
      if (ma === undefined) throw new Error("papel não gravado")
      if (unitIds.length > 0) {
        await tx.insert(memberUnit).values(unitIds.map((unitId) => ({ organizationId: ctx.organizationId, memberAccessId: ma.id, unitId })))
      }
      if (machineIds.length > 0) {
        await tx
          .insert(memberMachine)
          .values(machineIds.map((machineId) => ({ organizationId: ctx.organizationId, memberAccessId: ma.id, machineId })))
      }
      const token = needsPassword ? await issueSetPasswordToken(tx, ctx, personId, deps.now) : null
      const [org] = await tx.select({ name: organization.name }).from(organization).limit(1)
      await tx.insert(auditLog).values({
        organizationId: ctx.organizationId,
        ...actor,
        action: "user.invite",
        entityType: "member",
        entityId: mem.id,
        after: {
          email: input.email,
          role: input.role,
          scope: input.scope,
          unit_ids: unitIds,
          machine_ids: machineIds,
          set_password_link: token !== null,
        },
        at: deps.now,
      })
      return { memberId: mem.id, clientName: org?.name ?? ctx.slug, token }
    })
  } catch (error) {
    // Dois convites da mesma pessoa ao mesmo tempo: o segundo bate na unicidade (cliente, pessoa).
    if (isUniqueViolation(error)) written = "conflict"
    else throw error
  }
  if (written === "conflict") return { status: "error", code: "conflict", message: "Esta pessoa já tem acesso a este cliente." }

  // 4. E-mail (depois de gravar; falha não desfaz).
  const invitedBy = actorDisplayName(ctx)
  const message =
    written.token !== null
      ? setPasswordEmail({
          to: input.email,
          name: personName,
          clientName: written.clientName,
          invitedBy,
          url: setPasswordUrl(deps.baseURL, written.token.token),
          ttlMs: SET_PASSWORD_TOKEN_TTL_MS,
        })
      : accessGrantedEmail({ to: input.email, name: personName, clientName: written.clientName, invitedBy, loginUrl: `${new URL(deps.baseURL).origin}/login` })
  const sent = await sendSafely(deps.sendEmail, message, "convite")
  return {
    status: "ok",
    memberId: written.memberId,
    kind: written.token !== null ? "set_password" : "access_granted",
    emailSent: sent.status !== "failed",
  }
}

export type ResendResult =
  | { readonly status: "ok"; readonly emailSent: boolean }
  | { readonly status: "error"; readonly code: "not_found" | "has_password"; readonly message: string }

/** Novo link "definir senha" para quem ainda não criou a senha (o anterior deixa de valer). */
export async function resendInvite(deps: UsersDeps, ctx: TenantContext, memberId: string): Promise<ResendResult> {
  assertPermission(ctx, "users.manage")
  const notFound = { status: "error", code: "not_found", message: "Usuário não encontrado neste cliente." } as const
  if (!z.uuid().safeParse(memberId).success) return notFound
  // O vínculo é lido sob a RLS: id de outro cliente não existe aqui.
  const target = await withContext(deps.db, ctx, async (tx) => {
    const [row] = await tx.select({ userId: member.userId }).from(member).where(eq(member.id, memberId)).limit(1)
    return row ?? null
  })
  if (target === null) return notFound
  const [person] = await deps.authDb
    .select({ email: user.email, name: user.name, role: user.role, banned: user.banned })
    .from(user)
    .where(eq(user.id, target.userId))
    .limit(1)
  if (person === undefined || person.banned || (person.role !== null && (PLATFORM_ROLES as readonly string[]).includes(person.role))) {
    return notFound
  }
  if (await hasPassword(deps.authDb, target.userId)) {
    return {
      status: "error",
      code: "has_password",
      message: "Esta pessoa já criou a senha. Se esqueceu, ela usa \"Esqueci minha senha\" no login.",
    }
  }
  const actor = auditActor(ctx)
  const written = await withContext(deps.db, ctx, async (tx) => {
    const token = await issueSetPasswordToken(tx, ctx, target.userId, deps.now)
    const [org] = await tx.select({ name: organization.name }).from(organization).limit(1)
    await tx.insert(auditLog).values({
      organizationId: ctx.organizationId,
      ...actor,
      action: "user.invite_resent",
      entityType: "member",
      entityId: memberId,
      at: deps.now,
    })
    return { token, clientName: org?.name ?? ctx.slug }
  })
  const sent = await sendSafely(
    deps.sendEmail,
    setPasswordEmail({
      to: person.email,
      name: person.name,
      clientName: written.clientName,
      invitedBy: actorDisplayName(ctx),
      url: setPasswordUrl(deps.baseURL, written.token.token),
      ttlMs: SET_PASSWORD_TOKEN_TTL_MS,
    }),
    "reenvio de convite",
  )
  return { status: "ok", emailSent: sent.status !== "failed" }
}
