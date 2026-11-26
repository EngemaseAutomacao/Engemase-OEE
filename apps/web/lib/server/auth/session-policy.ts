/**
 * Duração da sessão (L20): 12 h, renovada com o uso; "manter conectado neste dispositivo" vale até
 * 30 dias; a equipe Engemase fica sempre na regra das 12 h (sem "manter conectado").
 *
 * O Better Auth cria a sessão e confere `expires_at`; a renovação é nossa (o refresh dele está
 * desligado): a cada uso (no máximo a cada 5 min) a camada de sessão grava `last_active_at` e, nas
 * sessões de 12 h, empurra `expires_at` para agora + 12 h. Assim o próprio Better Auth também recusa
 * a sessão parada há mais de 12 h. Funções puras: testadas sem banco.
 */

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000
export const SESSION_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000
/** Intervalo mínimo entre duas gravações de "último uso" da mesma sessão. */
export const SESSION_TOUCH_MS = 5 * 60 * 1000

export interface SessionTimes {
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly lastActiveAt: Date | null
  readonly rememberMe: boolean
}

export type SessionEvaluation =
  | { readonly valid: false; readonly reason: "expired" | "idle" | "max_age" }
  | {
      readonly valid: true
      /** Gravar o uso agora? (`expiresAt` novo, quando a sessão é de 12 h renovável). */
      readonly touch: { readonly lastActiveAt: Date; readonly expiresAt: Date } | null
    }

/** "Manter conectado" vale para esta pessoa? Nunca para a equipe Engemase. */
export function rememberAllowed(isPlatformStaff: boolean): boolean {
  return !isPlatformStaff
}

/** Vencimento de uma sessão recém-criada. */
export function initialExpiry(rememberMe: boolean, now: Date): Date {
  return new Date(now.getTime() + (rememberMe ? SESSION_REMEMBER_MS : SESSION_IDLE_MS))
}

/**
 * A sessão ainda vale agora? `isPlatformStaff` reforça a regra da Engemase mesmo se uma sessão
 * antiga tiver `remember_me` ligado (ex.: a pessoa virou equipe Engemase depois do login).
 */
export function evaluateSession(times: SessionTimes, isPlatformStaff: boolean, now: Date): SessionEvaluation {
  const t = now.getTime()
  if (times.expiresAt.getTime() <= t) return { valid: false, reason: "expired" }
  const remember = times.rememberMe && rememberAllowed(isPlatformStaff)
  const lastUse = (times.lastActiveAt ?? times.createdAt).getTime()
  if (remember) {
    if (times.createdAt.getTime() + SESSION_REMEMBER_MS <= t) return { valid: false, reason: "max_age" }
  } else if (lastUse + SESSION_IDLE_MS <= t) {
    return { valid: false, reason: "idle" }
  }
  if (t - lastUse < SESSION_TOUCH_MS) return { valid: true, touch: null }
  const expiresAt = remember ? times.expiresAt : new Date(t + SESSION_IDLE_MS)
  return { valid: true, touch: { lastActiveAt: now, expiresAt } }
}
