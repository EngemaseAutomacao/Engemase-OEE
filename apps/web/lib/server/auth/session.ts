/**
 * Sessão da pessoa (sem Next.js): lê a sessão do Better Auth pelo cookie, aplica a regra de duração
 * (L20, `session-policy.ts`) e devolve a pessoa no formato da camada de acesso (`SessionUser`).
 *
 * - sessão vencida, parada há 12 h (ou além dos 30 dias do "manter conectado") ou de pessoa
 *   bloqueada: é APAGADA no banco e tratada como "sem login";
 * - a cada uso (no máximo a cada 5 min) grava `last_active_at` e renova o vencimento das sessões de 12 h.
 */
import { PLATFORM_ROLES, session as sessionTable } from "@engemase/db"
import { eq } from "drizzle-orm"
import type { SessionUser } from "@/lib/server/access/context"
import type { Auth } from "./auth"
import { evaluateSession } from "./session-policy"
import type { ThrottleDb } from "./throttle"

export interface CurrentSession {
  readonly sessionId: string
  readonly user: SessionUser
  readonly rememberMe: boolean
  readonly expiresAt: Date
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/** Sessão válida do pedido (cookies em `headers`), ou `null`. */
export async function readSession(auth: Auth, db: ThrottleDb, headers: Headers, now: Date): Promise<CurrentSession | null> {
  const result = await auth.api.getSession({ headers, query: { disableCookieCache: true } })
  if (result === null) return null
  const s = result.session as typeof result.session & { rememberMe?: unknown; lastActiveAt?: unknown }
  const u = result.user as typeof result.user & { role?: unknown; banned?: unknown; twoFactorEnabled?: unknown }

  const role = typeof u.role === "string" ? u.role : null
  const banned = u.banned === true
  const staff = role !== null && (PLATFORM_ROLES as readonly string[]).includes(role)
  const createdAt = asDate(s.createdAt) ?? now
  const expiresAt = asDate(s.expiresAt) ?? now
  const rememberMe = s.rememberMe === true

  const evaluation = banned
    ? ({ valid: false, reason: "expired" } as const)
    : evaluateSession({ createdAt, expiresAt, lastActiveAt: asDate(s.lastActiveAt), rememberMe }, staff, now)
  if (!evaluation.valid) {
    await db.delete(sessionTable).where(eq(sessionTable.id, s.id))
    return null
  }
  let currentExpiry = expiresAt
  if (evaluation.touch !== null) {
    await db
      .update(sessionTable)
      .set({ lastActiveAt: evaluation.touch.lastActiveAt, expiresAt: evaluation.touch.expiresAt, updatedAt: now })
      .where(eq(sessionTable.id, s.id))
    currentExpiry = evaluation.touch.expiresAt
  }
  return {
    sessionId: s.id,
    rememberMe: rememberMe && !staff,
    expiresAt: currentExpiry,
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      role,
      banned,
      twoFactorEnabled: u.twoFactorEnabled === true,
    },
  }
}
