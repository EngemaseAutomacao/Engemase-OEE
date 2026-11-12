import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    // Mesmo alias do tsconfig ("@/lib/..."), sem pegar os pacotes "@engemase/*".
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) }],
  },
  test: {
    include: ["test/**/*.test.ts"],
    // O PGlite (Postgres em WASM) leva alguns segundos para subir e aplicar as migrações.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Fuso exótico: nada pode depender do fuso local do processo.
    env: { TZ: "Pacific/Chatham" },
  },
})
