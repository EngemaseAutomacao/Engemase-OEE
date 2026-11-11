import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Fixa o fuso do processo em algo exótico para garantir que nada dependa do relógio/fuso local.
    env: { TZ: "Pacific/Chatham" },
  },
});
