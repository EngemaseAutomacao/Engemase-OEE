/**
 * Implantação do banco (Neon): decide se as migrações rodam neste ambiente e monta o SQL do usuário de
 * login da aplicação. Usado por `scripts/migrate.ts` (`pnpm --filter @engemase/db db:deploy`), que o
 * build da Vercel chama antes do `next build`.
 *
 * Sem dependências internas de propósito: o script roda direto no Node (remoção de tipos nativa, Node 22.18+),
 * que não resolve imports sem extensão.
 *
 * Regras:
 * - **Produção** (`VERCEL_ENV=production`): migra sempre, antes de o deploy entrar no ar. Se falhar, o build
 *   falha e o site continua na versão anterior. As migrações precisam ser compatíveis com o código anterior
 *   (expand → migrate → contract, docs/06).
 * - **Preview**: só migra com `DB_MIGRATE_PREVIEW=1`, que só deve ser ligado quando cada preview tiver o
 *   próprio branch da Neon. Sem isso o preview aponta para o banco de produção, e migração de branch não
 *   revisado não pode chegar lá.
 * - **Fora da Vercel** (comando manual `pnpm db:migrate`): migra o banco da URL informada.
 */

/** Usuário de login padrão da aplicação (membro de `app_user`, sem outros poderes). */
export const DEFAULT_APP_DB_USER = "app_login"

/** Chave do `pg_advisory_lock` que impede duas migrações ao mesmo tempo (dois builds de produção). */
export const MIGRATION_LOCK_KEY = 4_281_337_001

/** Versão mínima do Postgres: as migrações usam `uuidv7()` nativo (Postgres 18). */
export const MIN_SERVER_VERSION_NUM = 180_000

const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/
/** Só caracteres seguros em URL e em literal SQL; 32+ dá folga sobre a exigência de entropia da Neon. */
const PASSWORD_RE = /^[A-Za-z0-9._~-]{32,128}$/
const RESERVED_ROLES = new Set(["app_user", "auth_service", "app_lookup", "postgres", "neondb_owner"])

export type DeployEnv = Readonly<Record<string, string | undefined>>

export interface AppLogin {
  readonly user: string
  readonly password: string
}

export type MigrationPlan =
  | { readonly run: false; readonly reason: string }
  | {
      readonly run: true
      readonly url: string
      /** De onde veio a URL (nome da variável), para o log; nunca a URL. */
      readonly urlSource: string
      readonly target: string
      /** `null`: sem `APP_DB_PASSWORD`, o usuário de login não é criado/atualizado nesta execução. */
      readonly appLogin: AppLogin | null
    }

/** Erro de configuração da implantação (mensagem em português, sem segredos). */
export class DeployConfigError extends Error {
  override readonly name = "DeployConfigError"
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === "" ? undefined : trimmed
}

/** Usuário de login da aplicação a partir de `APP_DB_USER`/`APP_DB_PASSWORD`, validados. */
export function readAppLogin(env: DeployEnv): AppLogin | null {
  const password = nonEmpty(env.APP_DB_PASSWORD)
  if (password === undefined) return null
  const user = nonEmpty(env.APP_DB_USER) ?? DEFAULT_APP_DB_USER
  if (!ROLE_RE.test(user) || RESERVED_ROLES.has(user)) {
    throw new DeployConfigError(
      `APP_DB_USER inválido: use letras minúsculas, números e _ (até 63), e não um papel reservado (${[...RESERVED_ROLES].join(", ")}).`,
    )
  }
  if (!PASSWORD_RE.test(password)) {
    throw new DeployConfigError(
      "APP_DB_PASSWORD inválida: use de 32 a 128 caracteres entre letras, números e . _ ~ - (ex.: openssl rand -base64 33 | tr '+/' '-_').",
    )
  }
  return { user, password }
}

/** Decide se as migrações rodam e com qual URL (de dono, sem pooler). */
export function planMigration(env: DeployEnv): MigrationPlan {
  const vercelEnv = nonEmpty(env.VERCEL_ENV)
  const onVercel = vercelEnv !== undefined

  if (vercelEnv === "preview" && env.DB_MIGRATE_PREVIEW !== "1") {
    return {
      run: false,
      reason:
        "preview sem DB_MIGRATE_PREVIEW=1: migrações não rodam (sem branch próprio da Neon, o preview aponta para o banco de produção).",
    }
  }
  if (vercelEnv === "development") {
    return { run: false, reason: "VERCEL_ENV=development: migrações não rodam no build de desenvolvimento." }
  }

  const sources = ["MIGRATION_DATABASE_URL", "DATABASE_URL_UNPOOLED", "DATABASE_URL"] as const
  const urlSource = sources.find((name) => nonEmpty(env[name]) !== undefined)
  if (urlSource === undefined) {
    if (onVercel) {
      return { run: false, reason: "sem DATABASE_URL_UNPOOLED/DATABASE_URL: banco não configurado neste ambiente." }
    }
    throw new DeployConfigError("Informe a URL de dono do banco em MIGRATION_DATABASE_URL (sem pooler).")
  }

  return {
    run: true,
    url: nonEmpty(env[urlSource]) as string,
    urlSource,
    target: vercelEnv ?? "manual",
    appLogin: readAppLogin(env),
  }
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * SQL idempotente que cria (ou atualiza a senha de) o usuário de login da aplicação e o põe em `app_user`.
 * Roda como o dono das migrações, que criou `app_user` (e por isso pode concedê-lo). O usuário não herda
 * nada além de `app_user`: sem BYPASSRLS, sem CREATEROLE, sem CREATEDB.
 */
export function appLoginSql(login: AppLogin): string {
  // Validados de novo aqui: o SQL leva o nome e a senha como texto (CREATE ROLE não aceita parâmetros).
  if (!ROLE_RE.test(login.user) || RESERVED_ROLES.has(login.user) || !PASSWORD_RE.test(login.password)) {
    throw new DeployConfigError("Usuário ou senha do login da aplicação inválidos.")
  }
  const role = quoteIdent(login.user)
  const roleLiteral = quoteLiteral(login.user)
  const password = quoteLiteral(login.password)
  // O texto não leva `$` (nome e senha validados acima), então o corpo entre $$ não tem como fechar antes.
  // No ALTER, só login e senha: sem superusuário (Neon), mexer em SUPERUSER/BYPASSRLS/REPLICATION é recusado
  // mesmo para tirar; por isso um papel já existente com poderes demais faz a implantação falhar.
  return `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ${roleLiteral}) THEN
    CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${password};
  ELSE
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ${roleLiteral}
        AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
    ) THEN
      RAISE EXCEPTION 'O usuário de login da aplicação já existe com poderes demais (superusuário, BYPASSRLS, CREATEROLE, CREATEDB ou REPLICATION).';
    END IF;
    ALTER ROLE ${role} LOGIN PASSWORD ${password};
  END IF;
  IF NOT pg_catalog.pg_has_role(${roleLiteral}, 'app_user', 'MEMBER') THEN
    GRANT app_user TO ${role};
  END IF;
END
$$;`
}
