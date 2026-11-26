/**
 * Cron de reconciliação do acesso remoto (15 min, L17; docs/12). O gateway já derruba a sessão
 * sozinho pelo prazo (princípio 5 do docs/12); aqui a nuvem fecha o que ficou para trás no banco e
 * garante o pedido de desligar:
 *
 * - pedido sem decisão há mais de 24 h → `expired_unapproved`;
 * - sessão aprovada que nunca ativou e já passou do prazo → `ended` (motivo `expired`);
 * - sessão ativando/ativa além do prazo → `stopping` e um `vpn.disable` (motivo `expired`) na fila
 *   do gateway, se ainda não houver um em aberto para ela;
 * - encaminhamento para CLP pedido/aprovado e vencido → `expired`; aberto e vencido → um
 *   `ot.forward.close` na fila (o gateway confirma o fechamento pelo evento `remote_access`).
 *
 * Cada mudança vira um `remote_access_event` com ator "system". Apagar o nó na Tailscale (API) entra
 * com a integração da VPN (F2).
 */
import { DEFAULT_COMMAND_TTL_S } from "@engemase/contracts"
import { gateway, gatewayCommand, remoteAccessEvent, remoteAccessForward, remoteAccessSession } from "@engemase/db"
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm"
import type { GatewayTx } from "../gateway/types"
import type { CronJob } from "./runner"
import { minuteWindow } from "./windows"

/** Pedido de acesso sem decisão vence depois disto. */
export const UNDECIDED_REQUEST_TTL_MS = 24 * 3_600_000

/** Folga depois do prazo antes de a nuvem mandar desligar (o gateway costuma desligar sozinho antes). */
export const EXPIRY_GRACE_MS = 2 * 60_000

async function hasOpenCommand(tx: GatewayTx, gatewayId: string, type: string, key: string, value: string): Promise<boolean> {
  const rows = await tx
    .select({ id: gatewayCommand.id })
    .from(gatewayCommand)
    .where(
      and(
        eq(gatewayCommand.gatewayId, gatewayId),
        eq(gatewayCommand.type, type),
        inArray(gatewayCommand.status, ["pending", "sent"]),
        sql`${gatewayCommand.payload} ->> ${key} = ${value}`,
      ),
    )
    .limit(1)
  return rows.length > 0
}

async function queueCommand(
  tx: GatewayTx,
  organizationId: string,
  gatewayId: string,
  type: "vpn.disable" | "ot.forward.close",
  payload: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await tx.insert(gatewayCommand).values({
    organizationId,
    gatewayId,
    type,
    payload,
    createdAt: now,
    expiresAt: new Date(now.getTime() + DEFAULT_COMMAND_TTL_S[type] * 1000),
  })
}

