/**
 * A API dos gateways e as tarefas agendadas com o MESMO tipo de login de produção.
 *
 * Os outros testes conectam como `postgres` (superusuário), que tem acesso a tudo e por isso não mostra
 * falta de permissão. Em produção o app entra como `app_login`: NOINHERIT, membro de `app_user` só com
 * SET (`packages/db/src/deploy.ts`, `loginRoleSql`). Fora de uma transação com `SET LOCAL ROLE app_user`
 * esse login não tem nem USAGE no schema `app`, então toda chamada precisa assumir o papel antes.
 *
 * Aqui a sessão troca para um login criado como o da implantação (`SET SESSION AUTHORIZATION`) e chama
 * /enroll, /sync, /config (com o limitador ligado) e cada tarefa agendada. Pegou o erro de 27/11/2026:
 * `permission denied for schema app` em `app.cron_claim` nas rotinas chamadas pelo cron-job.org.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { EnrollRequest } from "@engemase/contracts"
import { handleConfig, handleEnroll, handleSync } from "@/lib/server/gateway/handlers"
import { CRON_JOBS } from "@/lib/server/cron/jobs"
import { runCronJob } from "@/lib/server/cron/runner"
import {
  configRequest,
  createTestDatabase,
  EXAMPLE_CONFIG,
  enrollRequest,
  FIXTURE_NOW,
  fixture,
  remapIds,
  seedClient,
  seedEnrollment,
  syncRequest,
  type SeededClient,
  type TestDatabase,
} from "../gateway/support"

const LOGIN = "app_login_teste"
const SECRET = "segredo-de-teste-do-cron"

/** O mesmo papel que `loginRoleSql` cria para o app (NOINHERIT; app_user só com SET). */
const LOGIN_SQL = `
  CREATE ROLE ${LOGIN} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  GRANT app_user TO ${LOGIN} WITH INHERIT FALSE, SET TRUE;
`

describe("login de produção (NOINHERIT): API dos gateways e tarefas agendadas", () => {
  let t: TestDatabase
  let client: SeededClient
  let code: string

  beforeAll(async () => {
    t = await createTestDatabase()
    client = await seedClient(t.db, { slug: "login-producao", config: remapIds(EXAMPLE_CONFIG, new Map()) })
    code = (await seedEnrollment(t.db, client)).code
    await t.client.exec(LOGIN_SQL)
    await t.client.exec(`SET SESSION AUTHORIZATION ${LOGIN}`)
  }, 60_000)

  afterAll(async () => {
    await t.client.exec("RESET SESSION AUTHORIZATION")
    await t.client.close()
  })

  it("a sessão é mesmo o login sem herança (sem acesso direto às tabelas)", async () => {
    const who = await t.client.query<{ u: string }>("SELECT current_user AS u")
    expect(who.rows[0]?.u).toBe(LOGIN)
    await expect(t.client.query("SELECT 1 FROM gateway LIMIT 1")).rejects.toThrow(/permission denied/)
  })

  it("/sync e /config autenticam o gateway e passam pelo limitador", async () => {
    const deps = { db: t.db, now: () => FIXTURE_NOW, logError: (m: string, e: unknown) => console.error(m, e) }
    const sync = await handleSync(syncRequest(fixture("sync-request.valid.health-only"), { token: client.token }), deps)
    expect(sync.status).toBe(200)
    const config = await handleConfig(configRequest({ token: client.token }), deps)
    expect(config.status).toBe(200)
  })

  it("/enroll ativa o gateway pelo código", async () => {
    const res = await handleEnroll(enrollRequest({ ...fixture<EnrollRequest>("enroll-request.valid"), code }), {
      db: t.db,
      logError: (m: string, e: unknown) => console.error(m, e),
    })
    expect(res.status).toBe(201)
  })

  it.each(CRON_JOBS.map((j) => j.name))("tarefa agendada %s roda e registra a janela", async (name) => {
    const job = CRON_JOBS.find((j) => j.name === name)
    if (job === undefined) throw new Error(`job ${name} não existe`)
    const request = new Request(`http://localhost/api/cron/${name}`, { headers: { Authorization: `Bearer ${SECRET}` } })
    const res = await runCronJob(request, job, {
      db: t.db,
      secret: SECRET,
      now: () => new Date("2026-11-27T12:10:00Z"),
      env: {},
      maintenance: null,
      logError: (m, e) => console.error(m, e),
    })
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty("error")
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ job: name })
  })
})
