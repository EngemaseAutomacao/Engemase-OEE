/**
 * Cron de expiração (5 min, L17): concessões, tokens e comandos vencidos, cliente a cliente.
 *
 * - comandos em aberto (`pending`/`sent`) além de `expires_at` → `expired` (também os de gateway
 *   offline, que o /sync não vê);
 * - concessões de suporte da Engemase (`support_access_grant`) ativas além de `ends_at` → `expired`,
 *   com registro na auditoria (o cliente vê);
 * - token anterior do gateway fora da janela da rotação → apagado (já não autenticava).
 *
 * Códigos de ativação vencidos não precisam de nada: o /enroll confere a validade na hora (e responde
 * "código vencido"); a limpeza diária apaga os antigos.
 */
import { auditLog, gateway, gatewayCommand, supportAccessGrant } from "@engemase/db"
import { and, eq, inArray, lte, sql } from "drizzle-orm"
import type { CronJob } from "./runner"
import { minuteWindow } from "./windows"

export const expirationJob: CronJob = {
  name: "expiracao",
  schedule: "*/5 * * * *",
  windowKey: (now) => minuteWindow(now, 5),
  lockS: 240,
  async run(ctx) {
    const now = ctx.now
    const run = await ctx.forEachOrganization(async (tx, organizationId) => {
      const commands = await tx
        .update(gatewayCommand)
        .set({ status: "expired", completedAt: now })
        .where(and(inArray(gatewayCommand.status, ["pending", "sent"]), lte(gatewayCommand.expiresAt, now)))
        .returning({ id: gatewayCommand.id })

      const grants = await tx
        .update(supportAccessGrant)
        .set({ status: "expired", endedAt: sql`${supportAccessGrant.endsAt}` })
        .where(and(eq(supportAccessGrant.status, "active"), lte(supportAccessGrant.endsAt, now)))
        .returning({ id: supportAccessGrant.id, userId: supportAccessGrant.userId, endsAt: supportAccessGrant.endsAt })
      if (grants.length > 0) {
        await tx.insert(auditLog).values(
          grants.map((g) => ({
            organizationId,
            actorType: "system" as const,
            action: "support_access_grant.expired",
            entityType: "support_access_grant",
            entityId: g.id,
            after: { status: "expired", user_id: g.userId, ends_at: g.endsAt.toISOString() },
            accessGrantId: g.id,
            at: now,
          })),
        )
      }

      const tokens = await tx
        .update(gateway)
        .set({ previousTokenHash: null, previousTokenExpiresAt: null })
        .where(lte(gateway.previousTokenExpiresAt, now))
        .returning({ id: gateway.id })

      return { commands: commands.length, grants: grants.length, tokens: tokens.length }
    })
    const sum = (k: "commands" | "grants" | "tokens") => run.results.reduce((n, r) => n + r.value[k], 0)
    return {
      organizations: run.results.length,
      commands_expired: sum("commands"),
      support_grants_expired: sum("grants"),
      previous_tokens_cleared: sum("tokens"),
      failures: run.failures,
      incomplete: run.incomplete,
    }
  },
}
