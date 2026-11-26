/**
 * "Adicionar membro" da equipe Engemase (console, só o super admin; docs/15, seção 3).
 *
 * - A pessoa é achada pelo E-MAIL DIGITADO, no servidor (nunca por id vindo do navegador). E-mail de
 *   alguém que já é usuário de cliente é recusado: misturar equipe e cliente na mesma conta abriria o
 *   cliente inteiro para quem era só supervisor, por exemplo.
 * - E-mail só do domínio da Engemase (o mesmo de quem convida).
 * - Conta sem senha no banco do login (`auth_service`), com o papel de plataforma; vínculo na organização
 *   interna "Engemase Lab" (único cliente de que a equipe é membro), token "definir senha" e auditoria
 *   numa transação da Lab (`app_user`). Uma conta criada sem o resto (falha no meio) não dá acesso a
 *   cliente nenhum (o técnico precisa de atribuição/concessão) e é reaproveitada na nova tentativa.
 * - Técnico com primeira atribuição: `platform_assignment` no cliente escolhido (cliente inteiro, com
 *   validade), com auditoria visível ao cliente.
 * - O link "definir senha" volta para a tela (o super admin repassa por um canal seguro) e, se houver
 *   provedor de e-mail, também vai por e-mail. O anterior, se não usado, deixa de valer.
 */
import {
  account,
  accountToken,
  auditLog,
  member,
  memberAccess,
  newAccountToken,
  organization,
  PLATFORM_ROLES,
  type PlatformRole,
  platformAssignment,
  SET_PASSWORD_TOKEN_TTL_MS,
  setPasswordUrl,
  user,
  withTenant,
} from "@engemase/db"
import { and, eq, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import type { ThrottleDb } from "@/lib/server/auth/throttle"
import { type EmailSender, sendSafely } from "@/lib/server/email"
import { setPasswordEmail } from "@/lib/server/email/templates"
import type { GatewayDb } from "@/lib/server/gateway/types"

/** Organização interna da Engemase (seed de plataforma). */
export const ENGEMASE_LAB_SLUG = "engemase-lab"

/** Validades aceitas para a primeira atribuição (dias). */
export const ASSIGNMENT_DAYS = [30, 60, 90, 180] as const

export const AddTeamMemberInput = z
  .object({
    name: z.string().trim().min(3, "Informe o nome completo.").max(120, "Nome muito longo."),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email("Informe um e-mail válido.")),
    role: z.enum(PLATFORM_ROLES, "Papel inválido."),
    /** Primeira atribuição (só técnico): cliente e validade. */
    clientId: z.uuid().nullable().default(null),
    days: z.coerce
      .number()
      .refine((d) => (ASSIGNMENT_DAYS as readonly number[]).includes(d), "Validade inválida.")
      .default(90),
  })
  .superRefine((v, issue) => {
    if (v.role !== "technician" && v.clientId !== null) {
      issue.addIssue({ code: "custom", path: ["clientId"], message: "Só o técnico recebe atribuição." })
    }
  })
export type AddTeamMemberInput = z.input<typeof AddTeamMemberInput>

export interface AddTeamMemberDeps {
  /** Banco do app (`app_user`, RLS). */
  readonly db: GatewayDb
  /** Banco do login (`auth_service`). */
  readonly authDb: ThrottleDb
  readonly now: Date
  /** Endereço canônico (`BETTER_AUTH_URL`), base do link. */
  readonly baseURL: string
  readonly sendEmail: EmailSender
}

/** Quem convida (super admin, sessão do servidor). */
export interface TeamActor {
  readonly id: string
  readonly name: string
  readonly email: string
}

export type AddTeamMemberResult =
  | {
      readonly status: "ok"
      readonly userId: string
      readonly existingAccount: boolean
      /** Link "definir senha" (uso único). `null`: a pessoa já tem senha. */
      readonly link: string | null
      readonly expiresAt: Date | null
      readonly emailSent: boolean
      readonly assignedClient: string | null
    }
  | { readonly status: "error"; readonly message: string; readonly field?: "name" | "email" | "role" | "clientId" | "days" }

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? ""
}

