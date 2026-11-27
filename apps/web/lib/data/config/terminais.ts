/**
 * Dados da tela "Terminais" (cadastro do cliente, W8). Com banco: terminais não revogados do cliente (RLS),
 * com situação (aguardando pareamento, online nos últimos 10 min, offline), quem pareou e o último sinal.
 * O código de pareamento nunca é lido do banco (só existe o hash): a tela gera um novo quando pedem.
 * `exigirCliente` confere sessão, cliente e `config.read`. Sem banco: os dados simulados.
 */
import { terminal, user, withTenant } from "@engemase/db"
import { asc, inArray, isNull } from "drizzle-orm"
import type { TerminalRow } from "@/components/settings/types"
import { ago, date } from "@/lib/format"
import { getCurrentUser, getTerminals } from "@/lib/mock"
import { getAuthDb } from "@/lib/server/db"
import { toScreenKind } from "@/lib/server/terminal/terminals"
import { bancoObrigatorio } from "../admin/acesso"
import { exigirCliente } from "./cliente"

const ONLINE_MS = 10 * 60_000

export async function dadosTerminais(slug: string) {
  const { r, client, ctx } = await exigirCliente(slug)
  const units = r.getUnits(client.id).map((u) => ({ id: u.id, name: u.name }))
  const lines = r.getLines(client.id).map((l) => ({ id: l.id, unitId: l.unitId, name: l.name, code: l.code }))
  const machines = r.getMachines(client.id).map((m) => ({ id: m.id, unitId: m.unitId, lineId: m.lineId, name: m.name, code: m.code }))
  const canEdit = r.getConfigAccess(client.id).canConfigure

  if (ctx === null) {
    const me = getCurrentUser()
    const terminals: TerminalRow[] = getTerminals(client.id).map((t) => ({
      id: t.id,
      unitId: t.unitId,
      name: t.name,
      kind: t.kind,
      lineIds: t.scope.lineIds ?? [],
      machineIds: t.scope.machineIds ?? [],
      theme: t.theme,
      status: t.status,
      pairedBy: t.pairedBy,
      pairedAt: t.pairedAt ? date(t.pairedAt) : null,
      lastSeen: ago(t.lastSeen),
      pairingCode: t.pairingCode ?? null,
    }))
    return { client, banco: false, canEdit, units, lines, machines, terminals, currentUserName: me.platformRole ? `${me.name} (Engemase)` : me.name }
  }

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const rows = await withTenant(bancoObrigatorio(), ctx.organizationId, (tx) =>
    tx
      .select({
        id: terminal.id,
        unitId: terminal.unitId,
        name: terminal.name,
        kind: terminal.kind,
        lineIds: terminal.lineIds,
        machineIds: terminal.machineIds,
        tokenHash: terminal.tokenHash,
        pairedBy: terminal.pairedBy,
        pairedAt: terminal.pairedAt,
        expiresAt: terminal.expiresAt,
        lastSeenAt: terminal.lastSeenAt,
      })
      .from(terminal)
      .where(isNull(terminal.revokedAt))
      .orderBy(asc(terminal.name)),
  )
  const pairers = [...new Set(rows.map((t) => t.pairedBy).filter((id): id is string => id !== null))]
  const names = new Map<string, string>()
  const authDb = getAuthDb()
  if (authDb !== null && pairers.length > 0) {
    for (const p of await authDb.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, pairers))) names.set(p.id, p.name)
  }
  const terminals: TerminalRow[] = rows.map((t) => {
    const paired = t.tokenHash !== null && t.expiresAt !== null && t.expiresAt.getTime() > now
    const kind = toScreenKind(t.kind)
    return {
      id: t.id,
      unitId: t.unitId,
      name: t.name,
      kind,
      lineIds: t.lineIds,
      machineIds: t.machineIds,
      theme: kind === "andon_tv" ? "dark" : "system",
      status: !paired ? "pending" : t.lastSeenAt !== null && now - t.lastSeenAt.getTime() < ONLINE_MS ? "online" : "offline",
      pairedBy: t.pairedBy === null ? null : (names.get(t.pairedBy) ?? "—"),
      pairedAt: t.pairedAt ? date(t.pairedAt.toISOString()) : null,
      lastSeen: ago(t.lastSeenAt?.toISOString() ?? null, nowIso),
      pairingCode: null,
    }
  })
  return { client, banco: true, canEdit, units, lines, machines, terminals, currentUserName: ctx.user.name }
}
