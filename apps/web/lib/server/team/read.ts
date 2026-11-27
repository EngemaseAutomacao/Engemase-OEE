/**
 * Leitura das atribuições e concessões de suporte da equipe Engemase, direto das tabelas
 * (`platform_assignment`, `platform_assignment_unit`, `support_access_grant`). As tabelas são de cliente
 * (RLS): lê um `withTenant` por cliente, como o resto do console (W8). Nomes das pessoas vêm do banco do
 * login. Concessões: as ativas e as encerradas nos últimos 30 dias.
 */
import {
  clientAccount,
  organization,
  platformAssignment,
  platformAssignmentUnit,
  supportAccessGrant,
  unit,
  user,
  withTenant,
} from "@engemase/db"
import { and, desc, gt, inArray, isNull, ne } from "drizzle-orm"
import type { Assignment, SupportGrant } from "@/components/admin/admin-data"
import type { AssignmentRow, GrantRow } from "@/components/admin-ops/team-data"
import { date, dateTime } from "@/lib/format"
import type { ThrottleDb } from "@/lib/server/auth/throttle"
import type { GatewayDb } from "@/lib/server/gateway/types"
import { ENGEMASE_LAB_SLUG } from "./add-member"

const DAY = 86_400_000

export interface RealAssignment {
  readonly id: string
  readonly userId: string
  readonly clientId: string
  readonly unitIds: readonly string[]
  readonly reason: string
  readonly validFrom: Date
  readonly validUntil: Date
  readonly revokedAt: Date | null
  readonly createdBy: string
}

export interface RealGrant {
  readonly id: string
  readonly userId: string
  readonly clientId: string
  readonly ticket: string | null
  readonly reason: string
  readonly status: string
  readonly startsAt: Date
  readonly endsAt: Date
  readonly endedAt: Date | null
}

export interface TeamAccessData {
  readonly clients: ReadonlyMap<string, { readonly name: string; readonly status: string; readonly units: ReadonlyMap<string, string> }>
  readonly people: ReadonlyMap<string, string>
  readonly assignments: readonly RealAssignment[]
  readonly grants: readonly RealGrant[]
}

/** Atribuições e concessões de todos os clientes (ou só de `clientIds`). */
export async function readTeamAccess(db: GatewayDb, authDb: ThrottleDb, now: Date, clientIds?: readonly string[]): Promise<TeamAccessData> {
  const orgs = await authDb
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(clientIds ? and(ne(organization.slug, ENGEMASE_LAB_SLUG), inArray(organization.id, [...clientIds])) : ne(organization.slug, ENGEMASE_LAB_SLUG))
  const clients = new Map<string, { name: string; status: string; units: Map<string, string> }>()
  const assignments: RealAssignment[] = []
  const grants: RealGrant[] = []
  const recent = new Date(now.getTime() - 30 * DAY)

  for (const org of orgs) {
    await withTenant(db, org.id, async (tx) => {
      const [acc] = await tx.select({ status: clientAccount.status }).from(clientAccount).limit(1)
      const units = await tx.select({ id: unit.id, name: unit.name }).from(unit).where(isNull(unit.deletedAt))
      clients.set(org.id, { name: org.name, status: acc?.status ?? "active", units: new Map(units.map((u) => [u.id, u.name])) })
      const rows = await tx.select().from(platformAssignment).orderBy(desc(platformAssignment.validUntil))
      const links = rows.length === 0 ? [] : await tx.select().from(platformAssignmentUnit)
      for (const a of rows) {
        assignments.push({
          id: a.id,
          userId: a.userId,
          clientId: org.id,
          unitIds: links.filter((l) => l.assignmentId === a.id).map((l) => l.unitId),
          reason: a.reason,
          validFrom: a.validFrom,
          validUntil: a.validUntil,
          revokedAt: a.revokedAt,
          createdBy: a.createdBy,
        })
      }
      const gs = await tx
        .select()
        .from(supportAccessGrant)
        .where(gt(supportAccessGrant.endsAt, recent))
        .orderBy(desc(supportAccessGrant.startsAt))
      for (const g of gs) {
        grants.push({ id: g.id, userId: g.userId, clientId: org.id, ticket: g.ticket, reason: g.reason, status: g.status, startsAt: g.startsAt, endsAt: g.endsAt, endedAt: g.endedAt })
      }
    })
  }

  const ids = [...new Set([...assignments.flatMap((a) => [a.userId, a.createdBy]), ...grants.map((g) => g.userId)])]
  const people = new Map<string, string>()
  if (ids.length > 0) {
    for (const p of await authDb.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))) people.set(p.id, p.name)
  }
  return { clients, people, assignments, grants }
}

