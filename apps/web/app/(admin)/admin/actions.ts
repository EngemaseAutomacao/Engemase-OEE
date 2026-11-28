"use server"

/**
 * Server Actions do console Engemase (W8). "Novo cliente": cria o cliente (organization +
 * client_account pela função da plataforma, 0018), a primeira unidade e o primeiro admin (pessoa
 * achada pelo e-mail NO SERVIDOR, nunca por id vindo do navegador; sem conta, fica "aguardando
 * definir senha"). Só o super admin da Engemase, com 2FA (D14), conferidos de novo aqui.
 */
import { auditLog, member, memberAccess, ORG_SLUG_PATTERN, PLATFORM_ROLES, unit, user, withTenant } from "@engemase/db"
import { eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { RESERVED_SLUGS, isValidCnpj, onlyDigits } from "@/components/admin/labels"
import { atorDaEquipe, equipeNaAcao, type Resultado } from "@/lib/data/admin/acesso"
import { ehEmailDaEngemase } from "@/lib/server/access/engemase-email"
import type { MetadadosCliente } from "@/lib/data/admin/snapshot"
import { getAuthDb } from "@/lib/server/db"
import { authSettings } from "@/lib/server/auth/env"
import { getEmailSender } from "@/lib/server/email"
import { addTeamMember } from "@/lib/server/team/add-member"
import { queryRows } from "@/lib/server/gateway/types"

const SEM_ACESSO: Resultado<never> = { ok: false, mensagem: "Só o super admin da Engemase cria clientes. Entre de novo." }

const Limite = z.coerce.number().int().min(0).max(100_000)

const NovoClienteInput = z.object({
  legalName: z.string().trim().min(3, "Informe a razão social.").max(200),
  tradeName: z.string().trim().min(2, "Informe o nome fantasia.").max(120),
  cnpj: z.string().refine((v) => isValidCnpj(onlyDigits(v)), "CNPJ inválido."),
  city: z.string().trim().min(1, "Informe a cidade.").max(120),
  uf: z.string().trim().length(2, "Selecione a UF."),
  slug: z
    .string()
    .regex(new RegExp(ORG_SLUG_PATTERN), "Identificador inválido.")
    .min(3, "Use pelo menos 3 caracteres.")
    .refine((s) => !RESERVED_SLUGS.includes(s), "Nome reservado da plataforma."),
  plan: z.enum(["starter", "pro", "enterprise"]),
  limits: z.object({ machines: Limite.refine((n) => n >= 1, "Mínimo 1."), gateways: Limite, users: Limite, retentionMonths: Limite }),
  unitName: z.string().trim().min(2, "Informe o nome da unidade.").max(120),
  timezone: z.string().min(3).max(64),
  adminName: z.string().trim().min(3, "Informe nome e sobrenome.").max(120),
  adminEmail: z.email("E-mail inválido.").max(254),
  adminPhone: z.string().trim().max(40).default(""),
})

export interface ClienteCriado {
  readonly id: string
  readonly slug: string
  /** O admin já tinha conta (entra com a senha dele) ou ficou aguardando definir senha. */
  readonly adminExistente: boolean
}

export async function criarClienteAction(input: unknown): Promise<Resultado<ClienteCriado>> {
  const parsed = NovoClienteInput.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, mensagem: issue?.message ?? "Confira os dados.", problemas: issue ? [{ campo: issue.path.join("."), mensagem: issue.message }] : [] }
  }
  const d = parsed.data
  const equipe = await equipeNaAcao(["super_admin"])
  const authDb = getAuthDb()
  if (equipe === null || authDb === null) return SEM_ACESSO
  const ator = atorDaEquipe(equipe)
  const email = d.adminEmail.trim().toLowerCase()

  // A pessoa é achada pelo e-mail no servidor (revisão W11). Equipe Engemase não vira membro de cliente.
  const [existente] = await authDb.select({ id: user.id, role: user.role }).from(user).where(eq(user.email, email)).limit(1)
  // Nem conta da equipe, nem e-mail dos domínios da Engemase: o admin do cliente aprova o acesso remoto que a
  // Engemase pede (docs/12), então ele tem de ser alguém do cliente.
  if ((existente?.role != null && (PLATFORM_ROLES as readonly string[]).includes(existente.role)) || ehEmailDaEngemase(email)) {
    return { ok: false, mensagem: "Este e-mail é da equipe Engemase: use o e-mail de alguém do cliente.", problemas: [{ campo: "adminEmail", mensagem: "E-mail da equipe Engemase." }] }
  }

  const metadados: MetadadosCliente = {
    legalName: d.legalName,
    cnpj: onlyDigits(d.cnpj),
    city: d.city,
    state: d.uf.toUpperCase(),
    contactName: d.adminName,
    contactEmail: email,
    contactPhone: d.adminPhone || undefined,
  }

  let organizationId: string
  try {
    const rows = await equipe.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`)
      return queryRows<{ id: string }>(
        tx,
        sql`SELECT app.platform_create_client(${d.slug}, ${d.tradeName}, ${JSON.stringify(metadados)}, ${d.plan}, ${JSON.stringify(d.limits)}::jsonb) AS id`,
      )
    })
    const id = rows[0]?.id
    if (id === undefined) throw new Error("platform_create_client sem retorno")
    organizationId = id
  } catch (error) {
    const code = (error as { code?: unknown; cause?: { code?: unknown } })?.cause?.code ?? (error as { code?: unknown })?.code
    if (code === "23505") return { ok: false, mensagem: "Este identificador já foi usado (identificadores nunca são reaproveitados).", problemas: [{ campo: "slug", mensagem: "Já usado." }] }
    console.error("[console] falha ao criar cliente", error)
    return { ok: false, mensagem: "Não foi possível criar o cliente. Tente de novo em instantes." }
  }

  try {
    // Conta da pessoa (identidade, papel auth_service): sem senha até o fluxo "definir senha".
    let userId = existente?.id
    if (userId === undefined) {
      const [novo] = await authDb.insert(user).values({ name: d.adminName, email, emailVerified: false }).returning({ id: user.id })
      if (novo === undefined) throw new Error("insert de user sem retorno")
      userId = novo.id
    }
    const pessoa = userId
    await withTenant(equipe.db, organizationId, async (tx) => {
      const [u] = await tx.insert(unit).values({ organizationId, name: d.unitName, timezone: d.timezone }).returning({ id: unit.id })
      const [m] = await tx.insert(member).values({ organizationId, userId: pessoa }).returning({ id: member.id })
      if (u === undefined || m === undefined) throw new Error("insert sem retorno")
      await tx.insert(memberAccess).values({ organizationId, memberId: m.id, role: "client_admin", scope: "all", createdBy: equipe.session.user.id })
      const base = { organizationId, actorType: ator.type, actorId: ator.id ?? null, actorLabel: ator.label ?? null }
      await tx.insert(auditLog).values([
        { ...base, action: "client.create", entityType: "organization", entityId: organizationId, after: { slug: d.slug, plan: d.plan, limits: d.limits } },
        { ...base, action: "unit.create", entityType: "unit", entityId: u.id, unitId: u.id, after: { name: d.unitName, timezone: d.timezone } },
        { ...base, action: "member.create", entityType: "member", entityId: m.id, after: { role: "client_admin", scope: "all", existing_account: existente !== undefined } },
      ])
    })
  } catch (error) {
    console.error("[console] cliente criado, mas falhou a unidade/o admin", error)
    revalidatePath("/admin", "layout")
    return { ok: false, mensagem: "O cliente foi criado, mas a primeira unidade ou o admin não. Complete pelo detalhe do cliente." }
  }

  revalidatePath("/admin", "layout")
  return { ok: true, dados: { id: organizationId, slug: d.slug, adminExistente: existente !== undefined } }
}

export interface MembroAdicionado {
  /** Link "definir senha" para o super admin repassar; `null` se a pessoa já tinha senha. */
  readonly link: string | null
  readonly expiraEm: string | null
  readonly emailEnviado: boolean
  readonly contaExistente: boolean
  readonly clienteAtribuido: string | null
}

/**
 * "Adicionar membro" da equipe Engemase: só o super admin. A pessoa é achada pelo e-mail no servidor;
 * regras e gravação em `lib/server/team/add-member.ts`.
 */
export async function adicionarMembroEquipeAction(input: unknown): Promise<Resultado<MembroAdicionado>> {
  const equipe = await equipeNaAcao(["super_admin"])
  const authDb = getAuthDb()
  const settings = authSettings()
  if (equipe === null || authDb === null) return { ok: false, mensagem: "Só o super admin da Engemase adiciona membros. Entre de novo." }
  if (settings === null) return { ok: false, mensagem: "Login não configurado (BETTER_AUTH_URL): não dá para gerar o link." }
  try {
    const r = await addTeamMember(
      { db: equipe.db, authDb, now: new Date(), baseURL: settings.baseURL, sendEmail: getEmailSender() },
      { id: equipe.session.user.id, name: equipe.session.user.name, email: equipe.session.user.email },
      input,
    )
    if (r.status === "error") return { ok: false, mensagem: r.message, problemas: r.field ? [{ campo: r.field, mensagem: r.message }] : [] }
    revalidatePath("/admin", "layout")
    return {
      ok: true,
      dados: {
        link: r.link,
        expiraEm: r.expiresAt?.toISOString() ?? null,
        emailEnviado: r.emailSent,
        contaExistente: r.existingAccount,
        clienteAtribuido: r.assignedClient,
      },
    }
  } catch (error) {
    console.error("[console] falha ao adicionar membro da equipe", error)
    return { ok: false, mensagem: "Não foi possível adicionar o membro. Tente de novo em instantes." }
  }
}
