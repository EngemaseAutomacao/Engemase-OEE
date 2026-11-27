/**
 * Dados da tela "Usuários" do cliente no sistema real (com banco). Sem banco, a página usa os dados
 * simulados (demonstração).
 *
 * - Quem vê: `config.read` (admin e engenheiro do cliente; equipe Engemase). Quem gerencia: `users.manage`
 *   (admin do cliente; super admin). Sem `config.read`, 404, como as outras telas de configuração.
 * - Pessoas do cliente: `lib/server/users/list.ts` (RLS do cliente + banco do login).
 * - "Acessos da Engemase" (D5: sempre liberado, sempre visível ao cliente): super admins ativos, concessões de
 *   suporte (últimos 30 dias) e atribuições de técnico deste cliente (`lib/server/team/read.ts`).
 */
import { user } from "@engemase/db"
import { and, eq, inArray } from "drizzle-orm"
import { notFound } from "next/navigation"
import type { ClientUserRow, EngemaseAccessRow } from "@/components/settings/types"
import { ago, date, dateTime, duration } from "@/lib/format"
import { PLATFORM_ROLE_LABEL } from "@/lib/roles"
import { hasPermission } from "@/lib/server/access/context"
import { requireTenant } from "@/lib/server/access/require-tenant"
import { getAuthDb } from "@/lib/server/db"
import { readTeamAccess } from "@/lib/server/team/read"
import { listClientUsers } from "@/lib/server/users/list"
import { bancoObrigatorio } from "../admin/acesso"

const DAY = 86_400_000

export async function dadosUsuarios(slug: string) {
  const ctx = await requireTenant(slug)
  if (!hasPermission(ctx, "config.read")) notFound()
  const db = bancoObrigatorio()
  const authDb = getAuthDb()
  if (authDb === null) throw new Error("AUTH_DATABASE_URL não configurado")
  const now = new Date()
  const nowIso = now.toISOString()

  const data = await listClientUsers(db, authDb, ctx)
  // 2FA e último acesso dos colegas só para quem gerencia os usuários; quem só lê vê papel, escopo e situação.
  const canManage = hasPermission(ctx, "users.manage")
  const users: ClientUserRow[] = data.users.map((u) => ({
    id: u.memberId,
    name: u.name,
    email: u.email,
    username: null,
    role: u.role,
    scope: u.scope,
    status: u.status,
    twoFactor: canManage && u.twoFactor,
    lastLogin: canManage ? ago(u.lastSeenAt?.toISOString() ?? null, nowIso) : "—",
    lastLoginAt: canManage ? (u.lastSeenAt?.toISOString() ?? null) : null,
    otherClients: 0,
    isSelf: u.isSelf,
  }))

  // Acessos da Engemase neste cliente.
  const team = await readTeamAccess(db, authDb, now, [ctx.organizationId])
  const unitName = new Map(data.units.map((u) => [u.id, u.name]))
  const supers = await authDb
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(and(eq(user.role, "super_admin"), eq(user.banned, false)))
  const staffIds = [...new Set([...team.grants.map((g) => g.userId), ...team.assignments.map((a) => a.userId)])]
  const staff = new Map<string, { name: string; email: string }>()
  if (staffIds.length > 0) {
    for (const p of await authDb.select({ id: user.id, name: user.name, email: user.email }).from(user).where(inArray(user.id, staffIds))) {
      staff.set(p.id, { name: p.name, email: p.email })
    }
  }
  const person = (id: string) => {
    const p = staff.get(id)
    return { person: p?.name ?? "—", email: p?.email ?? "" }
  }
  const remaining = (end: Date) => `restam ${duration((end.getTime() - now.getTime()) / 1000)}`

  const rows: EngemaseAccessRow[] = [
    ...supers.map(
      (p): EngemaseAccessRow => ({
        id: `ea_${p.id}`,
        person: p.name,
        email: p.email,
        kind: "super_admin",
        roleLabel: PLATFORM_ROLE_LABEL.super_admin,
        reason: "Administração da plataforma",
        ticket: null,
        units: "Todas as unidades",
        startLabel: "—",
        endLabel: null,
        status: "permanent",
        remaining: null,
      }),
    ),
    ...team.grants.map((g): EngemaseAccessRow => {
      const end = g.endedAt ?? g.endsAt
      const active = g.status === "active" && g.endedAt === null && g.endsAt > now
      return {
        id: `ea_${g.id}`,
        ...person(g.userId),
        kind: "support_grant",
        roleLabel: PLATFORM_ROLE_LABEL.technician,
        reason: g.reason,
        ticket: g.ticket,
        units: "Todas as unidades",
        startLabel: dateTime(g.startsAt.toISOString()),
        endLabel: dateTime(end.toISOString()),
        status: active ? "active" : "ended",
        remaining: active ? remaining(g.endsAt) : null,
      }
    }),
    ...team.assignments.map((a): EngemaseAccessRow => {
      const active = a.revokedAt === null && a.validUntil > now
      return {
        id: `ea_${a.id}`,
        ...person(a.userId),
        kind: "assignment",
        roleLabel: PLATFORM_ROLE_LABEL.technician,
        reason: a.reason,
        ticket: null,
        units: a.unitIds.length === 0 ? "Todas as unidades" : a.unitIds.map((id) => unitName.get(id) ?? "—").join(", "),
        startLabel: date(a.validFrom.toISOString()),
        endLabel: date((a.revokedAt ?? a.validUntil).toISOString()),
        status: active ? "active" : "ended",
        remaining: active ? `válida por mais ${Math.ceil((a.validUntil.getTime() - now.getTime()) / DAY)} dias` : null,
      }
    }),
  ]
  const rank = { permanent: 0, active: 1, ended: 2 } as const
  const engemase = rows
    .sort((a, b) => rank[a.status] - rank[b.status])
    // Encerrados: só os 3 mais recentes, como no protótipo.
    .filter((r, i, all) => r.status !== "ended" || all.slice(0, i).filter((x) => x.status === "ended").length < 3)

  return {
    clientName: data.clientName,
    seatLimit: data.seatLimit,
    units: data.units.map((u) => ({ id: u.id, name: u.name })),
    machines: data.machines.map((m) => ({ ...m })),
    users,
    engemase,
    canManage,
  }
}
