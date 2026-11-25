/**
 * "Definir senha" com o token próprio de uso único (docs/15, seção 5 e item 1): o link do convite (ou do
 * seed de plataforma) leva o token no fragmento; a tela manda token + senha nova para a Server Action, que
 * chama `setPasswordWithToken`.
 *
 * 1. política da senha (12+ caracteres, fora de vazamentos) ANTES de gastar o token;
 * 2. hash do token → `app.resolve_account_token` (só token não usado e no prazo) → cliente do token;
 * 3. sob a RLS desse cliente, marca o token como usado (`UPDATE ... WHERE used_at IS NULL`: dois envios ao
 *    mesmo tempo, só um passa) e pega a pessoa;
 * 4. no banco do login (`auth_service`): grava a senha (hash do Better Auth), confirma o e-mail (o link
 *    provou a posse), derruba sessões antigas e zera o bloqueio por senhas erradas. Se falhar, o token volta
 *    a valer (compensação), para a pessoa tentar de novo;
 * 5. auditoria no cliente (`user.password_set`).
 *
 * O banco do app e o do login são conexões diferentes em produção (papéis `app_user` e `auth_service`), por
 * isso não há uma transação única; a ordem acima nunca deixa senha gravada com token ainda válido, exceto se
 * a compensação falhar (registrado no log).
 */
import { ACCOUNT_TOKEN_PATTERN, accountToken, auditLog, resolveByTokenHash, sha256Hex, user, withTenant } from "@engemase/db"
import { and, eq, gt, isNull, sql } from "drizzle-orm"
import { type GatewayDb, rowsExecutor } from "@/lib/server/gateway/types"
import type { Auth } from "./auth"
import { isPasswordPwned, newPasswordError } from "./password"
import { clearLoginFailures, type ThrottleDb, throttleKey } from "./throttle"

export interface SetPasswordDeps {
  /** Banco do app (`app_user`, RLS). */
  readonly db: GatewayDb
  /** Banco do login (`auth_service`). */
  readonly authDb: ThrottleDb
  readonly auth: Auth
  readonly now: Date
  readonly pwned?: (password: string) => Promise<boolean | null>
}

export type SetPasswordResult =
  | { readonly status: "ok"; readonly email: string }
  | { readonly status: "invalid_token" }
  | { readonly status: "password_rejected"; readonly message: string }

/** Token → (id, cliente), antes de saber o cliente (função SECURITY DEFINER, papel `app_user`). */
async function resolveToken(db: GatewayDb, tokenHash: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`)
    return resolveByTokenHash(rowsExecutor(tx), "accountToken", tokenHash)
  })
}

export async function setPasswordWithToken(
  deps: SetPasswordDeps,
  input: { readonly token: string; readonly password: string },
): Promise<SetPasswordResult> {
  if (!ACCOUNT_TOKEN_PATTERN.test(input.token)) return { status: "invalid_token" }
  const policy = await newPasswordError(input.password, deps.pwned ?? isPasswordPwned)
  if (policy !== null) return { status: "password_rejected", message: policy }

  const ref = await resolveToken(deps.db, sha256Hex(input.token))
  if (ref === null) return { status: "invalid_token" }
  const { now } = deps

  const userId = await withTenant(deps.db, ref.organizationId, async (tx) => {
    const [row] = await tx
      .update(accountToken)
      .set({ usedAt: now })
      .where(
        and(
          eq(accountToken.id, ref.id),
          eq(accountToken.purpose, "set_password"),
          isNull(accountToken.usedAt),
          gt(accountToken.expiresAt, now),
        ),
      )
      .returning({ userId: accountToken.userId })
    return row?.userId ?? null
  })
  if (userId === null) return { status: "invalid_token" }

  const release = () =>
    withTenant(deps.db, ref.organizationId, (tx) =>
      tx.update(accountToken).set({ usedAt: null }).where(eq(accountToken.id, ref.id)),
    ).catch((error: unknown) => console.error("[definir-senha] não devolveu o token depois de uma falha", error))

  let email: string
  let name: string
  try {
    const [person] = await deps.authDb
      .select({ email: user.email, name: user.name, banned: user.banned })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    // Pessoa bloqueada: o link não serve (e o token volta, sem efeito, até vencer).
    if (person === undefined || person.banned) {
      await release()
      return { status: "invalid_token" }
    }
    email = person.email
    name = person.name
    const ctx = await deps.auth.$context
    const hashed = await ctx.password.hash(input.password)
    await ctx.internalAdapter.deleteUserSessions(userId)
    if ((await ctx.internalAdapter.findCredentialAccount(userId)) === null) {
      await ctx.internalAdapter.createAccount({ userId, providerId: "credential", accountId: userId, password: hashed })
    } else {
      await ctx.internalAdapter.updatePassword(userId, hashed)
    }
    await deps.authDb.update(user).set({ emailVerified: true, updatedAt: now }).where(eq(user.id, userId))
    await clearLoginFailures(deps.authDb, throttleKey(email))
  } catch (error) {
    await release()
    throw error
  }

  await withTenant(deps.db, ref.organizationId, (tx) =>
    tx.insert(auditLog).values({
      organizationId: ref.organizationId,
      actorType: "user",
      actorId: userId,
      actorLabel: name,
      action: "user.password_set",
      entityType: "user",
      entityId: userId,
      after: { via: "set_password_token", token_id: ref.id },
      at: now,
    }),
  ).catch((error: unknown) => console.error("[definir-senha] senha gravada, mas a auditoria falhou", error))

  return { status: "ok", email }
}
