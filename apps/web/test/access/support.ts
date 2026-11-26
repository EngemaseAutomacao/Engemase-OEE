/**
 * Apoio aos testes de isolamento e de escopo (docs/15, seção 4, item 7): banco PGlite com as
 * migrações de @engemase/db e um seed com dois clientes completos (A e B), um cliente suspenso e as
 * pessoas de cada papel. O seed grava como dono (superusuário do PGlite, ignora a RLS); o código
 * testado roda com `withTenant` (`app_user` + `app.org_id`), sob RLS.
 */
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import * as s from "@engemase/db"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { SessionUser } from "@/lib/server/access/context"
import type { GatewayDb } from "@/lib/server/gateway/types"

const require = createRequire(import.meta.url)
export const MIGRATIONS_FOLDER = join(dirname(require.resolve("@engemase/db")), "..", "migrations")

export interface TestDatabase {
  readonly client: PGlite
  readonly db: GatewayDb
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite()
  const db = drizzle({ client })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return { client, db: db as unknown as GatewayDb }
}

function first<T>(rows: readonly T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error("insert sem retorno")
  return row
}

export interface SeededPerson {
  readonly user: SessionUser
  readonly sessionId: string
}

export interface SeededClient {
  readonly organizationId: string
  readonly slug: string
  readonly unit1: string
  readonly unit2: string
  /** Máquinas: m1 e m2 na unidade 1, m3 na unidade 2, mDeleted excluída (unidade 1). */
  readonly m1: string
  readonly m2: string
  readonly m3: string
  readonly mDeleted: string
  readonly line1: string
  readonly line2: string
  /** Admin do cliente com 2FA ligado. */
  readonly admin: SeededPerson
  /** Admin do cliente SEM 2FA (D14 bloqueia). */
  readonly adminNo2fa: SeededPerson
  /** Supervisor com escopo `units` = unidade 1. */
  readonly supervisorUnit1: SeededPerson
  /** Operador com escopo `machines` = só m3. */
  readonly operatorM3: SeededPerson
  /** Visualizador com escopo `units` e nenhuma unidade listada (fail-closed). */
  readonly viewerEmptyUnits: SeededPerson
  /** Operador com escopo `machines` só com a máquina excluída (fail-closed). */
  readonly operatorDeletedOnly: SeededPerson
  /** Engenheiro com vínculo inativo. */
  readonly inactiveEngineer: SeededPerson
  /** Membro sem `member_access` (vínculo inativo). */
  readonly memberWithoutAccess: SeededPerson
  /** Visualizador do cliente inteiro. */
  readonly viewerAll: SeededPerson
}

let counter = 0

export async function createPerson(
  db: GatewayDb,
  label: string,
  opts: { readonly role?: string | null; readonly twoFactor?: boolean; readonly banned?: boolean } = {},
): Promise<SeededPerson> {
  counter += 1
  const email = `${label}-${counter}@exemplo.test`
  const row = first(
    await db
      .insert(s.user)
      .values({
        name: label,
        email,
        role: opts.role ?? null,
        twoFactorEnabled: opts.twoFactor ?? false,
        banned: opts.banned ?? false,
      })
      .returning(),
  )
  const session = first(
    await db
      .insert(s.session)
      .values({ userId: row.id, token: `tok-${counter}-${label}`, expiresAt: new Date(Date.now() + 3_600_000) })
      .returning(),
  )
  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      banned: row.banned,
      twoFactorEnabled: row.twoFactorEnabled,
    },
    sessionId: session.id,
  }
}

async function addMember(
  db: GatewayDb,
  organizationId: string,
  person: SeededPerson,
  access: {
    readonly role: s.ClientRole
    readonly scope: s.AccessScope
    readonly active?: boolean
    readonly unitIds?: readonly string[]
    readonly machineIds?: readonly string[]
  } | null,
): Promise<void> {
  const mem = first(await db.insert(s.member).values({ organizationId, userId: person.user.id }).returning())
  if (access === null) return
  const ma = first(
    await db
      .insert(s.memberAccess)
      .values({
        organizationId,
        memberId: mem.id,
        role: access.role,
        scope: access.scope,
        active: access.active ?? true,
      })
      .returning(),
  )
  for (const unitId of access.unitIds ?? []) {
    await db.insert(s.memberUnit).values({ organizationId, memberAccessId: ma.id, unitId })
  }
  for (const machineId of access.machineIds ?? []) {
    await db.insert(s.memberMachine).values({ organizationId, memberAccessId: ma.id, machineId })
  }
}

