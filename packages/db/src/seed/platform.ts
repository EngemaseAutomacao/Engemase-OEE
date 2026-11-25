/**
 * Seed de PLATAFORMA (docs/15, seção 7, "Inicialização da plataforma"): a organização interna "Engemase Lab"
 * (bancada e testes da equipe; a única em que a equipe Engemase é membro, seção 3) e o primeiro super admin,
 * que recebe um link "definir senha" de uso único. Diferente do seed sintético, este roda também em
 * PRODUÇÃO, por isso é protegido assim:
 *
 * - liberação explícita: `ENGEMASE_SEED=plataforma`; em produção (`VERCEL_ENV`/`NODE_ENV` = production)
 *   também `ENGEMASE_SEED_PRODUCAO=confirmo` (`assertPlatformSeedAllowed`);
 * - conexão de dono (SUPERUSER ou BYPASSRLS), como o seed sintético (`assertOwnerConnection`);
 * - só ACRESCENTA: nada é apagado nem sobrescrito; rodar de novo não duplica (organização, unidade, área e
 *   vínculo com ids fixos e `ON CONFLICT DO NOTHING`);
 * - recusa promover a super admin uma pessoa que já existe sem esse papel (decisão humana, não de script);
 * - grava na auditoria (`platform.seed`, ator `system`) e nunca registra o token: o link sai uma vez, na tela
 *   de quem rodou o script.
 */
import { and, eq, isNull, sql } from "drizzle-orm"
import { newAccountToken } from "../account-token"
import * as s from "../schema/index"
import { assertOwnerConnection, ENGEMASE_LAB_SLUG, type SeedDatabase, SeedRefusedError, seedId } from "./synthetic"

export const PLATFORM_SEED_ENV_VALUE = "plataforma"
export const PLATFORM_SEED_PRODUCTION_FLAG = "ENGEMASE_SEED_PRODUCAO"
export const PLATFORM_SEED_PRODUCTION_VALUE = "confirmo"

/** Validade do link "definir senha" do primeiro super admin (curta: quem roda o script entrega na hora). */
export const PLATFORM_SEED_TOKEN_TTL_MS = 24 * 3_600_000

/** Máquinas da bancada da Engemase Lab (`limits.machines` é obrigatório, D1). */
export const ENGEMASE_LAB_MACHINES = 10

/** Libera o seed de plataforma pelo ambiente (ver o cabeçalho). */
export function assertPlatformSeedAllowed(env: Readonly<Record<string, string | undefined>>): void {
  if (env.ENGEMASE_SEED !== PLATFORM_SEED_ENV_VALUE) {
    throw new SeedRefusedError(`Seed de plataforma bloqueado: defina ENGEMASE_SEED=${PLATFORM_SEED_ENV_VALUE}.`)
  }
  const production = env.VERCEL_ENV === "production" || env.NODE_ENV === "production"
  if (production && env[PLATFORM_SEED_PRODUCTION_FLAG] !== PLATFORM_SEED_PRODUCTION_VALUE) {
    throw new SeedRefusedError(
      `Seed de plataforma em PRODUÇÃO: confirme com ${PLATFORM_SEED_PRODUCTION_FLAG}=${PLATFORM_SEED_PRODUCTION_VALUE}.`,
    )
  }
}

export interface SeedPlatformOptions {
  /** E-mail do primeiro super admin. */
  readonly adminEmail: string
  /** Nome do primeiro super admin. */
  readonly adminName: string
  readonly now?: Date
}

