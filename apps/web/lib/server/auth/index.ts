/**
 * Instância do Better Auth do app, criada sob demanda (nada conecta no build nem na importação).
 * `null` quando faltam `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` ou o banco: o login responde
 * "indisponível" e, com `AUTH_ENFORCED=false`, o protótipo segue em modo demonstração.
 */
import { getAuthDb } from "@/lib/server/db"
import { type Auth, createAuth } from "./auth"
import { authSettings } from "./env"

let cached: { readonly key: string; readonly auth: Auth } | undefined

export function getAuth(): Auth | null {
  const settings = authSettings()
  const db = getAuthDb()
  if (settings === null || db === null) return null
  const key = `${settings.baseURL}|${settings.secret}`
  if (cached?.key !== key) cached = { key, auth: createAuth({ db, secret: settings.secret, baseURL: settings.baseURL }) }
  return cached.auth
}

export type { Auth } from "./auth"
