/**
 * `pnpm --filter @engemase/db db:seed` — aplica as migrações e grava o seed sintético (dados de
 * demonstração) no banco de `DATABASE_URL`. Para Postgres LOCAL (Docker) e para o branch-semente da Neon,
 * de onde saem os branches de preview. NUNCA em produção:
 *
 *   ENGEMASE_SEED=sintetico DATABASE_URL=postgres://postgres:postgres@localhost:5432/engemase \
 *     pnpm --filter @engemase/db db:seed [-- --dias 7] [-- --sem-migrar]
 *
 * Proteções: exige `ENGEMASE_SEED=sintetico`; recusa `VERCEL_ENV`/`NODE_ENV` = production; recusa banco
 * com cliente que não seja de demonstração (slug sem `demo-`) e conexão sem SUPERUSER/BYPASSRLS.
 * Usa `pg` (transação de verdade): as migrações rodam numa transação só, como no pipeline.
 */
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { assertSeedAllowed, SeedRefusedError, seedSynthetic } from "../src/seed/index"

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url))

async function main(): Promise<void> {
  const { values } = parseArgs({
    // O pnpm repassa o "--" de `pnpm db:seed -- --dias 3`.
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: { dias: { type: "string", default: "7" }, "sem-migrar": { type: "boolean", default: false } },
  })
  assertSeedAllowed(process.env)
  const url = process.env.DATABASE_URL
  if (url === undefined || url === "") throw new SeedRefusedError("Defina DATABASE_URL (banco local ou branch-semente).")
  const days = Number(values.dias)

  const pool = new pg.Pool({ connectionString: url, max: 1 })
  try {
    const db = drizzle({ client: pool })
    if (!values["sem-migrar"]) {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
      console.log("Migrações aplicadas.")
    }
    const result = await seedSynthetic(db, { days })
    console.log(
      `Seed sintético gravado: ${result.organizations.map((o) => o.slug).join(", ")} ` +
        `(${result.productionMinutes} minutos, ${result.stateEvents} eventos de estado gerados; repetidos foram ignorados).`,
    )
    for (const g of result.gatewayTokens) {
      // Token de DEMONSTRAÇÃO, só deste banco: serve para apontar o simulador (plc-sim + agente) para ele.
      console.log(`Token do gateway de ${g.slug} (${g.gatewayId}): ${g.token}`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof SeedRefusedError ? error.message : error)
  process.exitCode = 1
})
