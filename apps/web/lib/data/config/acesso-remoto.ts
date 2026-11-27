/**
 * Dados da tela "Acesso remoto" do cliente (docs/12). Com banco: pedidos e sessões dos últimos 90 dias e a
 * política do cliente, sob a RLS (`data.read`); os nomes das pessoas vêm das contas (fora da transação do
 * cliente). Sem banco: os dados simulados (`buildRemoteAccess`).
 */
import { remoteAccessSession, user, withTenant } from "@engemase/db"
import { desc, gt, inArray } from "drizzle-orm"
import { buildRemoteAccess } from "@/components/support/remote-data"
import type { PersonVM, RemoteData, RemoteSessionVM } from "@/components/support/remote-types"
import type { RemoteAccessStatus } from "@/lib/mock"
import { CLIENT_ROLE_LABEL } from "@/lib/roles"
import { hasPermission } from "@/lib/server/access/context"
import { getAuthDb } from "@/lib/server/db"
import { lerPolitica } from "@/lib/server/remote/access"
import { bancoObrigatorio } from "../admin/acesso"
import { exigirCliente } from "./cliente"

const DAY = 86_400_000

/** Estado do banco → estado mostrado na tela. */
export function statusDaTela(s: string): RemoteAccessStatus {
  switch (s) {
    case "requested":
      return "requested"
    case "approved":
    case "activating":
      return "approved"
    case "active":
    case "stopping":
      return "active"
    case "denied":
    case "cancelled":
      return "rejected"
    case "expired_unapproved":
      return "expired_unapproved"
    case "revoked":
      return "revoked"
    default:
      return "ended"
  }
}

const FIM: Record<string, string> = {
  requested: "Encerrada a pedido",
  expired: "Prazo encerrado",
  idle: "Encerrada por inatividade",
  revoked: "Revogada",
  local_lock: "Bloqueada no gateway",
  token_revoked: "Gateway revogado",
  agent_restart: "Gateway reiniciado",
  error: "Erro na conexão",
  approval_invalid: "O gateway recusou a aprovação (assinatura ou prazo)",
  policy_denied: "Bloqueado pela política local do gateway",
  vpn_failed: "O gateway não conseguiu ligar a VPN",
  session_conflict: "Já havia outra sessão no gateway",
  denied: "Recusado",
}

