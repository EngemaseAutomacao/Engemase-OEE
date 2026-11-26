/**
 * Implantação do banco (Neon): decide se as migrações rodam neste ambiente e monta o SQL dos usuários de
 * login. Usado por `scripts/migrate.ts` (`pnpm --filter @engemase/db db:migrate`), que o build da Vercel
 * chama antes do `next build` (apps/web/vercel.json).
 *
 * Regras:
 * - **Produção** (`VERCEL_ENV=production`): migra sempre, antes de o deploy entrar no ar. Se falhar, o build
 *   falha e o site continua na versão anterior. As migrações precisam ser compatíveis com o código anterior
 *   (expand → migrate → contract, docs/06).
 * - **Preview**: só migra com `DB_MIGRATE_PREVIEW=1`, que só deve ser ligado quando cada preview tiver o
 *   próprio branch da Neon. Sem isso o preview aponta para o banco de produção, e migração de branch não
 *   revisado não pode chegar lá.
 * - **Demonstração** (`ENGEMASE_DEMONSTRACAO=1`): nunca migra, mesmo com URL no ambiente.
 * - **Fora da Vercel** (comando manual): migra o banco da URL informada.
 *
 * Usuários de login (criados/atualizados só quando a senha está no ambiente):
 * - `app_login` (`APP_DB_USER`/`APP_DB_PASSWORD`): NOINHERIT, membro de `app_user` só com SET. A camada de
 *   acesso sempre roda em `withTenant` (`SET LOCAL ROLE app_user`); fora dela, o login não lê nada.
 * - `auth_login` (`AUTH_DB_USER`/`AUTH_DB_PASSWORD`): HERDA `auth_service`, porque o Better Auth não troca
 *   de papel por consulta.
 */

/** Chave do `pg_advisory_lock` que impede duas migrações ao mesmo tempo (dois builds de produção). */
export const MIGRATION_LOCK_KEY = 4_281_337_001

/** Versão mínima do Postgres: as migrações usam `uuidv7()` nativo (Postgres 18). */
export const MIN_SERVER_VERSION_NUM = 180_000

/** Os usuários de login que a implantação gerencia. */
export const LOGIN_KINDS = {
  app: { userVar: "APP_DB_USER", passwordVar: "APP_DB_PASSWORD", defaultUser: "app_login", memberOf: "app_user", inherit: false },
  auth: { userVar: "AUTH_DB_USER", passwordVar: "AUTH_DB_PASSWORD", defaultUser: "auth_login", memberOf: "auth_service", inherit: true },
} as const
export type LoginKind = keyof typeof LOGIN_KINDS

const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/
/** Só caracteres seguros em URL e em literal SQL; 32+ dá folga sobre a exigência de entropia da Neon. */
const PASSWORD_RE = /^[A-Za-z0-9._~-]{32,128}$/
const RESERVED_ROLES = new Set(["app_user", "auth_service", "app_lookup", "postgres", "neondb_owner", "neon_superuser"])

export type DeployEnv = Readonly<Record<string, string | undefined>>

export interface LoginRole {
  readonly kind: LoginKind
  readonly user: string
  readonly password: string
  /** Papel do banco de que o login é membro (`app_user` ou `auth_service`). */
  readonly memberOf: string
  /** Herda os privilégios do papel (sem precisar de SET ROLE)? */
  readonly inherit: boolean
}

export type MigrationPlan =
  | { readonly run: false; readonly reason: string }
  | {
      readonly run: true
      readonly url: string
      /** De onde veio a URL (nome da variável), para o log; nunca a URL. */
      readonly urlSource: string
      readonly target: string
      /** Logins com senha no ambiente; os sem senha não são criados/atualizados nesta execução. */
      readonly logins: readonly LoginRole[]
    }

/** Erro de configuração da implantação (mensagem em português, sem segredos). */
export class DeployConfigError extends Error {
  override readonly name = "DeployConfigError"
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === "" ? undefined : trimmed
}

function validLogin(user: string, password: string): boolean {
  return ROLE_RE.test(user) && !RESERVED_ROLES.has(user) && PASSWORD_RE.test(password)
}

