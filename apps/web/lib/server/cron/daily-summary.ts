/**
 * Cron do resumo diário por e-mail (diário, L17): um e-mail para a equipe Engemase com as últimas
 * 24 h de cada cliente (gateways sem comunicação, alertas abertos e novos, minutos recebidos e
 * reescritos).
 *
 * - Envio pelo Resend (API HTTP, tempo-limite de 10 s) quando `RESEND_API_KEY`, `RESUMO_DIARIO_DE` e
 *   `RESUMO_DIARIO_PARA` (lista separada por vírgula) estão definidos; sem eles, monta o resumo, não
 *   envia e informa o motivo.
 * - Janela = o dia em Brasília: um envio por dia. Está agendado às 7h e às 8h (horário de Brasília);
 *   a segunda chamada só envia se a primeira falhou (falha no envio libera a janela).
 * - O resumo por cliente para os usuários do cliente entra com os usuários e preferências (W5/W10).
 */
import { alertEvent, alertRule, gateway, organization, productionMinute } from "@engemase/db"
import { and, count, eq, gte, isNull, lte, sql } from "drizzle-orm"
import type { CronJob } from "./runner"
import { localDay } from "./windows"

/** Gateway sem /sync há mais que isto aparece como "sem comunicação" no resumo. */
const OFFLINE_AFTER_MS = 6 * 60_000

export interface OrganizationSummary {
  readonly name: string
  readonly gateways: number
  readonly gatewaysOffline: number
  readonly alertsOpen: number
  readonly alertsNew: number
  readonly minutes: number
  readonly minutesRewritten: number
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c)
}

/** Texto e HTML do e-mail (exportado para os testes). */
export function renderSummary(day: string, rows: readonly OrganizationSummary[]): { subject: string; text: string; html: string } {
  const [y, m, d] = day.split("-")
  const subject = `Resumo diário da plataforma OEE — ${d}/${m}/${y}`
  const sorted = [...rows].sort((a, b) => b.gatewaysOffline - a.gatewaysOffline || b.alertsOpen - a.alertsOpen || a.name.localeCompare(b.name, "pt-BR"))
  const header = ["Cliente", "Gateways", "Sem comunicação", "Alertas abertos", "Alertas novos (24 h)", "Minutos recebidos (24 h)", "Minutos reescritos (24 h)"]
  const cells = (r: OrganizationSummary) => [r.name, r.gateways, r.gatewaysOffline, r.alertsOpen, r.alertsNew, r.minutes, r.minutesRewritten].map(String)
  const text = [
    subject,
    "",
    sorted.length === 0 ? "Nenhum cliente cadastrado." : sorted.map((r) => `- ${r.name}: ${cells(r).slice(1).map((v, i) => `${header[i + 1]} ${v}`).join("; ")}`).join("\n"),
  ].join("\n")
  const html = `<p>${escapeHtml(subject)}</p><table border="1" cellpadding="4" cellspacing="0"><thead><tr>${header
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("")}</tr></thead><tbody>${sorted
    .map((r) => `<tr>${cells(r).map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`
  return { subject, text, html }
}

export const dailySummaryJob: CronJob = {
  name: "resumo-diario",
  // 10h e 11h UTC = 7h e 8h em Brasília (a segunda é a nova tentativa, se a primeira falhar).
  schedule: "0 10,11 * * *",
  windowKey: (now) => localDay(now),
  lockS: 300,
  async run(ctx) {
    const now = ctx.now
    const since = new Date(now.getTime() - 24 * 3_600_000)
    const offlineBefore = new Date(now.getTime() - OFFLINE_AFTER_MS)

    const run = await ctx.forEachOrganization(async (tx, organizationId): Promise<OrganizationSummary> => {
      const [org] = await tx.select({ name: organization.name }).from(organization).where(eq(organization.id, organizationId))
      const [gw] = await tx
        .select({
          total: count(),
          offline: sql<number>`count(*) FILTER (WHERE ${gateway.status} = 'active' AND ${gateway.lastSeenAt} <= ${offlineBefore.toISOString()}::timestamptz)`,
        })
        .from(gateway)
        .where(isNull(gateway.deletedAt))
      const [alerts] = await tx
        .select({
          open: sql<number>`count(*) FILTER (WHERE ${alertEvent.resolvedAt} IS NULL)`,
          fresh: sql<number>`count(*) FILTER (WHERE ${alertEvent.openedAt} >= ${since.toISOString()}::timestamptz)`,
          rewritten: sql<number>`coalesce(sum((${alertEvent.data} ->> 'count')::bigint) FILTER (
            WHERE ${alertRule.systemKey} = 'minute_rewritten' AND ${alertEvent.lastSeenAt} >= ${since.toISOString()}::timestamptz), 0)`,
        })
        .from(alertEvent)
        .innerJoin(alertRule, eq(alertRule.id, alertEvent.ruleId))
      const [minutes] = await tx
        .select({ n: count() })
        .from(productionMinute)
        .where(and(gte(productionMinute.bucketStart, since), lte(productionMinute.bucketStart, now)))
      return {
        name: org?.name ?? organizationId,
        gateways: Number(gw?.total ?? 0),
        gatewaysOffline: Number(gw?.offline ?? 0),
        alertsOpen: Number(alerts?.open ?? 0),
        alertsNew: Number(alerts?.fresh ?? 0),
        minutes: Number(minutes?.n ?? 0),
        minutesRewritten: Number(alerts?.rewritten ?? 0),
      }
    })

    const day = localDay(now)
    const email = renderSummary(
      day,
      run.results.map((r) => r.value),
    )
    const apiKey = ctx.env.RESEND_API_KEY?.trim()
    const from = ctx.env.RESUMO_DIARIO_DE?.trim()
    const to = (ctx.env.RESUMO_DIARIO_PARA ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
    const base = { day, organizations: run.results.length, failures: run.failures, incomplete: run.incomplete }
    if (!apiKey || !from || to.length === 0) {
      return { ...base, sent: false, reason: "e-mail não configurado (RESEND_API_KEY, RESUMO_DIARIO_DE, RESUMO_DIARIO_PARA)" }
    }
    // Resumo incompleto (falha ou tempo) não sai: a janela fica livre para a tentativa das 8h.
    if (run.failures > 0 || run.incomplete) throw new Error("resumo incompleto; envio adiado para a próxima tentativa")

    const res = await ctx.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `resumo-diario-${day}` },
      body: JSON.stringify({ from, to, subject: email.subject, text: email.text, html: email.html }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300)
      throw new Error(`Resend respondeu ${res.status}: ${detail}`)
    }
    return { ...base, sent: true, recipients: to.length }
  },
}