export async function addTeamMember(deps: AddTeamMemberDeps, actor: TeamActor, input: unknown): Promise<AddTeamMemberResult> {
  const parsed = AddTeamMemberInput.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path[0]
    return {
      status: "error",
      message: issue?.message ?? "Confira os dados.",
      ...(field === "name" || field === "email" || field === "role" || field === "clientId" || field === "days" ? { field } : {}),
    }
  }
  const d = parsed.data
  const domain = domainOf(actor.email)
  if (domain === "" || domainOf(d.email) !== domain) {
    return { status: "error", field: "email", message: `Use o e-mail corporativo (@${domain || "engemase.com.br"}).` }
  }
  const { now } = deps

  // Organização interna (a equipe só é membro dela) e cliente da primeira atribuição.
  const [lab] = await deps.authDb.select({ id: organization.id, name: organization.name }).from(organization).where(eq(organization.slug, ENGEMASE_LAB_SLUG)).limit(1)
  if (lab === undefined) return { status: "error", message: "A organização interna Engemase Lab não existe. Rode o seed de plataforma." }
  let client: { id: string; name: string } | undefined
  if (d.clientId !== null) {
    ;[client] = await deps.authDb.select({ id: organization.id, name: organization.name }).from(organization).where(eq(organization.id, d.clientId)).limit(1)
    if (client === undefined || client.id === lab.id) return { status: "error", field: "clientId", message: "Cliente não encontrado." }
  }

  // A pessoa pelo e-mail digitado.
  const [found] = await deps.authDb
    .select({ id: user.id, name: user.name, role: user.role, banned: user.banned })
    .from(user)
    .where(sql`lower(${user.email}) = ${d.email}`)
    .limit(1)
  if (found !== undefined) {
    if (found.role !== null && (PLATFORM_ROLES as readonly string[]).includes(found.role)) {
      return { status: "error", field: "email", message: "Esta pessoa já faz parte da equipe Engemase." }
    }
    if (found.banned) return { status: "error", field: "email", message: "Esta conta está bloqueada. Fale com a direção técnica." }
    const [otherMembership] = await deps.authDb
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, found.id), sql`${member.organizationId} <> ${lab.id}`))
      .limit(1)
    if (otherMembership !== undefined) {
      return { status: "error", field: "email", message: "Este e-mail já é usado por um usuário de cliente. Use outro e-mail para a equipe." }
    }
  }

  // Conta (sem senha) com o papel de plataforma.
  let userId = found?.id
  if (userId === undefined) {
    const [created] = await deps.authDb
      .insert(user)
      .values({ name: d.name, email: d.email, role: d.role, emailVerified: false, createdAt: now, updatedAt: now })
      .returning({ id: user.id })
    if (created === undefined) throw new Error("insert de user sem retorno")
    userId = created.id
  } else {
    await deps.authDb.update(user).set({ role: d.role, updatedAt: now }).where(eq(user.id, userId))
  }
  const personId = userId
  const [credential] = await deps.authDb
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, personId), eq(account.providerId, "credential")))
    .limit(1)

  const actorLabel = `${actor.name} (super admin Engemase)`
  const fresh = credential === undefined ? newAccountToken() : null
  const expiresAt = fresh === null ? null : new Date(now.getTime() + SET_PASSWORD_TOKEN_TTL_MS)

  await withTenant(deps.db, lab.id, async (tx) => {
    await tx.insert(member).values({ organizationId: lab.id, userId: personId }).onConflictDoNothing()
    const [m] = await tx.select({ id: member.id }).from(member).where(and(eq(member.organizationId, lab.id), eq(member.userId, personId)))
    if (m === undefined) throw new Error("vínculo com a Engemase Lab não gravado")
    // Na Lab (bancada interna): super admin administra; técnico tem leitura técnica.
    await tx
      .insert(memberAccess)
      .values({ organizationId: lab.id, memberId: m.id, role: d.role === "super_admin" ? "client_admin" : "engineer", scope: "all", createdBy: actor.id })
      .onConflictDoNothing()
    if (fresh !== null && expiresAt !== null) {
      await tx
        .update(accountToken)
        .set({ usedAt: now })
        .where(
          and(
            eq(accountToken.organizationId, lab.id),
            eq(accountToken.userId, personId),
            eq(accountToken.purpose, "set_password"),
            isNull(accountToken.usedAt),
          ),
        )
      await tx.insert(accountToken).values({
        organizationId: lab.id,
        purpose: "set_password",
        tokenHash: fresh.hash,
        userId: personId,
        expiresAt,
        createdBy: actor.id,
        createdAt: now,
      })
    }
    await tx.insert(auditLog).values({
      organizationId: lab.id,
      actorType: "engemase",
      actorId: actor.id,
      actorLabel,
      action: "platform.user_create",
      entityType: "user",
      entityId: personId,
      after: { role: d.role, existing_account: found !== undefined, set_password_link: fresh !== null },
      at: now,
    })
  })

  if (client !== undefined) {
    const target = client
    await withTenant(deps.db, target.id, async (tx) => {
      const [a] = await tx
        .insert(platformAssignment)
        .values({
          organizationId: target.id,
          userId: personId,
          reason: "Implantação: gateways, máquinas e tags",
          validFrom: now,
          validUntil: new Date(now.getTime() + d.days * 86_400_000),
          createdBy: actor.id,
          createdAt: now,
        })
        .returning({ id: platformAssignment.id })
      await tx.insert(auditLog).values({
        organizationId: target.id,
        actorType: "engemase",
        actorId: actor.id,
        actorLabel,
        action: "platform.assignment_create",
        entityType: "platform_assignment",
        entityId: a?.id ?? null,
        after: { technician: d.name, days: d.days },
        at: now,
      })
    })
  }

  const link = fresh === null ? null : setPasswordUrl(deps.baseURL, fresh.token)
  let emailSent = false
  if (link !== null) {
    const result = await sendSafely(
      deps.sendEmail,
      setPasswordEmail({ to: d.email, name: d.name, clientName: "equipe Engemase", invitedBy: actor.name, url: link, ttlMs: SET_PASSWORD_TOKEN_TTL_MS }),
      "convite da equipe Engemase",
    )
    emailSent = result.status === "sent"
  }

  return {
    status: "ok",
    userId: personId,
    existingAccount: found !== undefined,
    link,
    expiresAt,
    emailSent,
    assignedClient: client?.name ?? null,
  }
}

export type { PlatformRole }
