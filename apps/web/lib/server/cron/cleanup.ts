/**
 * Cron de partições e limpeza (diário, L17).
 *
 * Limpeza (idempotente):
 * - plataforma: chaves vencidas do limitador de taxa e histórico dos crons com mais de 30 dias;
 * - por cliente: histórico de saúde dos gateways com mais de 30 dias, comandos terminados há mais de
 *   90 dias, códigos de ativação usados há mais de 30 dias e vencidos (sem uso) há mais de 7 dias
 *   (até lá o /enroll ainda responde "código vencido", que orienta o técnico melhor que "inválido").
 *
 * Partições: `production_minute` e `tag_sample` ainda não são particionadas (pg_partman, W2b; docs/06
 * "Volume, particionamento e retenção"). Quando forem, a criação das partições futuras e a retenção
 * (`tag_sample` 30–90 dias; `production_minute` 2 anos, D6) entram neste job. Até lá ele informa
 * `partitions: "pendente"`.
 */
import { gatewayCommand, gatewayEnrollment, gatewayHealthSample } from "@engemase/db"
import { and, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm"
import { queryRows } from "../gateway/types"
import type { CronJob } from "./runner"
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
    const sum = (k: "health" | "commands" | "codes") => run.results.reduce((n, r) => n + r.value[k], 0)
    return {
      rate_limit_keys_deleted: Number(rate?.n ?? 0),
      cron_runs_deleted: Number(crons?.n ?? 0),
      organizations: run.results.length,
      health_samples_deleted: sum("health"),
      commands_deleted: sum("commands"),
      activation_codes_deleted: sum("codes"),
      partitions: "pendente (pg_partman, W2b)",
      failures: run.failures,
      incomplete: run.incomplete,
    }
  },
}