/** Usuário de login de um tipo, a partir do ambiente (validado), ou `null` sem senha. */
export function readLogin(env: DeployEnv, kind: LoginKind): LoginRole | null {
  const spec = LOGIN_KINDS[kind]
  const password = nonEmpty(env[spec.passwordVar])
  if (password === undefined) return null
  const user = nonEmpty(env[spec.userVar]) ?? spec.defaultUser
  if (!ROLE_RE.test(user) || RESERVED_ROLES.has(user)) {
    throw new DeployConfigError(
      `${spec.userVar} inválido: use letras minúsculas, números e _ (até 63), e não um papel reservado (${[...RESERVED_ROLES].join(", ")}).`,
    )
  }
  if (!PASSWORD_RE.test(password)) {
    throw new DeployConfigError(
      `${spec.passwordVar} inválida: use de 32 a 128 caracteres entre letras, números e . _ ~ - (ex.: openssl rand -base64 33 | tr '+/' '-_').`,
    )
  }
  return { kind, user, password, memberOf: spec.memberOf, inherit: spec.inherit }
}

/** Todos os logins com senha no ambiente. Falha se dois tipos usarem o mesmo usuário. */
export function readLogins(env: DeployEnv): LoginRole[] {
  const logins = (Object.keys(LOGIN_KINDS) as LoginKind[])
    .map((kind) => readLogin(env, kind))
    .filter((login): login is LoginRole => login !== null)
  if (new Set(logins.map((login) => login.user)).size !== logins.length) {
    throw new DeployConfigError("APP_DB_USER e AUTH_DB_USER precisam ser usuários diferentes.")
  }
  return logins
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
  if (nonEmpty(env.ENGEMASE_DEMONSTRACAO) === "1") {
    return { run: false, reason: "ambiente de demonstração (ENGEMASE_DEMONSTRACAO=1): sem banco, nada a migrar." }
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
    logins: readLogins(env),
  }
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * SQL idempotente que cria (ou atualiza a senha de) um usuário de login e o põe no papel dele. Roda como o
 * dono das migrações, que criou os papéis (e por isso pode concedê-los). O login não tem outros poderes:
 * sem BYPASSRLS, CREATEROLE, CREATEDB nem REPLICATION.
 */
export function loginRoleSql(login: LoginRole): string {
  // Validados de novo aqui: o SQL leva o nome e a senha como texto (CREATE ROLE não aceita parâmetros).
  if (!validLogin(login.user, login.password) || !(login.memberOf === "app_user" || login.memberOf === "auth_service")) {
    throw new DeployConfigError("Usuário, senha ou papel do login inválidos.")
  }
  const role = quoteIdent(login.user)
  const roleLiteral = quoteLiteral(login.user)
  const password = quoteLiteral(login.password)
  const inherit = login.inherit ? "INHERIT" : "NOINHERIT"
  const grantInherit = login.inherit ? "TRUE" : "FALSE"
  // O texto não leva `$` (nome e senha validados acima), então o corpo entre $$ não tem como fechar antes.
  // No ALTER, só login, herança e senha: sem superusuário (Neon), mexer em SUPERUSER/BYPASSRLS/REPLICATION é
  // recusado mesmo para tirar; por isso um papel já existente com poderes demais faz a implantação falhar.
  // O GRANT roda sempre: numa segunda vez só reafirma as opções (INHERIT/SET) da concessão.
  return `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ${roleLiteral}) THEN
    CREATE ROLE ${role} LOGIN ${inherit} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${password};
  ELSE
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ${roleLiteral}
        AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
    ) THEN
      RAISE EXCEPTION 'O usuário de login ${login.user} já existe com poderes demais (superusuário, BYPASSRLS, CREATEROLE, CREATEDB ou REPLICATION).';
    END IF;
    ALTER ROLE ${role} LOGIN ${inherit} PASSWORD ${password};
  END IF;
  GRANT ${login.memberOf} TO ${role} WITH INHERIT ${grantInherit}, SET TRUE;
END
$$;`
}
