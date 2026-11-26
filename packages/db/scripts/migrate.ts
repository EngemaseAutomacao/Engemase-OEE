/**
 * Aplica as migrações do Drizzle no Postgres (Neon) e garante os usuários de login (app e Better Auth).
 *
 *   pnpm --filter @engemase/db db:deploy   # build da Vercel (decide pelo VERCEL_ENV; ver src/deploy.ts)
 *   MIGRATION_DATABASE_URL=… pnpm --filter @engemase/db db:migrate   # manual, fora da Vercel
 *
 * - Driver `pg` com uma conexão só: o migrator do Drizzle aplica todas as migrações pendentes numa
 *   transação (nunca o de `neon-http`, que não usa transação; README do pacote).
 * - `pg_advisory_lock` evita dois builds migrando ao mesmo tempo; `lock_timeout` evita travar o site
 *   esperando um lock de tabela.
 * - Nunca imprime URL nem senha.
 */
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import {
  DeployConfigError,
  type LoginRole,
  loginRoleSql,
  MIGRATION_LOCK_KEY,
  MIN_SERVER_VERSION_NUM,
  planMigration,
} from "../src/deploy"

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url))
const log = (message: string): void => console.log(`[db] ${message}`)

async function appliedCount(client: pg.Client): Promise<number> {
  const exists = await client.query<{ ok: boolean }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok",
  )
  if (exists.rows[0]?.ok !== true) return 0
  const result = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")
  return result.rows[0]?.n ?? 0
}

/**
 * Confere que o login entra no banco com a senha e se comporta como esperado: o da aplicação assume
 * `app_user` (o que o `withTenant` faz) sem herdá-lo; o do Better Auth herda `auth_service`.
 */
async function checkLogin(ownerUrl: string, login: LoginRole): Promise<void> {
  const url = new URL(ownerUrl)
  url.username = login.user
  url.password = login.password
  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 15_000 })
  await client.connect()
  try {
    const result = await client.query<{ who: string; bypass: boolean; inherits: boolean }>(
      `SELECT session_user AS who, r.rolbypassrls AS bypass, pg_catalog.pg_has_role(session_user, $1, 'USAGE') AS inherits
       FROM pg_catalog.pg_roles r WHERE r.rolname = session_user`,
      [login.memberOf],
    )
    const row = result.rows[0]
    if (row?.who !== login.user) throw new Error(`a conexão de teste entrou como ${row?.who ?? "?"}, não como ${login.user}`)
    if (row.bypass) throw new Error(`o usuário ${login.user} não pode ter BYPASSRLS`)
    if (row.inherits !== login.inherit) {
      throw new Error(`o usuário ${login.user} ${login.inherit ? "precisa herdar" : "não pode herdar"} ${login.memberOf}`)
    }
    await client.query("BEGIN")
    await client.query(`SET LOCAL ROLE ${login.memberOf}`)
    await client.query("ROLLBACK")
  } finally {
    await client.end()
  }
}

async function main(): Promise<void> {
  const plan = planMigration(process.env)
  if (!plan.run) {
    log(`nada a fazer: ${plan.reason}`)
    return
  }
  log(`ambiente: ${plan.target}; URL de ${plan.urlSource}`)

  const client = new pg.Client({
    connectionString: plan.url,
    connectionTimeoutMillis: 30_000,
    application_name: "engemase-migrate",
  })
  await client.connect()
  try {
    const version = await client.query<{ v: string }>("SELECT current_setting('server_version_num') AS v")
    const versionNum = Number(version.rows[0]?.v)
    if (!(versionNum >= MIN_SERVER_VERSION_NUM)) {
      throw new Error(`Postgres ${versionNum} não suportado: as migrações precisam do 18 ou mais novo (uuidv7).`)
    }

    await client.query("SET lock_timeout = '15s'")
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY])
    try {
      const before = await appliedCount(client)
      await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER })
      const after = await appliedCount(client)
      log(`migrações: ${after - before} nova(s), ${after} no total`)

      for (const login of plan.logins) {
        await client.query(loginRoleSql(login))
        log(`usuário de login ${login.user} pronto (membro de ${login.memberOf})`)
      }
      if (plan.logins.length === 0) {
        log("APP_DB_PASSWORD/AUTH_DB_PASSWORD ausentes: usuários de login não foram criados/atualizados.")
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined)
    }

    const owner = await client.query<{ bypass: boolean }>(
      "SELECT rolbypassrls AS bypass FROM pg_catalog.pg_roles WHERE rolname = current_user",
    )
    log(`dono das migrações com BYPASSRLS: ${owner.rows[0]?.bypass === true ? "sim" : "não"}`)
  } finally {
    await client.end()
  }

  for (const login of plan.logins) {
    await checkLogin(plan.url, login)
    log(`conexão como ${login.user} conferida`)
  }
}

main().catch((error: unknown) => {
  // Só a mensagem: o objeto de erro do pg pode trazer a configuração da conexão.
  const message = error instanceof DeployConfigError || error instanceof Error ? error.message : String(error)
  console.error(`[db] falhou: ${message}`)
  process.exit(1)
})
