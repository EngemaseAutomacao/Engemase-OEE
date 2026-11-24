/**
 * Variáveis de ambiente do login (W5). Sem dependências: também é usado pelo `proxy.ts`.
 *
 * - `AUTH_ENFORCED`: `true`/`1` exige login nas telas do sistema; `false`/`0` deixa o protótipo
 *   navegável sem login. **Padrão seguro:** sem a variável, exige login quando `NODE_ENV=production`
 *   (build da Vercel, `next start`) e não exige no `next dev`.
 * - `BETTER_AUTH_SECRET`: segredo do Better Auth (cookies assinados, 2FA cifrado). Pelo menos 32
 *   caracteres; gere com `openssl rand -base64 32`. Diferente em produção, preview e local.
 * - `BETTER_AUTH_URL`: endereço canônico do app (ex.: `https://engemase-oee.vercel.app`). É a única
 *   origem confiável (docs/15, item 2: sem curinga e sem domínios de clientes).
 * - `AUTH_DATABASE_URL`: conexão do Better Auth, com um usuário membro do papel `auth_service`
 *   (packages/db/README.md). Sem ela, usa `DATABASE_URL` (só serve em banco local de desenvolvimento,
 *   com usuário dono/superusuário; em produção o usuário do `DATABASE_URL` é do `app_user` e não lê
 *   as tabelas de sessão).
 */

type Env = Readonly<Record<string, string | undefined>>

/** Login obrigatório nas telas do sistema? (ver `AUTH_ENFORCED` acima). */
export function authEnforced(env: Env = process.env): boolean {
  const raw = env.AUTH_ENFORCED?.trim().toLowerCase()
  if (raw === "true" || raw === "1") return true
  if (raw === "false" || raw === "0") return false
  return env.NODE_ENV === "production"
}

export interface AuthSettings {
  readonly secret: string
  readonly baseURL: string
}

/** Configuração do Better Auth, ou `null` se faltar alguma variável (login indisponível). */
export function authSettings(env: Env = process.env): AuthSettings | null {
  const secret = env.BETTER_AUTH_SECRET?.trim() ?? ""
  const baseURL = env.BETTER_AUTH_URL?.trim() ?? ""
  if (secret.length < 32 || baseURL === "") return null
  try {
    const url = new URL(baseURL)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return { secret, baseURL: url.origin }
  } catch {
    return null
  }
}

/** URL do banco do Better Auth (`AUTH_DATABASE_URL`, senão `DATABASE_URL`), ou `null`. */
export function authDatabaseUrl(env: Env = process.env): string | null {
  const url = env.AUTH_DATABASE_URL?.trim() || env.DATABASE_URL?.trim() || ""
  return url === "" ? null : url
}

/** Prefixo dos cookies do Better Auth (`engemase.session_token`; `__Secure-` em HTTPS). */
export const AUTH_COOKIE_PREFIX = "engemase"
