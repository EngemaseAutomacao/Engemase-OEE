/**
 * As 5 tarefas agendadas da L17 (docs/17) e o fechamento de turno (W7), com a rota `/api/cron/<nome>` e o horário (UTC). O `vercel.json`
 * agenda as que o plano da Vercel aceita (`cronsDoVercel()`); o teste `test/cron/cron.test.ts` confere.
 */
import { getDb, maintenanceDbRunner } from "../db"
import { alertsJob } from "./alerts"
import { cleanupJob } from "./cleanup"
import { dailySummaryJob } from "./daily-summary"
import { expirationJob } from "./expiration"
import { type CronJob, runCronJob } from "./runner"
import { shiftsJob } from "./shifts"
import { vpnJob } from "./vpn"

export const CRON_JOBS: readonly CronJob[] = [alertsJob, expirationJob, vpnJob, cleanupJob, dailySummaryJob, shiftsJob]

/**
 * Plano da Vercel em que o projeto está. No gratuito (Hobby) a Vercel recusa o deploy inteiro se o `vercel.json`
 * tiver uma tarefa que roda mais de uma vez por dia; por isso, enquanto for "hobby" (fase de testes), só as diárias
 * são agendadas e as outras rotas ficam sem agendamento (dá para chamar à mão, com o CRON_SECRET). Ao passar para o
 * Pro: troque para "pro" e ponha no `vercel.json` o que `cronsDoVercel("pro")` devolver (o teste aponta a diferença).
 */
export const PLANO_VERCEL: "hobby" | "pro" = "hobby"

/** O horário de uma vez por dia (minuto e hora fixos, todo dia) ou null; numa lista de horas, fica a primeira. */
export function horarioDiario(schedule: string): string | null {
  const [minuto, hora, ...resto] = schedule.trim().split(/\s+/)
  if (resto.join(" ") !== "* * *" || !/^\d+$/.test(minuto ?? "")) return null
  const primeira = (hora ?? "").split(",")[0]
  return /^\d+$/.test(primeira) ? `${minuto} ${primeira} * * *` : null
}

/** As entradas `crons` do `vercel.json` para o plano: no Pro, todas; no Hobby, só as diárias (uma vez por dia). */
export function cronsDoVercel(plano: "hobby" | "pro" = PLANO_VERCEL): { path: string; schedule: string }[] {
  return CRON_JOBS.flatMap((j) => {
    const schedule = plano === "pro" ? j.schedule : horarioDiario(j.schedule)
    return schedule === null ? [] : [{ path: `/api/cron/${j.name}`, schedule }]
  })
}

/** Handler das rotas de cron em produção (banco e segredo das variáveis de ambiente). */
export function handleCronRoute(request: Request, name: string): Promise<Response> {
  const job = CRON_JOBS.find((j) => j.name === name)
  if (job === undefined) throw new Error(`job desconhecido: ${name}`)
  // Região em que a função rodou de fato (o campo "region" do log da Vercel pode ser a porta de entrada).
  console.info(`[cron] ${name} rodando na região ${process.env.VERCEL_REGION ?? "local"}`)
  return runCronJob(request, job, { db: getDb(), secret: process.env.CRON_SECRET, maintenance: maintenanceDbRunner() })
}
