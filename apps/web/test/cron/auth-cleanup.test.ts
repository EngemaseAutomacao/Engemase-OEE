/**
 * Parte do login na limpeza diária (`lib/server/cron/auth-cleanup.ts`): bloqueios por tentativa vencidos,
 * verificações vencidas do Better Auth e tokens "definir senha" antigos (por cliente, sob a RLS). E a
 * ligação com o job `limpeza` (sem banco do login, ele segue e diz o motivo).
 */
import * as s from "@engemase/db"
import { withTenant } from "@engemase/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { cleanupAuth } from "@/lib/server/cron/auth-cleanup"
import { CRON_JOBS } from "@/lib/server/cron/jobs"
import { type CronContext, runCronJob } from "@/lib/server/cron/runner"
import { THROTTLE_RETENTION_MS } from "@/lib/server/auth/throttle"
import { createTestDatabase, seedClient, type SeededClient, type TestDatabase } from "../access/support"

const NOW = new Date("2026-11-24T03:30:00Z")
const DAY = 24 * 3_600_000
const hex = (n: number) => n.toString(16).padStart(64, "0")

describe("limpeza do login", () => {
  let t: TestDatabase
  let a: SeededClient

  function ctx(): CronContext {
    return {
      db: t.db,
      now: NOW,
      env: {},
      fetch,
      log: () => undefined,
      async forEachOrganization(fn) {
        const results = []
        for (const organizationId of [a.organizationId]) {
          results.push({ organizationId, value: await withTenant(t.db, organizationId, (tx) => fn(tx, organizationId)) })
        }
        return { results, failures: 0, incomplete: false }
      },
    }
  }

  beforeAll(async () => {
    t = await createTestDatabase()
    a = await seedClient(t.db, "alfa")
  })

  afterAll(async () => {
    await t.client.close()
  })

  it("apaga só o que venceu: bloqueio antigo sem bloqueio em vigor, verificações e tokens de 30+ dias", async () => {
    const old = new Date(NOW.getTime() - THROTTLE_RETENTION_MS - 60_000)
    await t.db.insert(s.authLoginThrottle).values([
      { key: hex(1), failures: 2, windowStartedAt: old, updatedAt: old },
      { key: hex(2), failures: 5, windowStartedAt: old, lockedUntil: new Date(NOW.getTime() + 60_000), updatedAt: old },
      { key: hex(3), failures: 1, windowStartedAt: NOW, updatedAt: NOW },
    ])
    await t.db.insert(s.verification).values([
      { identifier: "velha", value: "x", expiresAt: new Date(NOW.getTime() - 2 * DAY) },
      { identifier: "nova", value: "x", expiresAt: new Date(NOW.getTime() + 600_000) },
    ])
    const userId = a.viewerAll.user.id
    const token = (n: number, createdAt: Date, expiresAt: Date, usedAt: Date | null) => ({
      organizationId: a.organizationId,
      purpose: "set_password" as const,
      tokenHash: hex(100 + n),
      userId,
      createdAt,
      expiresAt,
      usedAt,
    })
    await t.db.insert(s.accountToken).values([
      token(1, new Date(NOW.getTime() - 40 * DAY), new Date(NOW.getTime() - 37 * DAY), null),
      token(2, new Date(NOW.getTime() - 40 * DAY), new Date(NOW.getTime() - 37 * DAY), new Date(NOW.getTime() - 39 * DAY)),
      token(3, new Date(NOW.getTime() - 2 * DAY), new Date(NOW.getTime() + DAY), new Date(NOW.getTime() - DAY)),
      token(4, new Date(NOW.getTime() - DAY), new Date(NOW.getTime() + 2 * DAY), null),
    ])

    const result = await cleanupAuth(ctx(), t.db)
    expect(result).toEqual({
      auth_throttle_deleted: 1,
      auth_verifications_deleted: 1,
      account_tokens_deleted: 2,
      account_token_failures: 0,
    })
    const keys = (await t.db.select({ key: s.authLoginThrottle.key }).from(s.authLoginThrottle)).map((r) => r.key).sort()
    expect(keys).toEqual([hex(2), hex(3)])
    expect((await t.db.select().from(s.accountToken)).map((r) => r.tokenHash).sort()).toEqual([hex(103), hex(104)])

    // Idempotente.
    expect(await cleanupAuth(ctx(), t.db)).toMatchObject({ auth_throttle_deleted: 0, account_tokens_deleted: 0 })
  })

  it("sem banco do login: limpa os tokens e diz o motivo", async () => {
    const result = await cleanupAuth(ctx(), null)
    expect(result).toMatchObject({ auth_throttle_deleted: null, auth_cleanup: expect.stringContaining("sem banco do login") })
  })

  it("o job `limpeza` inclui a parte do login", async () => {
    const job = CRON_JOBS.find((j) => j.name === "limpeza")
    if (job === undefined) throw new Error("sem job limpeza")
    const res = await runCronJob(new Request("http://localhost/api/cron/limpeza", { headers: { Authorization: "Bearer segredo-de-teste-bom" } }), job, {
      db: t.db,
      secret: "segredo-de-teste-bom",
      now: () => NOW,
      env: {},
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty("account_tokens_deleted")
  })
})