export async function dadosAcessoRemoto(slug: string) {
  // Ver o acesso remoto = leitura técnica (admin e engenheiro do cliente, equipe Engemase; docs/12).
  const { r, client, ctx } = await exigirCliente(slug, "technical.read")
  if (ctx === null) return { client, banco: false as const, data: buildRemoteAccess(client), canApprove: true, canRequest: true }

  const db = bancoObrigatorio()
  const now = Date.now()
  const rows = await withTenant(db, ctx.organizationId, (tx) =>
    tx
      .select()
      .from(remoteAccessSession)
      .where(gt(remoteAccessSession.createdAt, new Date(now - 90 * DAY)))
      .orderBy(desc(remoteAccessSession.createdAt))
      .limit(300),
  )
  const politica = await lerPolitica(db, ctx)

  // Nomes de quem pediu e decidiu (contas), lidos fora da transação do cliente.
  const ids = [...new Set(rows.flatMap((s) => [s.requestedBy, s.decidedBy, s.endedBy]).filter((x): x is string => x !== null))]
  const nomes = new Map<string, string>()
  const authDb = getAuthDb()
  if (authDb !== null && ids.length > 0) for (const u of await authDb.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))) nomes.set(u.id, u.name)

  // Escopo (docs/15, risco 14): só gateways das unidades que a pessoa vê. Por máquinas: as unidades delas.
  const unidadesVisiveis =
    ctx.scope.kind === "all"
      ? null
      : new Set(ctx.scope.kind === "units" ? ctx.scope.unitIds : r.getMachines(client.id).filter((m) => (ctx.scope.kind === "machines" ? ctx.scope.machineIds.includes(m.id) : false)).map((m) => m.unitId))
  const gatewaysVisiveis = r.getGateways(client.id).filter((g) => unidadesVisiveis === null || unidadesVisiveis.has(g.unitId))
  const gateways = new Map(gatewaysVisiveis.map((g) => [g.id, g]))
  const unidades = new Map(r.getUnits(client.id).map((u) => [u.id, u.name]))
  const members = r.getClientUsers(client.id)
  const roleOf = (id: string) => members.find((u) => u.id === id)?.memberships.find((m) => m.clientId === client.id)?.role
  const ms = (d: Date | null) => (d ? d.getTime() : null)

  const sessions: RemoteSessionVM[] = rows.filter((s) => gateways.has(s.gatewayId)).map((s) => {
    const gw = gateways.get(s.gatewayId)
    const anteriores = rows.filter((o) => o.id !== s.id && o.requestedBy === s.requestedBy && o.createdAt < s.createdAt && o.startsAt !== null)
    const status = statusDaTela(s.status)
    return {
      id: s.id,
      gatewayId: s.gatewayId,
      gatewayName: gw?.name ?? "Gateway",
      hostname: gw?.hostname ?? "—",
      unitName: gw ? (unidades.get(gw.unitId) ?? "") : "",
      gatewayStatus: gw?.status ?? "offline",
      requestedBy: nomes.get(s.requestedBy) ?? "Equipe Engemase",
      requestedByRole: "Engemase",
      requesterHistory: anteriores.length > 0 ? `${anteriores.length} ${anteriores.length === 1 ? "sessão anterior" : "sessões anteriores"} neste cliente` : "Primeira sessão deste técnico neste cliente",
      reason: s.reason,
      ticket: s.ticket ?? "—",
      durationMin: s.approvedDurationMin ?? s.requestedDurationMin,
      requestedDurationMin: s.requestedDurationMin,
      ssh: true,
      plc: null,
      requestedPlc: null,
      status,
      requestedMs: s.createdAt.getTime(),
      decidedBy: s.decidedBy ? (nomes.get(s.decidedBy) ?? null) : null,
      decidedMs: ms(s.decidedAt),
      startedMs: ms(s.startsAt),
      expiresMs: ms(s.expiresAt),
      endedMs: ms(s.endedAt),
      endedReason:
        s.status === "cancelled"
          ? "Cancelado por quem pediu"
          : s.status === "denied"
            ? `Recusado: ${s.decisionNote ?? "sem motivo"}`
            : s.endReason
              ? (FIM[s.endReason] ?? s.endReason)
              : null,
      connection: null,
      bytes: s.bytesIn !== null || s.bytesOut !== null ? (s.bytesIn ?? 0) + (s.bytesOut ?? 0) : null,
      onsiteContact: null,
      changes: s.approvedDurationMin !== null && s.approvedDurationMin < s.requestedDurationMin ? [`Duração reduzida para ${s.approvedDurationMin} min`] : [],
    }
  })

  const approvers = members.filter((u) => u.status === "active" && roleOf(u.id) === "client_admin").map((u) => u.name)
  const contacts: PersonVM[] = members
    .filter((u) => u.status === "active" && ["client_admin", "engineer", "supervisor"].includes(roleOf(u.id) ?? ""))
    .map((u) => ({ id: u.id, name: u.name, role: CLIENT_ROLE_LABEL[roleOf(u.id)!] }))

  const data: RemoteData = {
    clientName: client.name,
    clientSlug: client.slug,
    me: { name: ctx.user.name, isPlatform: ctx.access.kind === "engemase", canDecide: hasPermission(ctx, "remote_access.approve") },
    approvers,
    contacts,
    sessions,
    policy: {
      mode: politica.mode === "disabled" ? "disabled" : "approval_required",
      maxDurationMin: politica.maxDurationMin,
      idleTimeoutMin: politica.idleTimeoutMin,
      allowPlcForward: false,
      requireOnsiteContact: false,
      onsiteContactId: null,
      windows: [],
    },
    nowMs: now,
  }
  return {
    client,
    banco: true as const,
    data,
    canApprove: hasPermission(ctx, "remote_access.approve"),
    canRequest: ctx.access.kind === "engemase" && hasPermission(ctx, "diagnostics.run"),
    gateways: gatewaysVisiveis.map((g) => ({ id: g.id, name: g.name })),
  }
}
