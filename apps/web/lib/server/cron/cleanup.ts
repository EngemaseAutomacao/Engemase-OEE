/**
 * Cron de partições e limpeza (diário, L17).
 *
 * Limpeza (idempotente):
 * - plataforma: chaves vencidas do limitador de taxa e histórico dos crons com mais de 30 dias;
 * - por cliente: histórico de saúde dos gateways com mais de 30 dias, comandos terminados há mais de
 *   90 dias, códigos de ativação usados há mais de 30 dias e vencidos (sem uso) há mais de 7 dias
 *   (até lá o /enroll ainda responde "código vencido", que orienta o técnico melhor que "inválido");
 * - auditoria: registros mais velhos que `AUDITORIA_RETENCAO_DIAS` (padrão 1825 dias = 5 anos, D6;
 *   mínimo 365, que o banco também confere), de todos os clientes, por `app.audit_log_purge` (0014), em
 *   lotes de 5.000 enquanto houver tempo (o que sobrar sai no dia seguinte).
 *
 * Partições (W2b, migração 0013): `maintainPartitions()` cria os próximos períodos de `production_minute`
 * (mês) e `tag_sample` (semana) e apaga os que passaram da retenção (2 anos, D6; 90 dias). É DDL: precisa
 * da conexão do DONO das tabelas, `DATABASE_MAINTENANCE_URL`. Sem ela, registra no log e pula (a 0013 já
 * deixou 3 meses / 8 semanas criados adiante), sem falhar a tarefa.
 */
