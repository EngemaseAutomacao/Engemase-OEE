/**
 * Testes de navegador (Playwright, W11): fumaça das telas principais no celular e no computador.
 * Ficam em `test/navegador/*.spec.ts` (o Vitest só pega `*.test.ts`).
 *
 *   pnpm --filter web build          # os testes rodam contra o `next start` (build de produção)
 *   pnpm --filter web test:navegador # = playwright test --trace off
 *
 * Servidor: sobe `next start` na porta PW_PORT (padrão 3100) e reaproveita um que já esteja de pé.
 * Para testar outro endereço (ex.: um preview da Vercel), defina PW_BASE_URL — aí nada é iniciado.
 *
 * Navegador: o Chromium do Playwright da mesma versão do pacote (`PLAYWRIGHT_BROWSERS_PATH`, ou
 * `playwright install chromium` no CI). Para usar outro executável, defina PW_CHROMIUM_PATH
 * (ex.: /opt/pw-browsers/chromium).
 */
import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.PW_PORT ?? "3100")
const externalBaseUrl = process.env.PW_BASE_URL?.trim()
const baseURL = externalBaseUrl !== undefined && externalBaseUrl !== "" ? externalBaseUrl : `http://127.0.0.1:${port}`
const chromiumPath = process.env.PW_CHROMIUM_PATH?.trim()
const launchOptions = chromiumPath !== undefined && chromiumPath !== "" ? { executablePath: chromiumPath } : {}

export default defineConfig({
  testDir: "./test/navegador",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  // Uma nova tentativa só no CI (a primeira página após o start pode demorar mais).
  retries: process.env.CI !== undefined ? 1 : 0,
  workers: process.env.CI !== undefined ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI !== undefined ? [["list"], ["github"]] : "list",
  use: {
    baseURL,
    // Rastro e vídeo desligados: os testes são de fumaça e o CI só precisa da saída do list.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
  projects: [
    {
      name: "celular",
      use: { ...devices["Pixel 7"], launchOptions },
    },
    {
      name: "computador",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions },
    },
  ],
  webServer:
    externalBaseUrl !== undefined && externalBaseUrl !== ""
      ? undefined
      : {
          command: `pnpm exec next start --port ${port} --hostname 127.0.0.1`,
          url: `${baseURL}/login`,
          reuseExistingServer: process.env.CI === undefined,
          timeout: 60_000,
          stdout: "ignore",
          stderr: "pipe",
          env: { NEXT_TELEMETRY_DISABLED: "1" },
        },
})
