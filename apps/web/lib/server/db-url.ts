/**
 * Endereços do banco para cada papel. Sem dependências: também é usado por `lib/data/fonte.ts` e
 * `lib/server/auth/env.ts`.
 *
 * Na Vercel, a integração da Neon cria `DATABASE_URL` (com pooler) e `DATABASE_URL_UNPOOLED` (direto),
 * as duas com o DONO das tabelas, que não pode ser usado pelo app (passa por cima da separação de
 * papéis). Por isso o app troca usuário e senha pelos logins criados pelo `db:migrate` no build de
 * produção (packages/db/README.md, "Implantação"):
 *
 * | Uso | Ordem |
 * |---|---|
 * | App (`app_user`) | `APP_DATABASE_URL` → `DATABASE_URL` com `APP_DB_USER` (padrão `app_login`) e `APP_DB_PASSWORD` → fora da Vercel, `DATABASE_URL` |
 * | Better Auth (`auth_service`) | `AUTH_DATABASE_URL` → `DATABASE_URL` com `AUTH_DB_USER` (padrão `auth_login`) e `AUTH_DB_PASSWORD` → fora da Vercel, `DATABASE_URL` |
 * | Manutenção (dono, DDL das partições) | `DATABASE_MAINTENANCE_URL` → `DATABASE_URL_UNPOOLED` |
 *
 * Na Vercel, sem o endereço próprio ou a senha, o app e o login ficam sem banco (`null`): as telas seguem
 * com os dados simulados e a API dos gateways responde 503, em vez de conectar como o dono.
 * Fora da Vercel (dev, testes) o `DATABASE_URL` vale como está.
 *
 * **Ambiente de demonstração** (`ENGEMASE_DEMONSTRACAO=1`, projeto `engemase-oee-demo` na Vercel): todos os
 * endereços são `null`, mesmo que alguém ligue um banco ao projeto. As telas usam só os dados simulados.
 */

type Env = Readonly<Record<string, string | undefined>>

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === "" ? undefined : trimmed
}

/** Ambiente de demonstração (só dados simulados, nunca banco)? */
export function modoDemonstracao(env: Env = process.env): boolean {
  return nonEmpty(env.ENGEMASE_DEMONSTRACAO) === "1"
}

function loginUrl(
  env: Env,
  explicitVar: string,
  userVar: string,
  defaultUser: string,
  passwordVar: string,
): string | null {
  if (modoDemonstracao(env)) return null
  const explicit = nonEmpty(env[explicitVar])
  if (explicit !== undefined) return explicit

  const base = nonEmpty(env.DATABASE_URL)
  const password = nonEmpty(env[passwordVar])
  if (base !== undefined && password !== undefined) {
    try {
      const url = new URL(base)
      url.username = nonEmpty(env[userVar]) ?? defaultUser
      url.password = password
      return url.toString()
    } catch {
      console.error(`[db] DATABASE_URL inválido: não foi possível montar o endereço com ${passwordVar}`)
      return null
    }
  }

  if (nonEmpty(env.VERCEL) !== undefined) return null
  return base ?? null
}

/** Endereço do banco da aplicação (login membro de `app_user`), ou `null`. */
export function appDatabaseUrl(env: Env = process.env): string | null {
  return loginUrl(env, "APP_DATABASE_URL", "APP_DB_USER", "app_login", "APP_DB_PASSWORD")
}

/** Endereço do banco do Better Auth (login que herda `auth_service`), ou `null`. */
export function authDatabaseUrl(env: Env = process.env): string | null {
  return loginUrl(env, "AUTH_DATABASE_URL", "AUTH_DB_USER", "auth_login", "AUTH_DB_PASSWORD")
}

/** Endereço de manutenção (dono das tabelas, conexão direta), ou `null`. */
export function maintenanceDatabaseUrl(env: Env = process.env): string | null {
  if (modoDemonstracao(env)) return null
  return nonEmpty(env.DATABASE_MAINTENANCE_URL) ?? nonEmpty(env.DATABASE_URL_UNPOOLED) ?? null
}