export interface SeedPlatformResult {
  readonly organizationId: string
  readonly organizationCreated: boolean
  readonly adminUserId: string
  readonly adminCreated: boolean
  /**
   * Token "definir senha" (só quando a pessoa ainda não tem senha). Vai no link `/definir-senha#t=...`;
   * nunca é gravado (o banco guarda o hash).
   */
  readonly setPasswordToken: string | null
  readonly tokenExpiresAt: Date | null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Grava a Engemase Lab e o primeiro super admin (idempotente; ver o cabeçalho). */
export async function seedPlatform(db: SeedDatabase, options: SeedPlatformOptions): Promise<SeedPlatformResult> {
  const email = options.adminEmail.trim().toLowerCase()
  const name = options.adminName.trim()
  if (!EMAIL.test(email) || email.length > 254) throw new SeedRefusedError("Seed de plataforma: e-mail do super admin inválido.")
  if (name === "" || name.length > 120) throw new SeedRefusedError("Seed de plataforma: informe o nome do super admin.")
  const now = options.now ?? new Date()

  await assertOwnerConnection(db, "Seed de plataforma")

  return db.transaction(async (tx) => {
    const k = (key: string) => seedId(`${ENGEMASE_LAB_SLUG}:${key}`)

    // Organização interna (id fixo; se já existir com outro id, vale a do slug).
    const inserted = await tx
      .insert(s.organization)
      .values({ id: k("organization"), name: "Engemase Lab", slug: ENGEMASE_LAB_SLUG })
      .onConflictDoNothing()
      .returning({ id: s.organization.id })
    const [org] = await tx.select({ id: s.organization.id }).from(s.organization).where(eq(s.organization.slug, ENGEMASE_LAB_SLUG))
    if (org === undefined) throw new Error("Engemase Lab não gravada")
    const organizationId = org.id
    await tx
      .insert(s.clientAccount)
      .values({ organizationId, status: "active", plan: "interno", limits: { machines: ENGEMASE_LAB_MACHINES } })
      .onConflictDoNothing()
    if (inserted.length > 0) {
      await tx.insert(s.unit).values({ id: k("unit"), organizationId, name: "Bancada Engemase" }).onConflictDoNothing()
      await tx.insert(s.area).values({ id: k("area"), organizationId, unitId: k("unit"), name: "Geral" }).onConflictDoNothing()
    }

    // Primeiro super admin.
    const [existing] = await tx
      .select({ id: s.user.id, role: s.user.role })
      .from(s.user)
      .where(sql`lower(${s.user.email}) = ${email}`)
      .limit(1)
    if (existing !== undefined && existing.role !== "super_admin") {
      throw new SeedRefusedError(
        "Seed de plataforma bloqueado: já existe uma pessoa com este e-mail sem o papel super_admin. Promover alguém é decisão da direção, feita à mão e registrada.",
      )
    }
    let adminUserId = existing?.id
    if (adminUserId === undefined) {
      const [created] = await tx
        .insert(s.user)
        .values({ name, email, role: "super_admin", emailVerified: false })
        .returning({ id: s.user.id })
      if (created === undefined) throw new Error("super admin não gravado")
      adminUserId = created.id
    }

    // Vínculo com a Engemase Lab (a equipe só é membro aqui; docs/15 seção 3).
    await tx.insert(s.member).values({ organizationId, userId: adminUserId }).onConflictDoNothing()
    const [mem] = await tx
      .select({ id: s.member.id })
      .from(s.member)
      .where(and(eq(s.member.organizationId, organizationId), eq(s.member.userId, adminUserId)))
    if (mem === undefined) throw new Error("vínculo não gravado")
    await tx
      .insert(s.memberAccess)
      .values({ organizationId, memberId: mem.id, role: "client_admin", scope: "all" })
      .onConflictDoNothing()

    // Link "definir senha" só para quem ainda não tem senha; o anterior (não usado) deixa de valer.
    const [credential] = await tx
      .select({ id: s.account.id })
      .from(s.account)
      .where(and(eq(s.account.userId, adminUserId), eq(s.account.providerId, "credential")))
      .limit(1)
    let setPasswordToken: string | null = null
    let tokenExpiresAt: Date | null = null
    if (credential === undefined) {
      await tx
        .update(s.accountToken)
        .set({ usedAt: now })
        .where(
          and(
            eq(s.accountToken.organizationId, organizationId),
            eq(s.accountToken.userId, adminUserId),
            eq(s.accountToken.purpose, "set_password"),
            isNull(s.accountToken.usedAt),
          ),
        )
      const fresh = newAccountToken()
      tokenExpiresAt = new Date(now.getTime() + PLATFORM_SEED_TOKEN_TTL_MS)
      await tx.insert(s.accountToken).values({
        organizationId,
        purpose: "set_password",
        tokenHash: fresh.hash,
        userId: adminUserId,
        expiresAt: tokenExpiresAt,
        createdAt: now,
      })
      setPasswordToken = fresh.token
    }

    await tx.insert(s.auditLog).values({
      organizationId,
      actorType: "system",
      actorLabel: "Seed de plataforma",
      action: "platform.seed",
      entityType: "user",
      entityId: adminUserId,
      after: {
        organization_created: inserted.length > 0,
        admin_created: existing === undefined,
        set_password_link: setPasswordToken !== null,
      },
      at: now,
    })

    return {
      organizationId,
      organizationCreated: inserted.length > 0,
      adminUserId,
      adminCreated: existing === undefined,
      setPasswordToken,
      tokenExpiresAt,
    }
  })
}