import { gatewayCommand, gatewayEnrollment, gatewayHealthSample, maintainPartitions } from "@engemase/db"
import { and, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm"
import { getAuthDb } from "../db"
import { queryRows } from "../gateway/types"
import { cleanupAuth } from "./auth-cleanup"
import type { CronContext, CronJob } from "./runner"
import { utcDay } from "./windows"

const DAY_MS = 24 * 3_600_000

/** Retenções desta limpeza (dias). */
export const RETENTION_DAYS = {
  healthSamples: 30,
  finishedCommands: 90,
  usedActivationCodes: 30,
  expiredActivationCodes: 7,
  cronRuns: 30,
} as const

/** Retenção padrão da auditoria (dias): 5 anos (D6). */
export const AUDIT_RETENTION_DEFAULT_DAYS = 1825
/** Menor retenção aceita (dias); `app.audit_log_purge` recusa menos que isso. */
export const AUDIT_RETENTION_MIN_DAYS = 365
/** Registros de auditoria apagados por chamada. */
export const AUDIT_PURGE_BATCH = 5000

/**
 * Retenção da auditoria em dias, de `AUDITORIA_RETENCAO_DIAS`. Vazia: o padrão. Fora do formato ou
 * menor que o mínimo: `null` (a limpeza da auditoria não roda e o problema vai para o log).
 */
export function auditRetentionDays(env: Readonly<Record<string, string | undefined>>): number | null {
  const raw = env.AUDITORIA_RETENCAO_DIAS?.trim()
  if (raw === undefined || raw === "") return AUDIT_RETENTION_DEFAULT_DAYS
  if (!/^\d{1,6}$/.test(raw)) return null
  const days = Number(raw)
  return days >= AUDIT_RETENTION_MIN_DAYS ? days : null
}

async function purgeAudit(ctx: CronContext): Promise<{ deleted: number; retentionDays: number | null; complete: boolean }> {
  const days = auditRetentionDays(ctx.env)
  if (days === null) {
    ctx.log(
      `AUDITORIA_RETENCAO_DIAS inválida ("${ctx.env.AUDITORIA_RETENCAO_DIAS ?? ""}"): use um número inteiro de dias, no mínimo ${AUDIT_RETENTION_MIN_DAYS}. A auditoria não foi limpa.`,
    )
    return { deleted: 0, retentionDays: null, complete: false }
  }
  const before = new Date(ctx.now.getTime() - days * DAY_MS).toISOString()
  let deleted = 0
  // Lotes até esvaziar ou acabar o tempo (deixa 10 s para o resto da limpeza).
  for (;;) {
    const [row] = await queryRows<{ n: number }>(
      ctx.db,
      sql`SELECT app.audit_log_purge(${before}::timestamptz, ${AUDIT_PURGE_BATCH}::integer) AS n`,
    )
    const n = Number(row?.n ?? 0)
    deleted += n
    if (n < AUDIT_PURGE_BATCH) return { deleted, retentionDays: days, complete: true }
    if (ctx.remainingMs() < 10_000) return { deleted, retentionDays: days, complete: false }
  }
}

interface PartitionsSummary {
  readonly status: "ok" | "skipped" | "error"
  readonly created?: readonly string[]
  readonly dropped?: readonly string[]
  readonly reason?: string
}

async function partitions(ctx: CronContext): Promise<PartitionsSummary> {
  if (ctx.maintenance === null) {
    const reason = "DATABASE_MAINTENANCE_URL não configurada (conexão do dono das tabelas)"
    ctx.log(`partições não mantidas: ${reason}`)
    return { status: "skipped", reason }
  }
  try {
    const actions = await ctx.maintenance((db) => maintainPartitions(db, { now: ctx.now }))
    return {
      status: "ok",
      created: actions.filter((a) => a.action === "created").map((a) => a.partitionName),
      dropped: actions.filter((a) => a.action === "dropped").map((a) => a.partitionName),
    }
  } catch (error) {
    ctx.log("falha na manutenção das partições", error)
    return { status: "error", reason: "falha na manutenção das partições (ver o log)" }
  }
}

export const cleanupJob: CronJob = {
  name: "limpeza",
  schedule: "30 3 * * *",
  windowKey: utcDay,
  lockS: 900,
  async run(ctx) {
    const now = ctx.now
    const ago = (days: number) => new Date(now.getTime() - days * DAY_MS)

    const [rate] = await queryRows<{ n: number }>(ctx.db, sql`SELECT app.rate_limit_purge(${now.toISOString()}::timestamptz) AS n`)
    const [crons] = await queryRows<{ n: number }>(
      ctx.db,
      sql`SELECT app.cron_purge(${ago(RETENTION_DAYS.cronRuns).toISOString()}::timestamptz) AS n`,
    )

    const run = await ctx.forEachOrganization(async (tx) => {
      const health = await tx
        .delete(gatewayHealthSample)
        .where(lt(gatewayHealthSample.bucketStart, ago(RETENTION_DAYS.healthSamples)))
        .returning({ id: gatewayHealthSample.gatewayId })
      const commands = await tx
        .delete(gatewayCommand)
        .where(
          and(
            notInArray(gatewayCommand.status, ["pending", "sent"]),
            lt(gatewayCommand.createdAt, ago(RETENTION_DAYS.finishedCommands)),
          ),
        )
        .returning({ id: gatewayCommand.id })
      const codes = await tx
        .delete(gatewayEnrollment)
        .where(
          or(
            and(isNotNull(gatewayEnrollment.usedAt), lt(gatewayEnrollment.usedAt, ago(RETENTION_DAYS.usedActivationCodes))),
            and(isNull(gatewayEnrollment.usedAt), lt(gatewayEnrollment.expiresAt, ago(RETENTION_DAYS.expiredActivationCodes))),
          ),
        )
        .returning({ id: gatewayEnrollment.id })
      return { health: health.length, commands: commands.length, codes: codes.length }
    })
    const auth = await cleanupAuth(ctx, getAuthDb())
    const sum = (k: "health" | "commands" | "codes") => run.results.reduce((n, r) => n + r.value[k], 0)
    const parts = await partitions(ctx)
    const audit = await purgeAudit(ctx)
    return {
      rate_limit_keys_deleted: Number(rate?.n ?? 0),
      cron_runs_deleted: Number(crons?.n ?? 0),
      organizations: run.results.length,
      health_samples_deleted: sum("health"),
      commands_deleted: sum("commands"),
      activation_codes_deleted: sum("codes"),
      ...auth,
      partitions: parts,
      audit_retention_days: audit.retentionDays,
      audit_logs_deleted: audit.deleted,
      audit_purge_complete: audit.complete,
      failures:
        run.failures +
        auth.account_token_failures +
        (parts.status === "error" ? 1 : 0) +
        (audit.retentionDays === null ? 1 : 0),
      incomplete: run.incomplete,
    }
  },
}
