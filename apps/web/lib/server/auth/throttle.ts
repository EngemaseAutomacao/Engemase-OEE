/**
 * Bloqueio de login por conta (L20; docs/15, item 15): 5 senhas erradas em 15 min → 15 min de
 * espera. A chave é o SHA-256 do e-mail normalizado: o e-mail não fica gravado e um e-mail que não
 * existe é tratado igual a um que existe (não revela quem tem conta).
 *
 * Durante o bloqueio a senha NEM é conferida (nem a certa entra). Os limites por IP ficam com o rate
 * limit do Better Auth e o Firewall da Vercel (docs/08).
 */
import { authLoginThrottle, sha256Hex } from "@engemase/db"
import { eq, sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"

export const LOGIN_MAX_FAILURES = 5
export const LOGIN_WINDOW_MS = 15 * 60 * 1000
export const LOGIN_LOCK_MS = 15 * 60 * 1000

export type ThrottleDb = PgDatabase<PgQueryResultHKT>

/** Chave da conta: SHA-256 do e-mail sem espaços e em minúsculas. */
export function throttleKey(email: string): string {
  return sha256Hex(email.trim().toLowerCase())
}

export interface ThrottleState {
  readonly failures: number
  readonly windowStartedAt: Date
  readonly lockedUntil: Date | null
}

/** Estado depois de mais uma senha errada (função pura). */
export function nextThrottleState(
  previous: ThrottleState | null,
  now: Date,
): ThrottleState & { readonly justLocked: boolean } {
  const t = now.getTime()
  if (previous?.lockedUntil != null && previous.lockedUntil.getTime() > t) {
    // Ainda bloqueado (tentativas durante o bloqueio nem chegam aqui; por garantia, nada muda).
    return { ...previous, justLocked: false }
  }
  const windowExpired =
    previous === null || previous.lockedUntil !== null || previous.windowStartedAt.getTime() + LOGIN_WINDOW_MS <= t
  const failures = windowExpired ? 1 : previous.failures + 1
  const windowStartedAt = windowExpired ? now : previous.windowStartedAt
  if (failures >= LOGIN_MAX_FAILURES) {
    return { failures, windowStartedAt, lockedUntil: new Date(t + LOGIN_LOCK_MS), justLocked: true }
  }
  return { failures, windowStartedAt, lockedUntil: null, justLocked: false }
}

/** Até quando a conta está bloqueada, ou `null`. */
export async function lockedUntil(db: ThrottleDb, key: string, now: Date): Promise<Date | null> {
  const [row] = await db
    .select({ lockedUntil: authLoginThrottle.lockedUntil })
    .from(authLoginThrottle)
    .where(eq(authLoginThrottle.key, key))
    .limit(1)
  const until = row?.lockedUntil ?? null
  return until !== null && until.getTime() > now.getTime() ? until : null
}

/**
 * Registra uma senha errada (atômico: a linha fica travada durante a conta, então tentativas em
 * paralelo não se perdem). Devolve o novo estado; `justLocked` = esta tentativa bloqueou a conta.
 */
export async function recordLoginFailure(
  db: ThrottleDb,
  key: string,
  now: Date,
): Promise<ThrottleState & { readonly justLocked: boolean }> {
  return db.transaction(async (tx) => {
    await tx
      .insert(authLoginThrottle)
      .values({ key, failures: 0, windowStartedAt: now, lockedUntil: null, updatedAt: now })
      .onConflictDoNothing({ target: authLoginThrottle.key })
    const [row] = await tx
      .select({
        failures: authLoginThrottle.failures,
        windowStartedAt: authLoginThrottle.windowStartedAt,
        lockedUntil: authLoginThrottle.lockedUntil,
      })
      .from(authLoginThrottle)
      .where(eq(authLoginThrottle.key, key))
      .for("update")
    const previous = row === undefined || row.failures === 0 ? null : row
    const next = nextThrottleState(previous, now)
    await tx
      .update(authLoginThrottle)
      .set({
        failures: next.failures,
        windowStartedAt: next.windowStartedAt,
        lockedUntil: next.lockedUntil,
        updatedAt: now,
      })
      .where(eq(authLoginThrottle.key, key))
    return next
  })
}

/** Login certo: zera a contagem da conta. */
export async function clearLoginFailures(db: ThrottleDb, key: string): Promise<void> {
  await db.delete(authLoginThrottle).where(eq(authLoginThrottle.key, key))
}

/**
 * Quanto tempo uma linha sem bloqueio ativo fica guardada depois da última mudança (24 h: cobre a maior
 * janela que usa esta tabela, a de 1 h dos pedidos de redefinição de senha em `attempts.ts`).
 */
export const THROTTLE_RETENTION_MS = 24 * 3_600_000

/**
 * Limpeza (cron diário `limpeza`, `lib/server/cron/auth-cleanup.ts`): apaga as linhas paradas há mais de
 * `THROTTLE_RETENTION_MS` e sem bloqueio em vigor. Devolve quantas apagou. Apagar antes da hora só
 * zeraria uma contagem já vencida (as janelas são de no máximo 1 h).
 */
export async function pruneLoginThrottle(db: ThrottleDb, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - THROTTLE_RETENTION_MS)
  const gone = await db
    .delete(authLoginThrottle)
    .where(sql`${authLoginThrottle.updatedAt} < ${cutoff} AND (${authLoginThrottle.lockedUntil} IS NULL OR ${authLoginThrottle.lockedUntil} < ${now})`)
    .returning({ key: authLoginThrottle.key })
  return gone.length
}
