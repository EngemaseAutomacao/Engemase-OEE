/**
 * As 5 tarefas agendadas da L17 (docs/17), com a rota `/api/cron/<nome>` e o horário (UTC) do
 * `vercel.json`. O teste `test/cron/cron.test.ts` confere que o `vercel.json` lista exatamente estas.
 */
import { getDb } from "../db"
import { alertsJob } from "./alerts"
import { cleanupJob } from "./cleanup"
import { dailySummaryJob } from "./daily-summary"
import { expirationJob } from "./expiration"
import { type CronJob, runCronJob } from "./runner"
import { vpnJob } from "./vpn"

export const CRON_JOBS: readonly CronJob[] = [alertsJob, expirationJob, vpnJob, cleanupJob, dailySummaryJob]

/** Handler das rotas de cron em produção (banco e segredo das variáveis de ambiente). */
export function handleCronRoute(request: Request, name: string): Promise<Response> {
  const job = CRON_JOBS.find((j) => j.name === name)
  if (job === undefined) throw new Error(`job desconhecido: ${name}`)
  return runCronJob(request, job, { db: getDb(), secret: process.env.CRON_SECRET })
}