export const vpnJob: CronJob = {
  name: "vpn",
  schedule: "*/15 * * * *",
  windowKey: (now) => minuteWindow(now, 15),
  lockS: 600,
  async run(ctx) {
    const now = ctx.now
    const graceLimit = new Date(now.getTime() - EXPIRY_GRACE_MS)
    const run = await ctx.forEachOrganization(async (tx, organizationId) => {
      const events: (typeof remoteAccessEvent.$inferInsert)[] = []
      const event = (sessionId: string, type: string, data: Record<string, unknown>, forwardId?: string) =>
        events.push({ organizationId, sessionId, forwardId: forwardId ?? null, type, actorType: "system", data, at: now })

      const undecided = await tx
        .update(remoteAccessSession)
        .set({ status: "expired_unapproved", endedAt: now, endReason: "expired_unapproved", updatedAt: now })
        .where(
          and(
            eq(remoteAccessSession.status, "requested"),
            lte(remoteAccessSession.createdAt, new Date(now.getTime() - UNDECIDED_REQUEST_TTL_MS)),
          ),
        )
        .returning({ id: remoteAccessSession.id })
      for (const s of undecided) event(s.id, "expired_unapproved", { reason: "sem decisão em 24 h" })

      const neverStarted = await tx
        .update(remoteAccessSession)
        .set({ status: "ended", endedAt: now, endReason: "expired", updatedAt: now })
        .where(and(eq(remoteAccessSession.status, "approved"), lte(remoteAccessSession.expiresAt, graceLimit)))
        .returning({ id: remoteAccessSession.id })
      for (const s of neverStarted) event(s.id, "ended", { reason: "expired", note: "aprovada e não ativada no prazo" })

      // Ativas além do prazo: pede para desligar (gateway ativo) ou encerra (gateway fora de operação).
      const overdue = await tx
        .select({ id: remoteAccessSession.id, gatewayId: remoteAccessSession.gatewayId, gatewayStatus: gateway.status })
        .from(remoteAccessSession)
        .innerJoin(gateway, eq(gateway.id, remoteAccessSession.gatewayId))
        .where(
          and(
            inArray(remoteAccessSession.status, ["activating", "active", "stopping"]),
            lte(remoteAccessSession.expiresAt, graceLimit),
          ),
        )
      let disables = 0
      for (const s of overdue) {
        if (s.gatewayStatus !== "active") {
          await tx
            .update(remoteAccessSession)
            .set({ status: "ended", endedAt: now, endReason: "expired", updatedAt: now })
            .where(eq(remoteAccessSession.id, s.id))
          event(s.id, "ended", { reason: "expired", note: "gateway fora de operação" })
          continue
        }
        if (await hasOpenCommand(tx, s.gatewayId, "vpn.disable", "session_id", s.id)) continue
        await queueCommand(tx, organizationId, s.gatewayId, "vpn.disable", { session_id: s.id, reason: "expired" }, now)
        await tx
          .update(remoteAccessSession)
          .set({ status: "stopping", updatedAt: now })
          .where(and(eq(remoteAccessSession.id, s.id), inArray(remoteAccessSession.status, ["activating", "active"])))
        event(s.id, "reconcile_disable", { reason: "expired" })
        disables++
      }

      const staleForwards = await tx
        .update(remoteAccessForward)
        .set({ status: "expired", closedAt: now })
        .where(and(inArray(remoteAccessForward.status, ["requested", "approved"]), lte(remoteAccessForward.expiresAt, now)))
        .returning({ id: remoteAccessForward.id, sessionId: remoteAccessForward.sessionId })
      for (const f of staleForwards) event(f.sessionId, "forward_expired", { reason: "expired" }, f.id)

      const openForwards = await tx
        .select({ id: remoteAccessForward.id, sessionId: remoteAccessForward.sessionId, gatewayId: remoteAccessForward.gatewayId })
        .from(remoteAccessForward)
        .innerJoin(gateway, eq(gateway.id, remoteAccessForward.gatewayId))
        .where(
          and(
            eq(remoteAccessForward.status, "open"),
            lte(remoteAccessForward.expiresAt, graceLimit),
            eq(gateway.status, "active"),
            isNull(gateway.deletedAt),
          ),
        )
      let closes = 0
      for (const f of openForwards) {
        if (await hasOpenCommand(tx, f.gatewayId, "ot.forward.close", "forward_id", f.id)) continue
        await queueCommand(tx, organizationId, f.gatewayId, "ot.forward.close", { session_id: f.sessionId, forward_id: f.id, reason: "expired" }, now)
        event(f.sessionId, "reconcile_forward_close", { reason: "expired" }, f.id)
        closes++
      }

      if (events.length > 0) await tx.insert(remoteAccessEvent).values(events)
      return {
        expiredUnapproved: undecided.length,
        ended: neverStarted.length + overdue.filter((s) => s.gatewayStatus !== "active").length,
        disables,
        forwardsExpired: staleForwards.length,
        closes,
      }
    })
    const sum = (k: keyof (typeof run.results)[number]["value"]) => run.results.reduce((n, r) => n + r.value[k], 0)
    return {
      organizations: run.results.length,
      sessions_expired_unapproved: sum("expiredUnapproved"),
      sessions_ended: sum("ended"),
      vpn_disable_queued: sum("disables"),
      forwards_expired: sum("forwardsExpired"),
      forward_close_queued: sum("closes"),
      failures: run.failures,
      incomplete: run.incomplete,
    }
  },
}
