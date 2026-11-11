import { notFound } from "next/navigation"

import { getAuditLog, getClientBySlug, getClientUsers, getPlatformUsers, getRemoteAccessSessions, getUnits, nowMs, type Client } from "@/lib/mock"
import { ago, date, dateTime, duration } from "@/lib/format"
import { PLATFORM_ROLE_LABEL } from "@/lib/roles"
import { EngemaseAccess } from "@/components/settings/engemase-access"
import { RoleMatrix } from "@/components/settings/role-matrix"
import type { ClientUserRow, EngemaseAccessRow } from "@/components/settings/types"
import { UsersManager } from "@/components/settings/users-manager"

const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()

/**
 * Acessos da Engemase visíveis ao cliente (docs/15 §3). No protótipo são derivados dos registros simulados:
 * super admin (sempre auditado), concessões de suporte (atendimentos do suporte neste cliente, prazo de até 4 h)
 * e atribuição do engenheiro de campo (clientes gerenciados pela Engemase).
 * Na implementação real vêm de `support_access_grant` e `platform_assignment`.
 */
function engemaseAccessFor(client: Client): EngemaseAccessRow[] {
  const now = nowMs()
  const rows: EngemaseAccessRow[] = []
  const period = (start: number, end: number) => {
    const status = end > now ? ("active" as const) : ("ended" as const)
    return {
      startLabel: dateTime(iso(start)),
      endLabel: dateTime(iso(end)),
      status,
      remaining: status === "active" ? `restam ${duration((end - now) / 1000)}` : null,
    }
  }

  for (const p of getPlatformUsers()) {
    const role = p.platformRole!
    const base = { person: p.name, email: p.email ?? "", roleLabel: PLATFORM_ROLE_LABEL[role], units: "Todas as unidades" }

    if (role === "super_admin") {
      rows.push({
        ...base,
        id: `ea_${p.id}`,
        kind: "super_admin",
        reason: "Administração da plataforma",
        ticket: null,
        startLabel: date(client.createdAt),
        endLabel: null,
        status: "permanent",
        remaining: null,
      })
    }

    if (role === "support") {
      for (const s of getRemoteAccessSessions({ clientId: client.id })) {
        if (s.requestedBy !== p.name || s.status === "rejected" || s.status === "expired_unapproved") continue
        const start = Date.parse(s.requestedAt)
        const end = s.endedAt ? Date.parse(s.endedAt) : start + 4 * HOUR
        rows.push({ ...base, id: `ea_${p.id}_${s.id}`, kind: "support_grant", reason: s.reason, ticket: s.ticket, ...period(start, end) })
      }
      for (const a of getAuditLog(client.id)) {
        if (a.actorName !== p.name || !a.action.startsWith("support.")) continue
        const minutes = Number(a.details?.match(/(\d+)\s*min/)?.[1] ?? 60)
        const start = Date.parse(a.at)
        rows.push({
          ...base,
          id: `ea_${p.id}_${a.id}`,
          kind: "support_grant",
          reason: "Análise de dados e configuração a pedido do cliente",
          ticket: a.details?.match(/#\d+/)?.[0] ?? null,
          ...period(start, start + minutes * 60_000),
        })
      }
    }

    if (role === "field_engineer" && client.management === "engemase") {
      const start = Date.parse(client.createdAt)
      const end = start + 365 * 24 * HOUR
      rows.push({
        ...base,
        id: `ea_${p.id}_assign`,
        kind: "assignment",
        reason: "Comissionamento: gateways, conexões Modbus, máquinas e tags",
        ticket: null,
        ...period(start, end),
        remaining: end > now ? `válida até ${date(iso(end))}` : null,
      })
    }
  }

  const rank = { permanent: 0, active: 1, ended: 2 } as const
  return rows.sort((a, b) => rank[a.status] - rank[b.status]).filter((r, i, all) => r.status !== "ended" || all.slice(0, i).filter((x) => x.status === "ended").length < 3)
}

export default async function Page({ params }: PageProps<"/[cliente]/config/usuarios">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const units = getUnits(client.id).map((u) => ({ id: u.id, name: u.name }))
  const users: ClientUserRow[] = getClientUsers(client.id).map((u) => {
    const m = u.memberships.find((x) => x.clientId === client.id)!
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      username: u.username,
      role: m.role,
      unitScope: m.unitScope,
      status: u.status,
      twoFactor: u.twoFactor,
      lastLogin: ago(u.lastLoginAt),
      lastLoginAt: u.lastLoginAt,
      otherClients: u.memberships.filter((x) => x.clientId !== client.id).length,
    }
  })

  const managed = client.management === "engemase"

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <UsersManager clientName={client.name} clientSlug={client.slug} seatLimit={client.limits.users} units={units} initialUsers={users} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <EngemaseAccess clientSlug={client.slug} managedByEngemase={managed} initialPolicy="logged" initialRows={engemaseAccessFor(client)} />
        <RoleMatrix managedByEngemase={managed} />
      </div>
    </div>
  )
}
