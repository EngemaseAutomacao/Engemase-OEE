/**
 * Lista real da tela "Usuários" do cliente (D11, D12): quem tem vínculo com o cliente, com papel, escopo e
 * situação, mais o que a tela oferece no escopo (unidades e máquinas) e o limite do contrato.
 *
 * - Vínculo, papel, escopo, unidades e máquinas: banco do app, sob a RLS do cliente (`withContext`).
 * - Nome, e-mail, 2FA, senha criada, último uso e outros clientes: banco do login (`auth_service`), só das
 *   pessoas que a RLS mostrou neste cliente (nunca uma lista aberta de contas).
 *
 * Situação: `disabled` quando o vínculo está inativo (`member_access.active = false`) ou a conta foi bloqueada
 * pela Engemase (`user.banned`); `invited` quando ainda não criou a senha; senão `active`.
 * Último uso: a sessão mais recente da pessoa (sessões vencidas são apagadas pela limpeza diária, então
 * "nunca" também cobre quem não entra há mais de 30 dias).
 */
import { account, clientAccount, line, machine, member, memberAccess, memberMachine, memberUnit, organization, session, unit, user } from "@engemase/db"
import { and, eq, inArray, isNotNull, isNull, max, ne, sql } from "drizzle-orm"
import type { TenantContext } from "@/lib/server/access/context"
import { withContext } from "@/lib/server/access/load"
import type { ThrottleDb } from "@/lib/server/auth/throttle"
import type { GatewayDb } from "@/lib/server/gateway/types"
import type { ClientRole, MemberScope, UserStatus } from "@/lib/mock/types"

export interface ClientUser {
  /** Id do vínculo (`member.id`): é o que as ações da tela recebem. */
  readonly memberId: string
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly role: ClientRole
  readonly scope: MemberScope
  readonly status: UserStatus
  readonly twoFactor: boolean
  readonly lastSeenAt: Date | null
  /** Em quantos outros clientes a pessoa tem vínculo (só o número). */
  readonly otherClients: number
  /** É quem está vendo a tela (não altera o próprio acesso por aqui). */
  readonly isSelf: boolean
}

export interface ClientUsersData {
  readonly clientName: string
  /** `limits.users` do contrato, se existir. */
  readonly seatLimit: number | null
  readonly units: readonly { readonly id: string; readonly name: string }[]
  readonly machines: readonly { readonly id: string; readonly name: string; readonly code: string; readonly unitId: string; readonly lineName: string }[]
  readonly users: readonly ClientUser[]
}

function toScope(scope: string, unitIds: readonly string[], machineIds: readonly string[]): MemberScope {
  if (scope === "units") return { kind: "units", unitIds: [...unitIds] }
  if (scope === "machines") return { kind: "machines", machineIds: [...machineIds] }
  return { kind: "all" }
}

export async function listClientUsers(db: GatewayDb, authDb: ThrottleDb, ctx: TenantContext): Promise<ClientUsersData> {
  const app = await withContext(db, ctx, async (tx) => {
    const [org] = await tx.select({ name: organization.name }).from(organization).limit(1)
    const [acct] = await tx.select({ limits: clientAccount.limits }).from(clientAccount).limit(1)
    const units = await tx.select({ id: unit.id, name: unit.name }).from(unit).where(isNull(unit.deletedAt)).orderBy(unit.name)
    const machines = await tx
      .select({ id: machine.id, name: machine.name, code: machine.code, unitId: machine.unitId, lineName: line.name })
      .from(machine)
      .leftJoin(line, eq(line.id, machine.lineId))
      .where(isNull(machine.deletedAt))
      .orderBy(machine.name)
    const members = await tx
      .select({
        memberId: member.id,
        userId: member.userId,
        accessId: memberAccess.id,
        role: memberAccess.role,
        scope: memberAccess.scope,
        active: memberAccess.active,
      })
      .from(member)
      .innerJoin(memberAccess, eq(memberAccess.memberId, member.id))
    const accessIds = members.map((m) => m.accessId)
    const unitLinks =
      accessIds.length === 0
        ? []
        : await tx.select({ accessId: memberUnit.memberAccessId, id: memberUnit.unitId }).from(memberUnit).where(inArray(memberUnit.memberAccessId, accessIds))
    const machineLinks =
      accessIds.length === 0
        ? []
        : await tx
            .select({ accessId: memberMachine.memberAccessId, id: memberMachine.machineId })
            .from(memberMachine)
            .where(inArray(memberMachine.memberAccessId, accessIds))
    return { clientName: org?.name ?? ctx.slug, seatLimit: acct?.limits.users ?? null, units, machines, members, unitLinks, machineLinks }
  })

  const userIds = [...new Set(app.members.map((m) => m.userId))]
  const people = new Map<string, { name: string; email: string; banned: boolean; twoFactor: boolean }>()
  const withPassword = new Set<string>()
  const lastSeen = new Map<string, Date>()
  const others = new Map<string, number>()
  if (userIds.length > 0) {
    for (const p of await authDb
      .select({ id: user.id, name: user.name, email: user.email, banned: user.banned, twoFactor: user.twoFactorEnabled })
      .from(user)
      .where(inArray(user.id, userIds))) {
      people.set(p.id, { name: p.name, email: p.email, banned: p.banned, twoFactor: p.twoFactor })
    }
    for (const a of await authDb
      .select({ userId: account.userId })
      .from(account)
      .where(and(inArray(account.userId, userIds), eq(account.providerId, "credential"), isNotNull(account.password)))) {
      withPassword.add(a.userId)
    }
    for (const s of await authDb
      .select({ userId: session.userId, at: max(session.updatedAt) })
      .from(session)
      .where(inArray(session.userId, userIds))
      .groupBy(session.userId)) {
      if (s.at !== null) lastSeen.set(s.userId, s.at)
    }
    for (const o of await authDb
      .select({ userId: member.userId, n: sql<number>`count(*)::int` })
      .from(member)
      .where(and(inArray(member.userId, userIds), ne(member.organizationId, ctx.organizationId)))
      .groupBy(member.userId)) {
      others.set(o.userId, Number(o.n))
    }
  }

  const users: ClientUser[] = []
  for (const m of app.members) {
    const p = people.get(m.userId)
    if (p === undefined) continue
    const status: UserStatus = !m.active || p.banned ? "disabled" : withPassword.has(m.userId) ? "active" : "invited"
    users.push({
      memberId: m.memberId,
      userId: m.userId,
      name: p.name,
      email: p.email,
      role: m.role,
      scope: toScope(
        m.scope,
        app.unitLinks.filter((l) => l.accessId === m.accessId).map((l) => l.id),
        app.machineLinks.filter((l) => l.accessId === m.accessId).map((l) => l.id),
      ),
      status,
      twoFactor: p.twoFactor,
      lastSeenAt: lastSeen.get(m.userId) ?? null,
      otherClients: others.get(m.userId) ?? 0,
      isSelf: m.userId === ctx.user.id,
    })
  }

  return {
    clientName: app.clientName,
    seatLimit: typeof app.seatLimit === "number" ? app.seatLimit : null,
    units: app.units,
    machines: app.machines.map((m) => ({ ...m, code: m.code ?? "", lineName: m.lineName ?? "—" })),
    users,
  }
}
