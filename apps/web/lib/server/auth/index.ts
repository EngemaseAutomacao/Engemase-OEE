/**
 * Instância do Better Auth do app, criada sob demanda (nada conecta no build nem na importação).
 * `null` quando faltam `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` ou o banco: o login responde
 * "indisponível" e, com `AUTH_ENFORCED=false`, o protótipo segue em modo demonstração.
 *
 * Avisos por e-mail (`lib/server/email`): link de redefinição de senha e conta bloqueada por senhas
 * erradas (L20). O envio roda DEPOIS da resposta (`after` do Next.js): o tempo da resposta não muda
 * entre e-mail que existe e que não existe, e uma falha no envio não atrapalha o login.
 */
import { after } from "next/server"
import { getAuthDb } from "@/lib/server/db"
import { getEmailSender, sendSafely } from "@/lib/server/email"
import { resetPasswordEmail } from "@/lib/server/email/templates"
import { type Auth, createAuth } from "./auth"
import { authSettings } from "./env"
import { lockNotifier } from "./lock-notice"

let cached: { readonly key: string; readonly auth: Auth } | undefined

export function getAuth(): Auth | null {
  const settings = authSettings()
  const db = getAuthDb()
  if (settings === null || db === null) return null
  const key = `${settings.baseURL}|${settings.secret}`
  if (cached?.key !== key) {
    const defer = (task: () => Promise<unknown>) => after(task)
    cached = {
      key,
      auth: createAuth({
        db,
        secret: settings.secret,
        baseURL: settings.baseURL,
        onLock: lockNotifier(db, settings.baseURL, defer),
        sendResetPassword: ({ user: target, url, expiresInMs }) => {
          defer(() =>
            sendSafely(
              getEmailSender(),
              resetPasswordEmail({ to: target.email, name: target.name, url, ttlMs: expiresInMs }),
              "redefinição de senha",
            ),
          )
        },
      }),
    }
  }
  return cached.auth
}

export type { Auth } from "./auth"
