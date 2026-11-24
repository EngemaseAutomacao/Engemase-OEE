/**
 * Tabelas de plataforma (0009/0010): limitador de taxa e registro dos crons, só pelas funções
 * SECURITY DEFINER; o histórico de saúde do gateway, que é tabela de cliente; e a retenção da auditoria
 * (0014, `app.audit_log_purge`).
 */
import type { Transaction } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type SeededTenant, seedTenant } from "./fixtures"
import { asTenant, count, createTestDatabase, type TestDatabase } from "./helpers"

const DENIED = /permission denied/

async function take(
  tx: Transaction,
  key: string,
  intervalMs: number,
  burst: number,
  at: Date,
): Promise<{ allowed: boolean; retry_after_ms: number }> {
  const r = await tx.query<{ allowed: boolean; retry_after_ms: string | number }>(
    "SELECT allowed, retry_after_ms FROM app.rate_limit_take($1, $2, $3, $4)",
    [key, intervalMs, burst, at.toISOString()],
  )
  const row = r.rows[0]
  if (row === undefined) throw new Error("sem linha")
  return { allowed: row.allowed, retry_after_ms: Number(row.retry_after_ms) }
}

describe("tabelas de plataforma", () => {
  let t: TestDatabase
  let a: SeededTenant
  let b: SeededTenant

  beforeAll(async () => {
    t = await createTestDatabase()
    a = await seedTenant(t.db, "alfa")
    b = await seedTenant(t.db, "beta")
  })

  afterAll(async () => {
    await t.client.close()
  })

  it("o app_user não lê nem grava api_rate_limit e cron_run diretamente", async () => {
    for (const table of ["api_rate_limit", "cron_run"]) {
      await expect(asTenant(t.client, a.organizationId, (tx) => tx.query(`SELECT 1 FROM ${table}`))).rejects.toThrow(DENIED)
      await expect(asTenant(t.client, null, (tx) => tx.query(`DELETE FROM ${table}`))).rejects.toThrow(DENIED)
    }
  })

  it("rate_limit_take: rajada, depois uma requisição por intervalo, com retry_after", async () => {
    const t0 = new Date("2026-11-24T12:00:00Z")
    const results = await asTenant(t.client, null, async (tx) => {
      const out: { allowed: boolean; retry_after_ms: number }[] = []
      for (let i = 0; i < 4; i++) out.push(await take(tx, "teste:rajada", 1000, 3, t0))
      // 400 ms depois: ainda bloqueado (falta 600 ms); 1 s depois: passa uma.
      out.push(await take(tx, "teste:rajada", 1000, 3, new Date(t0.getTime() + 400)))
      out.push(await take(tx, "teste:rajada", 1000, 3, new Date(t0.getTime() + 1000)))
      out.push(await take(tx, "teste:rajada", 1000, 3, new Date(t0.getTime() + 1000)))
      // Chave diferente não é afetada.
      out.push(await take(tx, "teste:outra", 1000, 3, t0))
      return out
    })
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false, true, false, true])
    expect(results[3]?.retry_after_ms).toBe(1000)
    expect(results[4]?.retry_after_ms).toBe(600)
  })

  it("rate_limit_take recusa parâmetros inválidos", async () => {
    await expect(
      asTenant(t.client, null, (tx) => take(tx, "", 1000, 1, new Date())),
    ).rejects.toThrow(/chave inválida/)
    await expect(
      asTenant(t.client, null, (tx) => take(tx, "x", 0, 1, new Date())),
    ).rejects.toThrow(/positivos/)
  })

  it("rate_limit_purge apaga só as chaves vencidas", async () => {
    await t.client.query("INSERT INTO api_rate_limit (key, tat, expires_at) VALUES ('velha', now() - interval '2 h', now() - interval '2 h'), ('nova', now() + interval '1 h', now() + interval '1 h')")
    const purged = await asTenant(t.client, null, async (tx) => {
      const r = await tx.query<{ n: number }>("SELECT app.rate_limit_purge(now() - interval '1 h') AS n")
      return r.rows[0]?.n
    })
    expect(purged).toBe(1)
  })

  it("cron_claim/cron_finish: uma execução por janela; erro libera a janela", async () => {
    const t0 = new Date("2026-11-24T12:00:00Z")
    const later = new Date(t0.getTime() + 120_000)
    const flow = await t.client.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE app_user")
      const claim = async (key: string, at: Date) =>
        (await tx.query<{ ok: boolean }>("SELECT app.cron_claim('alertas', $1, $2, 60) AS ok", [key, at.toISOString()])).rows[0]?.ok
      const finish = (key: string, at: Date, ok: boolean) =>
        tx.query("SELECT app.cron_finish('alertas', $1, $2, $3, $4)", [key, at.toISOString(), ok, JSON.stringify({ ok })])
      const out: (boolean | undefined)[] = []
      out.push(await claim("j1", t0)) // nova: true
      out.push(await claim("j1", t0)) // em andamento: false
      out.push(await claim("j1", later)) // prazo vencido, sem fim: retoma
      await finish("j1", later, true)
      out.push(await claim("j1", new Date(later.getTime() + 3_600_000))) // terminada: nunca mais
      out.push(await claim("j2", t0))
      await finish("j2", t0, false) // falhou: libera
      out.push(await claim("j2", t0))
      await tx.rollback()
      return out
    })
    expect(flow).toEqual([true, false, true, false, true, true])
  })

  it("cron_organizations devolve os ids de todos os clientes (e nada mais)", async () => {
    const ids = await asTenant(t.client, null, async (tx) => {
      const r = await tx.query<Record<string, unknown>>("SELECT * FROM app.cron_organizations()")
      return r.rows
    })
    expect(ids).toEqual(expect.arrayContaining([{ id: a.organizationId }, { id: b.organizationId }]))
    expect(Object.keys(ids[0] ?? {})).toEqual(["id"])
  })

  it("gateway_health_sample é de cliente: A não vê nem apaga o histórico de B", async () => {
    const seen = await asTenant(t.client, a.organizationId, (tx) => count(tx, "SELECT 1 FROM gateway_health_sample"))
    expect(seen).toBe(1)
    await asTenant(t.client, a.organizationId, async (tx) => {
      await tx.query("DELETE FROM gateway_health_sample WHERE organization_id = $1", [b.organizationId])
    })
    expect(await count(t.client, "SELECT 1 FROM gateway_health_sample WHERE organization_id = $1", [b.organizationId])).toBe(1)
  })

  it("audit_log_purge apaga em lote só a auditoria velha (de todos os clientes) e recusa prazo menor que 365 dias", async () => {
    await t.client.query(
      `INSERT INTO audit_log (organization_id, actor_type, action, at) VALUES
       ($1, 'system', 'teste.retencao', now() - interval '6 years'),
       ($1, 'system', 'teste.retencao', now() - interval '5 years 2 days'),
       ($2, 'system', 'teste.retencao', now() - interval '5 years 1 day'),
       (NULL, 'system', 'teste.retencao', now() - interval '7 years'),
       ($1, 'system', 'teste.retencao', now() - interval '4 years')`,
      [a.organizationId, b.organizationId],
    )
    const purge = async (tx: Transaction, before: string, limit: number) => {
      const r = await tx.query<{ n: number }>(`SELECT app.audit_log_purge(${before}, $1) AS n`, [limit])
      return r.rows[0]?.n
    }
    // Numa transação só (asTenant desfaz no fim): lote de 2 com os mais velhos primeiro, depois o resto
    // além de 5 anos; o registro de 4 anos só sai com um prazo menor.
    const flow = await asTenant(t.client, null, async (tx) => [
      await purge(tx, "now() - interval '5 years'", 2),
      await purge(tx, "now() - interval '5 years'", 100),
      await purge(tx, "now() - interval '5 years'", 100),
      await purge(tx, "now() - interval '3 years'", 100),
    ])
    expect(flow).toEqual([2, 2, 0, 1])

    await expect(asTenant(t.client, null, (tx) => purge(tx, "now() - interval '364 days'", 100))).rejects.toThrow(/365 dias/)
    await expect(asTenant(t.client, null, (tx) => purge(tx, "now() - interval '2 years'", 0))).rejects.toThrow(/lote/)
    // O app_user continua sem apagar a auditoria diretamente.
    await expect(asTenant(t.client, a.organizationId, (tx) => tx.query("DELETE FROM audit_log"))).rejects.toThrow(DENIED)
  })
})
