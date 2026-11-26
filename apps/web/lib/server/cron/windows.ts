/** Janelas das tarefas agendadas (`CronJob.windowKey`). */

/** Início da janela de `minutes` minutos que contém `now` (UTC), como "2026-11-24T13:05". */
export function minuteWindow(now: Date, minutes = 1): string {
  const ms = minutes * 60_000
  return new Date(Math.floor(now.getTime() / ms) * ms).toISOString().slice(0, 16)
}

/** Dia UTC ("2026-11-24"). */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** Dia no fuso indicado ("2026-11-24"); padrão: horário de Brasília. */
export function localDay(now: Date, timeZone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}
