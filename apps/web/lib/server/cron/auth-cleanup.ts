/**
 * Parte do login na limpeza diária (cron `limpeza`, `cleanup.ts`), num arquivo próprio para mexer o mínimo
 * no job:
 *
 * - `auth_login_throttle` (bloqueio de login e limites dos fluxos de senha): linhas paradas há mais de 24 h
 *   e sem bloqueio em vigor (`pruneLoginThrottle`);
 * - `verification` do Better Auth (links de redefinição de senha e etapa do 2FA): vencidas há mais de 1 dia;
 * - `account_token` de "definir senha"/"verificar e-mail" (por cliente, sob a RLS): usados ou vencidos há
 *   mais de 30 dias (até lá a tela ainda diz "link vencido"; pareamento de terminal fica com os terminais).
 *
 * As duas primeiras tabelas são só do papel `auth_service`, por isso usam o banco do login
 * (`AUTH_DATABASE_URL`, `getAuthDb()`); sem ele, ficam de fora e o resultado diz o motivo.
 */
import { accountToken, verification } from "@engemase/db"
import { and, inArray, isNotNull, lt, or } from "drizzle-orm"
import { pruneLoginThrottle, type ThrottleDb } from "../auth/throttle"
import type { CronContext } from "./runner"

const DAY_MS = 24 * 3_600_000

export const AUTH_RETENTION_DAYS = { verifications: 1, accountTokens: 30 } as const

export interface AuthCleanupResult {
  readonly auth_throttle_deleted: number | null
  readonly auth_verifications_deleted: number | null
  readonly account_tokens_deleted: number
  /** Clientes em que a limpeza dos tokens falhou (somado às falhas do job). */
  readonly account_token_failures: number
  readonly auth_cleanup?: string
}

export async function cleanupAuth(ctx: CronContext, authDb: ThrottleDb | null): Promise<AuthCleanupResult> {
  const now = ctx.now
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS)

  let throttle: number | null = null
  let verifications: number | null = null
  let note: string | undefined
  if (authDb === null) {
    note = "sem banco do login (AUTH_DATABASE_URL/DATABASE_URL): bloqueios e verificações não limpos"
  } else {
    try {
      throttle = await pruneLoginThrottle(authDb, now)
      const gone = await authDb
        .delete(verification)
        .where(lt(verification.expiresAt, ago(AUTH_RETENTION_DAYS.verifications)))
        .returning({ id: verification.id })
      verifications = gone.length
    } catch (error) {
      // Não derruba a limpeza dos clientes; aparece no resultado e no log.
      ctx.log("falha na limpeza do login", error)
      note = "falha na limpeza do login (ver logs)"
    }
  }

  const run = await ctx.forEachOrganization(async (tx) => {
    const cutoff = ago(AUTH_RETENTION_DAYS.accountTokens)
    const gone = await tx
      .delete(accountToken)
      .where(
        and(
          inArray(accountToken.purpose, ["set_password", "verify_email"]),
          or(and(isNotNull(accountToken.usedAt), lt(accountToken.usedAt, cutoff)), lt(accountToken.expiresAt, cutoff)),
        ),
      )
      .returning({ id: accountToken.id })
    return gone.length
  })

  return {
    auth_throttle_deleted: throttle,
    auth_verifications_deleted: verifications,
    account_tokens_deleted: run.results.reduce((n, r) => n + r.value, 0),
    account_token_failures: run.failures,
    ...(note === undefined ? {} : { auth_cleanup: note }),
  }
}