/** Um cliente com 2 unidades, 2 linhas, 4 máquinas (1 excluída) e uma pessoa de cada caso. */
export async function seedClient(db: GatewayDb, slug: string, status: s.ClientStatus = "active"): Promise<SeededClient> {
  const org = first(await db.insert(s.organization).values({ name: `Cliente ${slug}`, slug }).returning())
  const organizationId = org.id
  await db.insert(s.clientAccount).values({ organizationId, status, plan: "pro", limits: { machines: 10 } })

  const u1 = first(await db.insert(s.unit).values({ organizationId, name: "Planta 1" }).returning())
  const u2 = first(await db.insert(s.unit).values({ organizationId, name: "Planta 2" }).returning())
  const l1 = first(await db.insert(s.line).values({ organizationId, unitId: u1.id, name: "Linha A" }).returning())
  const l2 = first(await db.insert(s.line).values({ organizationId, unitId: u2.id, name: "Linha B" }).returning())
  const mk = async (unitId: string, lineId: string, name: string, deleted = false) =>
    first(
      await db
        .insert(s.machine)
        .values({
          organizationId,
          unitId,
          lineId,
          name,
          stateRules: { mode: "signals" },
          deletedAt: deleted ? new Date() : null,
        })
        .returning(),
    ).id
  const m1 = await mk(u1.id, l1.id, "Injetora 01")
  const m2 = await mk(u1.id, l1.id, "Injetora 02")
  const m3 = await mk(u2.id, l2.id, "Sopradora 03")
  const mDeleted = await mk(u1.id, l1.id, "Injetora antiga", true)

  const admin = await createPerson(db, `admin-${slug}`, { twoFactor: true })
  await addMember(db, organizationId, admin, { role: "client_admin", scope: "all" })
  const adminNo2fa = await createPerson(db, `admin-sem-2fa-${slug}`)
  await addMember(db, organizationId, adminNo2fa, { role: "client_admin", scope: "all" })
  const supervisorUnit1 = await createPerson(db, `supervisor-${slug}`)
  await addMember(db, organizationId, supervisorUnit1, { role: "supervisor", scope: "units", unitIds: [u1.id] })
  const operatorM3 = await createPerson(db, `operador-${slug}`)
  await addMember(db, organizationId, operatorM3, { role: "operator", scope: "machines", machineIds: [m3] })
  const viewerEmptyUnits = await createPerson(db, `visualizador-vazio-${slug}`)
  await addMember(db, organizationId, viewerEmptyUnits, { role: "viewer", scope: "units" })
  const operatorDeletedOnly = await createPerson(db, `operador-excluida-${slug}`)
  await addMember(db, organizationId, operatorDeletedOnly, { role: "operator", scope: "machines", machineIds: [mDeleted] })
  const inactiveEngineer = await createPerson(db, `engenheiro-inativo-${slug}`)
  await addMember(db, organizationId, inactiveEngineer, { role: "engineer", scope: "all", active: false })
  const memberWithoutAccess = await createPerson(db, `sem-escopo-${slug}`)
  await addMember(db, organizationId, memberWithoutAccess, null)
  const viewerAll = await createPerson(db, `visualizador-${slug}`)
  await addMember(db, organizationId, viewerAll, { role: "viewer", scope: "all" })

  return {
    organizationId,
    slug,
    unit1: u1.id,
    unit2: u2.id,
    m1,
    m2,
    m3,
    mDeleted,
    line1: l1.id,
    line2: l2.id,
    admin,
    adminNo2fa,
    supervisorUnit1,
    operatorM3,
    viewerEmptyUnits,
    operatorDeletedOnly,
    inactiveEngineer,
    memberWithoutAccess,
    viewerAll,
  }
}

const HOUR = 3_600_000

/** Concessão de suporte (D5: nasce ativa). `offsetH` desloca a janela em relação a `now`. */
export async function grantSupport(
  db: GatewayDb,
  organizationId: string,
  person: SeededPerson,
  now: Date,
  window: { readonly startH: number; readonly endH: number },
): Promise<string> {
  const row = first(
    await db
      .insert(s.supportAccessGrant)
      .values({
        organizationId,
        userId: person.user.id,
        reason: "Chamado de teste",
        ticket: "#1042",
        startsAt: new Date(now.getTime() + window.startH * HOUR),
        endsAt: new Date(now.getTime() + window.endH * HOUR),
      })
      .returning(),
  )
  return row.id
}

/** Atribuição de engenheiro de campo, opcionalmente restrita a unidades. */
export async function assignFieldEngineer(
  db: GatewayDb,
  organizationId: string,
  person: SeededPerson,
  now: Date,
  opts: { readonly unitIds?: readonly string[]; readonly validH?: number; readonly revoked?: boolean } = {},
): Promise<string> {
  const row = first(
    await db
      .insert(s.platformAssignment)
      .values({
        organizationId,
        userId: person.user.id,
        reason: "Comissionamento",
        validFrom: new Date(now.getTime() - HOUR),
        validUntil: new Date(now.getTime() + (opts.validH ?? 24) * HOUR),
        createdBy: person.user.id,
        revokedAt: opts.revoked === true ? now : null,
      })
      .returning(),
  )
  for (const unitId of opts.unitIds ?? []) {
    await db.insert(s.platformAssignmentUnit).values({ organizationId, assignmentId: row.id, unitId })
  }
  return row.id
}
