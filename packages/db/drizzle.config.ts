import { defineConfig } from "drizzle-kit"

/**
 * Configuração do drizzle-kit. Só usamos `generate` (gera SQL a partir do schema, sem banco).
 * As migrações SQL ficam em ./migrations e são commitadas e revisadas no PR (docs/06).
 * A aplicação das migrações em preview/produção é feita pelo pipeline com o migrator do Drizzle.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  // O schema `app` (funções de RLS e de contexto) é criado por migração manual; não é gerenciado pelo drizzle-kit.
  schemaFilter: ["public"],
  strict: true,
  verbose: true,
})
