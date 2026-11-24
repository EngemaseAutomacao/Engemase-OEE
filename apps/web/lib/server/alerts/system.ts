/**
 * Alertas do sistema (docs/13): regras-preset que a plataforma cria sozinha em cada cliente, na
 * primeira vez que precisa delas (`alert_rule.system_key`, uma por cliente), e abertura/atualização
 * de alertas com deduplicação (um alerta aberto por regra e alvo, `alert_event_open_dedup_uq`).
 *
 * Para desligar um alerta do sistema num cliente, desative a regra (`active = false`): a regra
 * continua existindo e nada mais é aberto por ela.
 *
 * Tudo aqui roda DENTRO da transação do cliente (`withTenant`), sob RLS.
 */
import type { AlertRecipients, AlertSeverity, AlertType } from "@engemase/db"
import { alertEvent, alertRule } from "@engemase/db"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { GatewayTx } from "../gateway/types"

export interface SystemRuleSpec {
  readonly type: AlertType
  readonly name: string
  readonly severity: AlertSeverity
  readonly params: Record<string, unknown>
  readonly recipients: AlertRecipients
}

/** Presets do sistema (catálogo do docs/13). */
export const SYSTEM_RULES = {
  /** Sem contato há > 60 s, por ≥ 5 min. Avaliado pelo cron de alertas (1 min). */
  gateway_offline: {
    type: "gateway_offline",
    name: "Gateway sem comunicação",
    severity: "critical",
    params: { offlineAfterS: 60, minDurationMin: 5 },
    recipients: { roles: ["client_admin", "engineer"], includeEngemaseSupport: true },
  },
  /**
   * O gateway reenviou um minuto de produção com valores diferentes do gravado (docs/04): a versão
   * anterior fica na auditoria. Só para a equipe Engemase; resolve sozinho depois de 24 h sem nova
   * reescrita na máquina.
   */
  minute_rewritten: {
    type: "engemase_ops",
    name: "Minuto de produção reescrito pelo gateway",
    severity: "warning",
    params: { kind: "minute_rewritten", autoResolveAfterH: 24 },
    recipients: { includeEngemaseSupport: true },
  },
} as const satisfies Record<string, SystemRuleSpec>

export type SystemRuleKey = keyof typeof SYSTEM_RULES

export interface ActiveRule {
  readonly id: string
  readonly severity: AlertSeverity
  readonly params: Record<string, unknown>
}

/** Regra do sistema `key` do cliente da transação, sem criar (`null` se não existe, inativa ou excluída). */
export async function findSystemRule(tx: GatewayTx, organizationId: string, key: SystemRuleKey): Promise<ActiveRule | null> {
  const [rule] = await tx
    .select({
      id: alertRule.id,
      severity: alertRule.severity,
      params: alertRule.params,
      active: alertRule.active,
      deletedAt: alertRule.deletedAt,
    })
    .from(alertRule)
    .where(and(eq(alertRule.systemKey, key), eq(alertRule.organizationId, organizationId)))
  if (rule === undefined || !rule.active || rule.deletedAt !== null) return null
  return { id: rule.id, severity: rule.severity, params: rule.params }
}

/**
 * Regra do sistema `key` do cliente da transação, criada se ainda não existir. `null` se a regra
 * foi desativada ou excluída (o cliente não quer esse alerta).
 */
export async function ensureSystemRule(
  tx: GatewayTx,
  organizationId: string,
  key: SystemRuleKey,
): Promise<ActiveRule | null> {
  const spec: SystemRuleSpec = SYSTEM_RULES[key]
  await tx
    .insert(alertRule)
    .values({
      organizationId,
      systemKey: key,
      name: spec.name,
      type: spec.type,
      severity: spec.severity,
      params: spec.params,
      recipients: spec.recipients,
    })
    .onConflictDoNothing({
      target: [alertRule.organizationId, alertRule.systemKey],
      where: sql`${alertRule.systemKey} IS NOT NULL`,
    })
  return findSystemRule(tx, organizationId, key)
}

export interface AlertOccurrence {
  readonly organizationId: string
  readonly rule: ActiveRule
  /** Alvo do alerta (ex.: id da máquina ou do gateway). */
  readonly dedupKey: string
  readonly machineId?: string | null
  readonly gatewayId?: string | null
  readonly at: Date
  /** Dados do momento; `count`, se vier, é somado ao do alerta aberto (ocorrências). */
  readonly data: Record<string, unknown> & { readonly count?: number }
}

/**
 * Abre o alerta ou, se já houver um aberto para a mesma regra e alvo, atualiza `last_seen_at` e os
 * dados (somando `count`). Devolve se o alerta foi aberto agora.
 */
export async function raiseAlert(tx: GatewayTx, o: AlertOccurrence): Promise<{ readonly opened: boolean }> {
  const [row] = await tx
    .insert(alertEvent)
    .values({
      organizationId: o.organizationId,
      ruleId: o.rule.id,
      machineId: o.machineId ?? null,
      gatewayId: o.gatewayId ?? null,
      dedupKey: o.dedupKey,
      severity: o.rule.severity,
      openedAt: o.at,
      lastSeenAt: o.at,
      data: o.data,
    })
    .onConflictDoUpdate({
      target: [alertEvent.ruleId, alertEvent.dedupKey],
      targetWhere: sql`${alertEvent.resolvedAt} IS NULL`,
      set: {
        lastSeenAt: sql`greatest(${alertEvent.lastSeenAt}, excluded.last_seen_at)`,
        data: sql`CASE WHEN excluded.data ? 'count'
          THEN (${alertEvent.data} || excluded.data) || jsonb_build_object('count',
            coalesce((${alertEvent.data} ->> 'count')::bigint, 0) + (excluded.data ->> 'count')::bigint)
          ELSE ${alertEvent.data} || excluded.data END`,
      },
    })
    // xmax = 0 só na linha recém-inserida (no ON CONFLICT DO UPDATE, a linha atualizada tem xmax).
    .returning({ inserted: sql<boolean>`(xmax = 0)` })
  return { opened: row?.inserted === true }
}

/**
 * Resolve automaticamente (condição sumiu) os alertas abertos da regra que satisfazem `where`.
 * Devolve quantos foram resolvidos.
 */
export async function autoResolveAlerts(
  tx: GatewayTx,
  ruleId: string,
  at: Date,
  where: ReturnType<typeof sql>,
): Promise<number> {
  const resolved = await tx
    .update(alertEvent)
    .set({ state: "auto_resolved", resolvedAt: at })
    .where(and(eq(alertEvent.ruleId, ruleId), isNull(alertEvent.resolvedAt), where))
    .returning({ id: alertEvent.id })
  return resolved.length
}
