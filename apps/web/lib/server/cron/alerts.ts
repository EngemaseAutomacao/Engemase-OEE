/**
 * Cron de alertas (1 min, L17): avalia os alertas do sistema que dependem de duração (docs/13,
 * "Pipeline"), cliente a cliente.
 *
 * - **Gateway sem comunicação** (`gateway_offline`): gateway ativo cujo último /sync passou de
 *   `offlineAfterS + minDurationMin` (60 s + 5 min) abre um alerta crítico por gateway; resolve
 *   sozinho quando o gateway volta a sincronizar (último /sync há menos de `offlineAfterS`) ou é
 *   revogado/excluído. Gateway que nunca sincronizou não alerta.
 * - **Em trânsito** (L23): gateway marcado "Em trânsito" (`in_transit_until` no futuro e `installed_at`
 *   nulo: ativado na bancada e desligado para envio) não abre alerta de offline, e o alerta que estiver
 *   aberto se resolve. Passado o prazo (até 30 dias) sem instalar, volta a alertar normalmente. O trânsito
 *   termina no primeiro /sync depois de marcado (`installed_at`, gravado pelo /sync).
 * - **Minuto reescrito** (`minute_rewritten`, aberto pelo /sync): resolve sozinho depois de
 *   `autoResolveAfterH` (24 h) sem reescrita nova na máquina.
 *
 * Os alertas configuráveis pelo cliente (máquina parada, OEE abaixo da meta...) e a entrega por canal
 * entram com a central de alertas (W10).
 */
import { alertEvent, gateway } from "@engemase/db"
import { and, eq, isNotNull, isNull, lte, not, sql } from "drizzle-orm"
import { autoResolveAlerts, ensureSystemRule, findSystemRule, raiseAlert, SYSTEM_RULES } from "../alerts/system"
import type { GatewayTx } from "../gateway/types"
import type { CronJob } from "./runner"
import { minuteWindow } from "./windows"

function numberParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key]
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Gateway "Em trânsito" em `now` (L23): prazo ainda valendo e não instalado. */
export function inTransitAt(now: Date) {
  return sql`(${gateway.inTransitUntil} IS NOT NULL AND ${gateway.inTransitUntil} > ${now.toISOString()}::timestamptz AND ${gateway.installedAt} IS NULL)`
}

async function gatewayOffline(tx: GatewayTx, organizationId: string, now: Date): Promise<{ opened: number; resolved: number }> {
  const defaults = SYSTEM_RULES.gateway_offline.params
  // Sem gateway parado, nem cria a regra (cliente sem gateway não ganha regra à toa).
  const existing = await findSystemRule(tx, organizationId, "gateway_offline")
  const offlineAfterS = numberParam(existing?.params ?? defaults, "offlineAfterS", defaults.offlineAfterS)
  const minDurationMin = numberParam(existing?.params ?? defaults, "minDurationMin", defaults.minDurationMin)
  const alertBefore = new Date(now.getTime() - (offlineAfterS + minDurationMin * 60) * 1000)

  const silent = await tx
    .select({ id: gateway.id, lastSeenAt: gateway.lastSeenAt, name: gateway.name })
    .from(gateway)
    .where(
      and(
        eq(gateway.status, "active"),
        isNull(gateway.deletedAt),
        isNotNull(gateway.lastSeenAt),
        lte(gateway.lastSeenAt, alertBefore),
        not(inTransitAt(now)),
      ),
    )
  let opened = 0
  const rule = silent.length > 0 ? await ensureSystemRule(tx, organizationId, "gateway_offline") : existing
  if (rule !== null && silent.length > 0) {
    for (const gw of silent) {
      const r = await raiseAlert(tx, {
        organizationId,
        rule,
        dedupKey: gw.id,
        gatewayId: gw.id,
        at: now,
        data: { kind: "gateway_offline", gateway_name: gw.name, last_seen_at: gw.lastSeenAt?.toISOString() ?? null },
      })
      if (r.opened) opened++
    }
  }
  if (rule === null) return { opened, resolved: 0 }

  // Resolve: sincronizou há pouco, saiu de operação (revogado/excluído) ou foi marcado "Em trânsito".
  const backOnline = new Date(now.getTime() - offlineAfterS * 1000)
  const resolved = await autoResolveAlerts(
    tx,
    rule.id,
    now,
    sql`EXISTS (
      SELECT 1 FROM gateway g WHERE g.id = ${alertEvent.gatewayId}
        AND (g.last_seen_at > ${backOnline.toISOString()}::timestamptz OR g.status = 'revoked' OR g.deleted_at IS NOT NULL
          OR (g.in_transit_until > ${now.toISOString()}::timestamptz AND g.installed_at IS NULL))
    )`,
  )
  return { opened, resolved }
}

async function minuteRewrittenResolution(tx: GatewayTx, organizationId: string, now: Date): Promise<number> {
  const rule = await findSystemRule(tx, organizationId, "minute_rewritten")
  if (rule === null) return 0
  const hours = numberParam(rule.params, "autoResolveAfterH", SYSTEM_RULES.minute_rewritten.params.autoResolveAfterH)
  const before = new Date(now.getTime() - hours * 3_600_000)
  return autoResolveAlerts(tx, rule.id, now, sql`${alertEvent.lastSeenAt} <= ${before.toISOString()}::timestamptz`)
}

export const alertsJob: CronJob = {
  name: "alertas",
  schedule: "* * * * *",
  windowKey: (now) => minuteWindow(now, 1),
  lockS: 55,
  async run(ctx) {
    const run = await ctx.forEachOrganization(async (tx, organizationId) => {
      const offline = await gatewayOffline(tx, organizationId, ctx.now)
      const rewritten = await minuteRewrittenResolution(tx, organizationId, ctx.now)
      return { offline, rewritten }
    })
    const sum = (pick: (v: (typeof run.results)[number]["value"]) => number) =>
      run.results.reduce((n, r) => n + pick(r.value), 0)
    return {
      organizations: run.results.length,
      gateway_offline_opened: sum((v) => v.offline.opened),
      gateway_offline_resolved: sum((v) => v.offline.resolved),
      minute_rewritten_resolved: sum((v) => v.rewritten),
      failures: run.failures,
      incomplete: run.incomplete,
    }
  },
}
