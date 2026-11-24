/**
 * Tarefas agendadas (lib/server/cron): segredo, janela única, os 5 jobs da L17 contra o PGlite com
 * as migrações e a RLS, e o `vercel.json` em dia com a lista de jobs.
 */
import { existsSync, readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { CRON_JOBS } from "@/lib/server/cron/jobs"
import { type CronDeps, type CronJob, cronAuthorized, runCronJob } from "@/lib/server/cron/runner"
import { localDay, minuteWindow } from "@/lib/server/cron/windows"
import { count, createTestDatabase, EXAMPLE_CONFIG, remapIds, rows, type SeededClient, seedClient, type TestDatabase } from "../gateway/support"

const SECRET = "segredo-de-teste-com-tamanho-bom"

function job(name: string): CronJob {
  const found = CRON_JOBS.find((j) => j.name === name)
  if (found === undefined) throw new Error(`sem job ${name}`)
  return found
}

function cronRequest(authorization: string | null = `Bearer ${SECRET}`): Request {
  return new Request("http://localhost/api/cron/x", { headers: authorization === null ? {} : { Authorization: authorization } })
}

describe("tarefas agendadas", () => {
  let t: TestDatabase
  let seq = 0

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  function deps(now: Date, extra: Partial<CronDeps> = {}): CronDeps {
    return { db: t.db, secret: SECRET, now: () => now, env: {}, logError: (m, e) => { if (process.env.CRON_DEBUG) console.error(m, e) }, ...extra }
  }

  async function run(name: string, now: Date, extra: Partial<CronDeps> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await runCronJob(cronRequest(), job(name), deps(now, extra))
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  async function freshClient(): Promise<SeededClient> {
    return seedClient(t.db, { slug: `cron-${++seq}`, config: remapIds(EXAMPLE_CONFIG, new Map()) })
  }

  describe("rotas e vercel.json", () => {
    it("o vercel.json agenda exatamente os 5 jobs, cada um com a sua rota", () => {
      const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
        crons: { path: string; schedule: string }[]
      }
      expect(vercel.crons).toEqual(CRON_JOBS.map((j) => ({ path: `/api/cron/${j.name}`, schedule: j.schedule })))
      expect(CRON_JOBS.map((j) => j.name)).toEqual(["alertas", "expiracao", "vpn", "limpeza", "resumo-diario"])
      for (const j of CRON_JOBS) {
        const route = new URL(`../../app/api/cron/${j.name}/route.ts`, import.meta.url)
        expect(existsSync(route), j.name).toBe(true)
        const source = readFileSync(route, "utf8")
        expect(source).toContain(`handleCronRoute(request, "${j.name}")`)
        expect(source).toContain("export const maxDuration = 60")
      }
    })

    it("janelas: minuto, 5 e 15 min, dia em Brasília", () => {
      const at = new Date("2026-11-24T02:59:30Z")
      expect(minuteWindow(at)).toBe("2026-11-24T02:59")
      expect(minuteWindow(at, 5)).toBe("2026-11-24T02:55")
      expect(minuteWindow(at, 15)).toBe("2026-11-24T02:45")
      expect(localDay(at)).toBe("2026-11-23")
    })
  })

  describe("runner", () => {
    const noop: CronJob = { name: "teste", schedule: "* * * * *", windowKey: (now) => minuteWindow(now), lockS: 30, run: async () => ({ ok: 1 }) }

    it("segredo: ausente na configuração → 503; errado ou ausente na chamada → 401", async () => {
      const now = new Date("2026-11-24T12:00:00Z")
      expect((await runCronJob(cronRequest(), noop, deps(now, { secret: undefined }))).status).toBe(503)
      expect((await runCronJob(cronRequest(), noop, deps(now, { secret: " " }))).status).toBe(503)
      expect((await runCronJob(cronRequest(null), noop, deps(now))).status).toBe(401)
      expect((await runCronJob(cronRequest("Bearer outro"), noop, deps(now))).status).toBe(401)
      expect((await runCronJob(cronRequest(SECRET), noop, deps(now))).status).toBe(401)
      expect((await runCronJob(cronRequest(), noop, deps(now, { db: null }))).status).toBe(503)
      expect(cronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(true)
    })

    it("uma execução por janela; erro libera a janela para nova tentativa", async () => {
      const now = new Date("2026-11-24T12:01:00Z")
      const first = await runCronJob(cronRequest(), noop, deps(now))
      expect(first.status).toBe(200)
      expect(await first.json()).toMatchObject({ job: "teste", window: "2026-11-24T12:01", ok: 1 })
      const again = await runCronJob(cronRequest(), noop, deps(new Date(now.getTime() + 20_000)))
      expect(await again.json()).toMatchObject({ skipped: expect.any(String) })

      let calls = 0
      const flaky: CronJob = {
        ...noop,
        name: "instavel",
        run: async () => {
          calls++
          if (calls === 1) throw new Error("falhou")
          return { ok: calls }
        },
      }
      expect((await runCronJob(cronRequest(), flaky, deps(now))).status).toBe(500)
      const retried = await runCronJob(cronRequest(), flaky, deps(new Date(now.getTime() + 5_000)))
      expect(retried.status).toBe(200)
      expect(await retried.json()).toMatchObject({ ok: 2 })
      const [saved] = await rows<{ result: { ok: number } }>(t, "SELECT result FROM cron_run WHERE job = 'instavel'")
      expect(saved?.result.ok).toBe(2)
    })
  })

  describe("alertas", () => {
    it("gateway sem /sync há mais de 6 min abre alerta crítico (uma vez); voltar resolve", async () => {
      const client = await freshClient()
      const quiet = await freshClient()
      const now = new Date("2026-11-24T13:00:00Z")
      await t.client.query("UPDATE gateway SET last_seen_at = $2 WHERE id = $1", [client.gatewayId, new Date(now.getTime() - 7 * 60_000)])
      // Outro gateway sincronizou há 2 min: não alerta (nem cria regra no cliente dele).
      await t.client.query("UPDATE gateway SET last_seen_at = $2 WHERE id = $1", [quiet.gatewayId, new Date(now.getTime() - 2 * 60_000)])

      const first = await run("alertas", now)
      expect(first.status).toBe(200)
      expect(first.body.gateway_offline_opened).toBe(1)
      const second = await run("alertas", new Date(now.getTime() + 60_000))
      expect(second.body.gateway_offline_opened).toBe(0)

      const alerts = await rows<{ state: string; severity: string; gateway_id: string; data: Record<string, unknown> }>(
        t,
        "SELECT state, severity, gateway_id, data FROM alert_event WHERE organization_id = $1",
        [client.organizationId],
      )
      expect(alerts).toEqual([
        expect.objectContaining({ state: "open", severity: "critical", gateway_id: client.gatewayId, data: expect.objectContaining({ kind: "gateway_offline" }) }),
      ])
      expect(await count(t, "SELECT 1 FROM alert_rule WHERE organization_id = $1", [quiet.organizationId])).toBe(0)

      const back = new Date(now.getTime() + 2 * 60_000)
      await t.client.query("UPDATE gateway SET last_seen_at = $2 WHERE id = $1", [client.gatewayId, new Date(back.getTime() - 10_000)])
      const third = await run("alertas", back)
      expect(third.body.gateway_offline_resolved).toBe(1)
      const [resolved] = await rows<{ state: string; resolved_at: Date | null }>(t, "SELECT state, resolved_at FROM alert_event WHERE organization_id = $1", [
        client.organizationId,
      ])
      expect(resolved).toEqual({ state: "auto_resolved", resolved_at: back })
    })

    it("minuto reescrito resolve sozinho depois de 24 h sem reescrita nova", async () => {
      const client = await freshClient()
      const now = new Date("2026-11-25T13:00:00Z")
      const [rule] = await rows<{ id: string }>(
        t,
        `INSERT INTO alert_rule (organization_id, system_key, name, type, severity, params)
         VALUES ($1, 'minute_rewritten', 'Minuto reescrito', 'engemase_ops', 'warning', '{"autoResolveAfterH": 24}') RETURNING id`,
        [client.organizationId],
      )
      for (const [machineId, hoursAgo] of [
        [client.machineIds[0], 25],
        [client.machineIds[1], 3],
      ] as const) {
        const seen = new Date(now.getTime() - hoursAgo * 3_600_000)
        await t.client.query(
          `INSERT INTO alert_event (organization_id, rule_id, machine_id, dedup_key, severity, opened_at, last_seen_at, data)
           VALUES ($1, $2, $3, $5, 'warning', $4, $4, '{"count": 1}')`,
          [client.organizationId, rule!.id, machineId, seen, machineId],
        )
      }
      const result = await run("alertas", now)
      expect(result.body.minute_rewritten_resolved).toBe(1)
      expect(
        await rows(t, "SELECT machine_id, state FROM alert_event WHERE rule_id = $1 ORDER BY last_seen_at", [rule!.id]),
      ).toEqual([
        { machine_id: client.machineIds[0], state: "auto_resolved" },
        { machine_id: client.machineIds[1], state: "open" },
      ])
    })
  })

  describe("expiração", () => {
    it("comandos vencidos, concessões de suporte vencidas (com auditoria) e token anterior fora da janela", async () => {
      const client = await freshClient()
      const now = new Date("2026-11-24T14:00:00Z")
      const past = new Date(now.getTime() - 60_000)
      await t.client.query(
        `INSERT INTO gateway_command (organization_id, gateway_id, type, payload, status, created_at, expires_at) VALUES
         ($1, $2, 'config.reload', '{}', 'pending', $3, $4), ($1, $2, 'config.reload', '{}', 'sent', $3, $4),
         ($1, $2, 'config.reload', '{}', 'pending', $3, $5)`,
        [client.organizationId, client.gatewayId, new Date(now.getTime() - 3_600_000), past, new Date(now.getTime() + 60_000)],
      )
      await t.client.query(
        `INSERT INTO support_access_grant (organization_id, user_id, reason, starts_at, ends_at) VALUES
         ($1, $2, 'Chamado 1', $3, $4), ($1, $2, 'Chamado 2', $3, $5)`,
        [client.organizationId, client.userId, new Date(now.getTime() - 3_600_000), past, new Date(now.getTime() + 60_000)],
      )
      await t.client.query(
        "UPDATE gateway SET previous_token_hash = $2, previous_token_expires_at = $3 WHERE id = $1",
        [client.gatewayId, "a".repeat(64), past],
      )

      const result = await run("expiracao", now)
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({ commands_expired: 2, support_grants_expired: 1, previous_tokens_cleared: 1, failures: 0 })
      expect(
        await rows(t, "SELECT status, count(*)::int AS n FROM gateway_command WHERE gateway_id = $1 GROUP BY status ORDER BY status", [client.gatewayId]),
      ).toEqual([
        { status: "expired", n: 2 },
        { status: "pending", n: 1 },
      ])
      expect(await count(t, "SELECT 1 FROM support_access_grant WHERE organization_id = $1 AND status = 'expired' AND ended_at = $2", [client.organizationId, past])).toBe(1)
      expect(await count(t, "SELECT 1 FROM audit_log WHERE organization_id = $1 AND action = 'support_access_grant.expired'", [client.organizationId])).toBe(1)
      expect(await count(t, "SELECT 1 FROM gateway WHERE id = $1 AND previous_token_hash IS NULL", [client.gatewayId])).toBe(1)
    })
  })

  describe("reconciliação da VPN", () => {
    it("pedido sem decisão vence; sessão ativa vencida recebe um vpn.disable (uma vez só)", async () => {
      const client = await freshClient()
      const now = new Date("2026-11-24T15:00:00Z")
      const [undecided] = await rows<{ id: string }>(
        t,
        `INSERT INTO remote_access_session (organization_id, gateway_id, requested_by, reason, requested_duration_min, status, created_at)
         VALUES ($1, $2, $3, 'Diagnóstico', 60, 'requested', $4) RETURNING id`,
        [client.organizationId, client.gatewayId, client.userId, new Date(now.getTime() - 25 * 3_600_000)],
      )
      const other = await rows<{ id: string }>(t, `INSERT INTO "user" (name, email) VALUES ('Outro técnico', $1) RETURNING id`, [
        `outro-${seq}@example.com`,
      ])
      const [active] = await rows<{ id: string }>(
        t,
        `INSERT INTO remote_access_session (organization_id, gateway_id, requested_by, reason, requested_duration_min, status, starts_at, expires_at)
         VALUES ($1, $2, $3, 'Ajuste', 60, 'active', $4, $5) RETURNING id`,
        [client.organizationId, client.gatewayId, other[0]!.id, new Date(now.getTime() - 2 * 3_600_000), new Date(now.getTime() - 10 * 60_000)],
      )

      const result = await run("vpn", now)
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({ sessions_expired_unapproved: 1, vpn_disable_queued: 1 })
      expect(await rows(t, "SELECT id, status FROM remote_access_session WHERE organization_id = $1 ORDER BY status", [client.organizationId])).toEqual([
        { id: undecided!.id, status: "expired_unapproved" },
        { id: active!.id, status: "stopping" },
      ])
      const commands = await rows<{ type: string; payload: Record<string, unknown> }>(
        t,
        "SELECT type, payload FROM gateway_command WHERE gateway_id = $1",
        [client.gatewayId],
      )
      expect(commands).toEqual([{ type: "vpn.disable", payload: { session_id: active!.id, reason: "expired" } }])

      // Próxima janela: o comando ainda está em aberto, nada novo.
      const again = await run("vpn", new Date(now.getTime() + 15 * 60_000))
      expect(again.body).toMatchObject({ vpn_disable_queued: 0 })
      expect(await count(t, "SELECT 1 FROM gateway_command WHERE gateway_id = $1", [client.gatewayId])).toBe(1)
      expect(
        await count(t, "SELECT 1 FROM remote_access_event WHERE organization_id = $1 AND actor_type = 'system'", [client.organizationId]),
      ).toBe(2)
    })
  })

  describe("limpeza", () => {
    it("apaga histórico de saúde, comandos terminados e chaves do limitador antigos; mantém os recentes", async () => {
      const client = await freshClient()
      const now = new Date("2026-11-24T03:30:00Z")
      const old = new Date(now.getTime() - 40 * 24 * 3_600_000)
      const recent = new Date(now.getTime() - 24 * 3_600_000)
      for (const at of [old, recent]) {
        await t.client.query(
          "INSERT INTO gateway_health_sample (organization_id, gateway_id, bucket_start, first_at, last_at) VALUES ($1, $2, $3, $3, $3)",
          [client.organizationId, client.gatewayId, at],
        )
      }
      await t.client.query(
        `INSERT INTO gateway_command (organization_id, gateway_id, type, payload, status, created_at, expires_at) VALUES
         ($1, $2, 'config.reload', '{}', 'ok', $3, $4), ($1, $2, 'config.reload', '{}', 'ok', $5, $6)`,
        [
          client.organizationId,
          client.gatewayId,
          new Date(now.getTime() - 100 * 24 * 3_600_000),
          new Date(now.getTime() - 99 * 24 * 3_600_000),
          recent,
          new Date(recent.getTime() + 60_000),
        ],
      )
      await t.client.query("INSERT INTO api_rate_limit (key, tat, expires_at) VALUES ('teste:velha', $1, $1), ('teste:nova', $2, $2)", [
        old,
        new Date(now.getTime() + 60_000),
      ])

      const result = await run("limpeza", now)
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({ health_samples_deleted: 1, commands_deleted: 1, partitions: expect.stringContaining("pendente") })
      expect(Number(result.body.rate_limit_keys_deleted)).toBeGreaterThanOrEqual(1)
      expect(await count(t, "SELECT 1 FROM gateway_health_sample WHERE gateway_id = $1", [client.gatewayId])).toBe(1)
      expect(await count(t, "SELECT 1 FROM gateway_command WHERE gateway_id = $1", [client.gatewayId])).toBe(1)
      expect(await rows(t, "SELECT key FROM api_rate_limit WHERE key LIKE 'teste:%'")).toEqual([{ key: "teste:nova" }])
    })
  })

  describe("resumo diário", () => {
    it("sem e-mail configurado monta o resumo e não envia", async () => {
      await freshClient()
      const result = await run("resumo-diario", new Date("2026-11-20T10:00:00Z"))
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({ day: "2026-11-20", sent: false })
      expect(Number(result.body.organizations)).toBeGreaterThan(0)
    })

    it("com Resend: envia uma vez por dia; falha no envio libera a tentativa das 8h", async () => {
      await freshClient()
      const env = { RESEND_API_KEY: "re_teste", RESUMO_DIARIO_DE: "Plataforma OEE <oee@example.com>", RESUMO_DIARIO_PARA: "a@example.com, b@example.com" }
      const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = []
      let fail = true
      const fakeFetch = (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown>, headers: init.headers as Record<string, string> })
        return fail ? new Response("erro", { status: 500 }) : Response.json({ id: "email-1" })
      }) as typeof fetch

      const seven = new Date("2026-11-21T10:00:00Z")
      expect((await run("resumo-diario", seven, { env, fetch: fakeFetch })).status).toBe(500)
      fail = false
      const eight = await run("resumo-diario", new Date("2026-11-21T11:00:00Z"), { env, fetch: fakeFetch })
      expect(eight.status).toBe(200)
      expect(eight.body).toMatchObject({ sent: true, recipients: 2, day: "2026-11-21" })
      expect(calls).toHaveLength(2)
      expect(calls[1]?.url).toBe("https://api.resend.com/emails")
      expect(calls[1]?.headers.Authorization).toBe("Bearer re_teste")
      expect(calls[1]?.body).toMatchObject({ to: ["a@example.com", "b@example.com"], subject: "Resumo diário da plataforma OEE — 21/11/2026" })
      expect(String(calls[1]?.body.text)).toContain("Gateways")

      // Já enviado hoje: a chamada seguinte (ou repetida) não envia de novo.
      const repeated = await run("resumo-diario", new Date("2026-11-21T11:00:30Z"), { env, fetch: fakeFetch })
      expect(repeated.body).toMatchObject({ skipped: expect.any(String) })
      expect(calls).toHaveLength(2)
    })
  })
})
