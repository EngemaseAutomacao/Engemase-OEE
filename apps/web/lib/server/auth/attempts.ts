/**
 * Limite de tentativas dos fluxos públicos da conta (docs/15, item 15): pedido de redefinição de senha
 * (por e-mail e por IP) e envio de token "definir/redefinir senha" (por IP). Guarda a contagem na mesma
 * tabela do bloqueio de login (`auth_login_throttle`, só o papel `auth_service`), com a chave = SHA-256 de
 * `<espaço>:<valor>` — o e-mail ou IP não fica gravado e as chaves não colidem com as do login (que são o
 * SHA-256 do e-mail puro).
 *
 * Janela fixa: a partir da primeira tentativa, `max` tentativas em `windowMs`; a seguinte é recusada até
 * a janela acabar. Atômico (linha travada durante a conta).
 */
import { authLoginThrottle, sha256Hex } from "@engemase/db"
import { eq } from "drizzle-orm"
import type { ThrottleDb } from "./throttle"

export interface AttemptLimit {
  readonly max: number
  readonly windowMs: number
}

/** Pedidos de "esqueci minha senha" para o mesmo e-mail (exista ou não a conta). */
export const RESET_REQUEST_PER_EMAIL: AttemptLimit = { max: 3, windowMs: 60 * 60_000 }
/** Pedidos de "esqueci minha senha" vindos do mesmo IP. */
export const RESET_REQUEST_PER_IP: AttemptLimit = { max: 10, windowMs: 60 * 60_000 }
/** Envios de token (definir ou redefinir senha) vindos do mesmo IP. */
export const TOKEN_SUBMIT_PER_IP: AttemptLimit = { max: 20, windowMs: 15 * 60_000 }

export type AttemptSpace = "reset-email" | "reset-ip" | "token-ip"

/** Chave da contagem (SHA-256 de `<espaço>:<valor normalizado>`). */
export function attemptKey(space: AttemptSpace, value: string): string {
  return sha256Hex(`${space}:${value.trim().toLowerCase()}`)
}

export interface AttemptResult {
  readonly allowed: boolean
  /** Quando volta a aceitar (só se recusada). */
  readonly retryAt: Date | null
}

/** Conta uma tentativa e diz se ela passa. */
export async function takeAttempt(db: ThrottleDb, key: string, limit: AttemptLimit, now: Date): Promise<AttemptResult> {
  return db.transaction(async (tx) => {
    await tx
      .insert(authLoginThrottle)
      .values({ key, failures: 0, windowStartedAt: now, lockedUntil: null, updatedAt: now })
      .onConflictDoNothing({ target: authLoginThrottle.key })
    const [row] = await tx
      .select({ failures: authLoginThrottle.failures, windowStartedAt: authLoginThrottle.windowStartedAt })
      .from(authLoginThrottle)
      .where(eq(authLoginThrottle.key, key))
      .for("update")
    const t = now.getTime()
    const expired = row === undefined || row.failures === 0 || row.windowStartedAt.getTime() + limit.windowMs <= t
    const windowStartedAt = expired ? now : row.windowStartedAt
    const count = expired ? 1 : row.failures + 1
    const allowed = count <= limit.max
    const retryAt = allowed ? null : new Date(windowStartedAt.getTime() + limit.windowMs)
    await tx
      .update(authLoginThrottle)
      // A contagem para em max + 1 (não cresce sem fim com um robô insistindo).
      .set({ failures: Math.min(count, limit.max + 1), windowStartedAt, lockedUntil: retryAt, updatedAt: now })
      .where(eq(authLoginThrottle.key, key))
    return { allowed, retryAt }
  })
}
