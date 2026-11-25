/**
 * `pnpm --filter @engemase/db db:seed:plataforma` — grava a organização interna "Engemase Lab" e o primeiro
 * super admin (docs/15, seção 7) e mostra UMA vez o link "definir senha" dele. Roda em local, preview e
 * produção (as migrações já precisam estar aplicadas):
 *
 *   ENGEMASE_SEED=plataforma DATABASE_URL=postgres://dono:...@host/engemase \
 *   ENGEMASE_SEED_ADMIN_EMAIL=nome@engemase.com.br ENGEMASE_SEED_ADMIN_NOME="Nome Sobrenome" \
 *   BETTER_AUTH_URL=https://engemase-oee.vercel.app \
 *     pnpm --filter @engemase/db db:seed:plataforma
 *
 * Em produção, também `ENGEMASE_SEED_PRODUCAO=confirmo`. Proteções em src/seed/platform.ts. O link vale 24 h:
 * entregue à pessoa por um canal seguro e não cole em chamado, chat ou log.
 */
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import { setPasswordUrl } from "../src/account-token"
import { assertPlatformSeedAllowed, SeedRefusedError, seedPlatform } from "../src/seed/index"

async function main(): Promise<void> {
  assertPlatformSeedAllowed(process.env)
  const url = process.env.DATABASE_URL
  if (url === undefined || url === "") throw new SeedRefusedError("Defina DATABASE_URL (conexão de dono, com BYPASSRLS).")
  const baseURL = process.env.BETTER_AUTH_URL?.trim() ?? ""
  if (baseURL === "") throw new SeedRefusedError("Defina BETTER_AUTH_URL (endereço canônico do app, para o link).")
  const adminEmail = process.env.ENGEMASE_SEED_ADMIN_EMAIL ?? ""
  const adminName = process.env.ENGEMASE_SEED_ADMIN_NOME ?? ""

  const pool = new pg.Pool({ connectionString: url, max: 1 })
  try {
    const result = await seedPlatform(drizzle({ client: pool }), { adminEmail, adminName })
    console.log(
      `Engemase Lab ${result.organizationCreated ? "criada" : "já existia"} (${result.organizationId}); ` +
        `super admin ${result.adminCreated ? "criado" : "já existia"} (${result.adminUserId}).`,
    )
    if (result.setPasswordToken !== null && result.tokenExpiresAt !== null) {
      console.log(`Link "definir senha" (uso único, vale até ${result.tokenExpiresAt.toISOString()}):`)
      console.log(setPasswordUrl(baseURL, result.setPasswordToken))
    } else {
      console.log("O super admin já tem senha: nenhum link gerado (use \"Esqueci minha senha\" no login).")
    }
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof SeedRefusedError ? error.message : error)
  process.exitCode = 1
})
