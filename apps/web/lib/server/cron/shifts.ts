/**
 * Cron de turnos (de hora em hora, W7): fechamento dos turnos que terminaram e recálculo dos turnos
 * sujos, cliente a cliente, com o cálculo do `@engemase/oee-core` (lib/server/production/oee-shifts.ts).
 *
 * Roda aos 10 min de cada hora: um turno que termina na hora cheia é fechado depois da folga de 5 min
 * para os últimos minutos chegarem. Idempotente: turno fechado não é refeito; turno sujo é recalculado uma
 * vez por marcação. O que passar do limite por cliente (ou do tempo da função) fica para a hora seguinte
 * e aparece em `shifts_pending`.
 */
import { closeAndRecomputeShifts } from "../production/oee-shifts"
import type { CronJob } from "./runner"
import { minuteWindow } from "./windows"

export const shiftsJob: CronJob = {
  name: "turnos",
  schedule: "10 * * * *",
  windowKey: (now) => minuteWindow(now, 60),
  lockS: 600,
  async run(ctx) {
    const run = await ctx.forEachOrganization((tx, organizationId) =>
      closeAndRecomputeShifts(tx, {
        organizationId,
        now: ctx.now,
        hasTime: () => ctx.remainingMs() > 5_000,
        log: (message, error) => ctx.log(`cliente ${organizationId}: ${message}`, error),
      }),
    )
    const sum = (k: "closed" | "recomputed" | "pending" | "errors") => run.results.reduce((n, r) => n + r.value[k], 0)
    return {
      organizations: run.results.length,
      shifts_closed: sum("closed"),
      shifts_recomputed: sum("recomputed"),
      shifts_pending: sum("pending"),
      shift_errors: sum("errors"),
      failures: run.failures,
      incomplete: run.incomplete,
    }
  },
}