function grantActive(g: RealGrant, now: Date): boolean {
  return g.status === "active" && g.endedAt === null && g.endsAt > now
}

function durationLabel(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`
}

/** Linhas da tela "Equipe Engemase" (atribuições vigentes e concessões). */
export function teamRows(data: TeamAccessData, now: Date): { assignments: AssignmentRow[]; grants: GrantRow[] } {
  const assignments: AssignmentRow[] = data.assignments
    .filter((a) => a.revokedAt === null && a.validUntil > now)
    .map((a) => {
      const c = data.clients.get(a.clientId)
      const names = a.unitIds.map((id) => c?.units.get(id)).filter((n): n is string => n !== undefined)
      const all = a.unitIds.length === 0
      return {
        id: a.id,
        userId: a.userId,
        userName: data.people.get(a.userId) ?? "—",
        clientId: a.clientId,
        clientName: c?.name ?? "—",
        clientStatus: c?.status ?? "active",
        units: all ? "all" : [...a.unitIds],
        unitLabel: all ? (c && c.units.size === 1 ? [...c.units.values()][0]! : "Todas as unidades") : names.join(", "),
        validFrom: a.validFrom.toISOString(),
        validUntil: a.validUntil.toISOString(),
        validFromLabel: date(a.validFrom.toISOString()),
        validUntilLabel: date(a.validUntil.toISOString()),
        daysLeft: Math.ceil((a.validUntil.getTime() - now.getTime()) / DAY),
        reason: a.reason,
        createdBy: data.people.get(a.createdBy) ?? "Super admin",
      }
    })
  const grants: GrantRow[] = data.grants.map((g) => {
    const active = grantActive(g, now)
    const end = g.endedAt ?? g.endsAt
    return {
      id: g.id,
      userId: g.userId,
      userName: data.people.get(g.userId) ?? "—",
      clientId: g.clientId,
      clientName: data.clients.get(g.clientId)?.name ?? "—",
      ticket: g.ticket ?? "—",
      reason: g.reason,
      startedAt: g.startsAt.toISOString(),
      endsAt: g.endsAt.toISOString(),
      endedAt: active ? null : end.toISOString(),
      startedLabel: dateTime(g.startsAt.toISOString()),
      endsLabel: dateTime(end.toISOString()),
      active,
      durationLabel: durationLabel(end.getTime() - g.startsAt.getTime()),
    }
  })
  return { assignments, grants }
}

/** Linhas da aba "Acesso Engemase" do detalhe do cliente. */
export function clientAccessRows(data: TeamAccessData, clientId: string, now: Date): { grants: SupportGrant[]; assignments: Assignment[] } {
  const c = data.clients.get(clientId)
  const grants: SupportGrant[] = data.grants
    .filter((g) => g.clientId === clientId)
    .map((g) => {
      const active = grantActive(g, now)
      return {
        id: g.id,
        userName: data.people.get(g.userId) ?? "—",
        ticket: g.ticket ?? "—",
        reason: g.reason,
        start: dateTime(g.startsAt.toISOString()),
        end: dateTime((g.endedAt ?? g.endsAt).toISOString()),
        status: active ? "active" : g.endedAt !== null && g.status === "ended" ? "revoked" : "ended",
      }
    })
  const assignments: Assignment[] = data.assignments
    .filter((a) => a.clientId === clientId)
    .map((a) => ({
      id: a.id,
      userName: data.people.get(a.userId) ?? "—",
      units: a.unitIds.length === 0 ? "Todas as unidades" : a.unitIds.map((id) => c?.units.get(id) ?? "—").join(", "),
      start: date(a.validFrom.toISOString()),
      end: date(a.validUntil.toISOString()),
      reason: a.reason,
      status: a.revokedAt !== null ? "revoked" : a.validUntil <= now ? "expired" : "active",
    }))
  return { grants, assignments }
}
