/**
 * Os "enums" do banco (texto + CHECK) que vêm do contrato gateway ↔ nuvem precisam continuar
 * iguais aos de `@engemase/contracts`. Se este teste falhar: atualize `src/schema/enums.ts`
 * e gere uma migração nova com `pnpm db:generate`.
 */
import {
  BaudRateSchema,
  DATA_TYPES as CONTRACT_DATA_TYPES,
  DeviceConnStatusSchema,
  EnrollResponseSchema,
  LiveSchema,
  MACHINE_STATES as CONTRACT_MACHINE_STATES,
  MinuteSchema,
  ParitySchema,
  ProtocolSchema,
  StateEventSchema,
  StateRulesSchema,
  TAG_ROLES as CONTRACT_TAG_ROLES,
  WordOrderSchema,
} from "@engemase/contracts"
import { getTableColumns } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { machineLive, productionMinute } from "../src/schema/index"
import {
  BAUD_RATES,
  DATA_TYPES,
  DEVICE_CONN_STATUSES,
  FAULT_CODE_MAX,
  FAULT_CODE_MIN,
  MACHINE_STATES,
  ORG_SLUG_PATTERN,
  PARITIES,
  PROTOCOLS,
  STATE_MODES,
  TAG_ROLES,
  WORD_ORDERS,
} from "../src/schema/enums"
import { type SeededTenant, seedTenant } from "./fixtures"
import { createTestDatabase, expectDbError, type TestDatabase } from "./helpers"

/** Slugs de cliente para comparar o formato do contrato com o do banco (válidos e inválidos). */
const SLUG_SAMPLES = [
  "a",
  "0",
  "acme",
  "acme-ltda",
  "a1-b2-c3",
  "a".repeat(64),
  `${"a-".repeat(31)}ab`,
  "",
  "A",
  "Acme",
  "Acme_Ltda",
  "acme_ltda",
  "-acme",
  "acme-",
  "acme ltda",
  "acme.ltda",
  "acme\n",
  "ação",
  "a".repeat(65),
]

/** Regexes do campo no zod 4 (cada `.regex()` vira um check em `def.checks`). */
function regexSources(schema: { def: { checks?: readonly unknown[] } }): string[] {
  return (schema.def.checks ?? []).flatMap((check) => {
    const pattern = (check as { _zod?: { def?: { pattern?: unknown } } })._zod?.def?.pattern
    return pattern instanceof RegExp ? [pattern.source] : []
  })
}

describe("enums espelhados do contrato", () => {
  it("são iguais aos de @engemase/contracts", () => {
    expect([...MACHINE_STATES]).toEqual([...CONTRACT_MACHINE_STATES])
    expect([...TAG_ROLES]).toEqual([...CONTRACT_TAG_ROLES])
    expect([...DATA_TYPES]).toEqual([...CONTRACT_DATA_TYPES])
    expect([...WORD_ORDERS]).toEqual([...WordOrderSchema.options])
    expect([...PROTOCOLS]).toEqual([...ProtocolSchema.options])
    expect([...PARITIES]).toEqual([...ParitySchema.options])
    expect([...DEVICE_CONN_STATUSES]).toEqual([...DeviceConnStatusSchema.options])
    expect([...BAUD_RATES]).toEqual([...BaudRateSchema.values])
    expect([...STATE_MODES]).toEqual(StateRulesSchema.options.map((option) => option.shape.mode.value))
  })

  it("o formato do slug do cliente é o do contrato (`org` da resposta do /enroll)", () => {
    const contract = EnrollResponseSchema.shape.org
    expect(regexSources(contract)).toEqual([ORG_SLUG_PATTERN])
    const local = new RegExp(ORG_SLUG_PATTERN)
    for (const slug of SLUG_SAMPLES) expect(local.test(slug), JSON.stringify(slug)).toBe(contract.safeParse(slug).success)
    // A amostra tem dos dois tipos.
    expect(new Set(SLUG_SAMPLES.map((slug) => local.test(slug)))).toEqual(new Set([true, false]))
  })

  it("a faixa do código de falha é a do contrato (uint32) no evento de estado e no live", () => {
    for (const field of [StateEventSchema.shape.fault_code, LiveSchema.shape.fault_code]) {
      expect(field.safeParse(FAULT_CODE_MIN).success).toBe(true)
      expect(field.safeParse(FAULT_CODE_MAX).success).toBe(true)
      expect(field.safeParse(FAULT_CODE_MIN - 1).success).toBe(false)
      expect(field.safeParse(FAULT_CODE_MAX + 1).success).toBe(false)
    }
  })
})

/** Nomes das colunas (no banco) de uma tabela do schema. */
function columnNames(table: PgTable): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name)
}

describe("campos de minuto e live do contrato têm coluna no banco", () => {
  /** Campo do contrato → coluna (`null` = não é guardado; o resto tem o mesmo nome). */
  const MINUTE_COLUMNS: Record<string, string | null> = { seq: null, t: "bucket_start", product: "product_code" }
  const LIVE_COLUMNS: Record<string, string | null> = { product: "product_code" }

  function expectedColumns(fields: readonly string[], renames: Record<string, string | null>): string[] {
    return fields.map((field) => (field in renames ? renames[field] : field)).filter((c): c is string => c != null)
  }

  it("production_minute ← Minute", () => {
    const expected = expectedColumns(Object.keys(MinuteSchema.shape), MINUTE_COLUMNS)
    expect(columnNames(productionMinute)).toEqual(expect.arrayContaining(expected))
    expect(expected).toContain("good")
  })

  it("machine_live ← Live", () => {
    const expected = expectedColumns(Object.keys(LiveSchema.shape), LIVE_COLUMNS)
    expect(columnNames(machineLive)).toEqual(expect.arrayContaining(expected))
    expect(expected).toEqual(expect.arrayContaining(["speed", "fault_code"]))
  })
})

describe("CHECKs do banco", () => {
  let t: TestDatabase
  let a: SeededTenant

  beforeAll(async () => {
    t = await createTestDatabase()
    a = await seedTenant(t.db, "alfa")
  })

  afterAll(async () => {
    await t.client.close()
  })

  function attempt(sql: string, params: unknown[]): Promise<unknown> {
    return t.client.transaction(async (tx) => {
      await tx.query(sql, params)
      await tx.rollback()
    })
  }

  it("toda coluna fault_code é bigint e aceita a faixa uint32 inteira do contrato", async () => {
    const types = await t.client.query<{ table: string; type: string }>(`
      SELECT table_name AS "table", data_type AS type FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'fault_code' ORDER BY 1`)
    expect(types.rows).toEqual([
      { table: "fault_code_map", type: "bigint" },
      { table: "machine_live", type: "bigint" },
      { table: "machine_state_event", type: "bigint" },
    ])

    const event = (code: number) =>
      attempt(
        "INSERT INTO machine_state_event (organization_id, machine_id, state, started_at, fault_code) VALUES ($1, $2, 'FAULT', now(), $3)",
        [a.organizationId, a.machineId, code],
      )
    const live = (code: number) =>
      attempt("UPDATE machine_live SET fault_code = $2 WHERE machine_id = $1", [a.machineId, code])
    const map = (code: number) =>
      attempt("UPDATE fault_code_map SET fault_code = $2 WHERE organization_id = $1", [a.organizationId, code])

    for (const code of [FAULT_CODE_MIN, 2_147_483_648, FAULT_CODE_MAX]) {
      await event(code)
      await live(code)
      await map(code)
    }
    for (const code of [FAULT_CODE_MIN - 1, FAULT_CODE_MAX + 1]) {
      await expectDbError(event(code), /machine_state_event_fault_code_chk/)
      await expectDbError(live(code), /machine_live_fault_code_chk/)
      await expectDbError(map(code), /fault_code_map_fault_code_chk/)
    }
  })

  it("organization.slug: o banco aceita exatamente os slugs que o contrato aceita", async () => {
    const insert = (slug: string) => attempt("INSERT INTO organization (name, slug) VALUES ('Cliente', $1)", [slug])
    for (const slug of SLUG_SAMPLES) {
      if (EnrollResponseSchema.shape.org.safeParse(slug).success) await insert(slug)
      else await expectDbError(insert(slug), /organization_slug_chk/)
    }
  })

  it("production_minute.good e machine_live.speed: opcionais; boas nunca negativas", async () => {
    const minute = (good: number | null) =>
      attempt(
        `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject, good)
         VALUES ($1, $2, date_trunc('minute', now()) + interval '3 days', 60, 0, 0, 0, 10, 1, $3)`,
        [a.organizationId, a.machineId, good],
      )
    await minute(null)
    await minute(9)
    await expectDbError(minute(-1), /production_minute_good_chk/)
    await attempt("UPDATE machine_live SET speed = NULL WHERE machine_id = $1", [a.machineId])
    await attempt("UPDATE machine_live SET speed = 1234.5 WHERE machine_id = $1", [a.machineId])
  })

  it("member_access: escopo 'machines' aceito (D11); escopo desconhecido e admin fora de 'all' recusados", async () => {
    const scope = (id: string, value: string) =>
      attempt("UPDATE member_access SET scope = $2 WHERE id = $1", [id, value])
    for (const value of ["all", "units", "machines"]) await scope(a.memberAccessId, value)
    for (const value of ["lines", "", "MACHINES"]) {
      await expectDbError(scope(a.memberAccessId, value), /member_access_scope_chk/)
    }
    // O admin do cliente tem sempre o cliente inteiro: nem por unidades, nem por máquinas.
    await expectDbError(
      attempt("UPDATE member_access SET role = 'client_admin' WHERE id = $1", [a.machineAccessId]),
      /member_access_admin_scope_chk/,
    )
    await attempt("UPDATE member_access SET role = 'client_admin', scope = 'all' WHERE id = $1", [a.machineAccessId])
  })

  it("support_access_grant: nasce 'active', sem estados nem colunas de aprovação do cliente (D5)", async () => {
    const created = await t.client.transaction(async (tx) => {
      const r = await tx.query<{ status: string }>(
        `INSERT INTO support_access_grant (organization_id, user_id, reason, starts_at, ends_at)
         SELECT organization_id, user_id, 'Chamado', now(), now() + interval '1 hour'
         FROM support_access_grant WHERE organization_id = $1 RETURNING status`,
        [a.organizationId],
      )
      await tx.rollback()
      return r.rows
    })
    expect(created).toEqual([{ status: "active" }])
    for (const status of ["requested", "denied"]) {
      await expectDbError(
        attempt("UPDATE support_access_grant SET status = $2 WHERE organization_id = $1", [a.organizationId, status]),
        /support_access_grant_status_chk/,
      )
    }
    const approval = await t.client.query<{ name: string }>(`
      SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'support_access_grant' AND column_name LIKE 'approved%'`)
    expect(approval.rows).toEqual([])
  })

  it("client_account: gerenciado pela Engemase por padrão (D13); limites com `machines` e inteiros >= 0 (D1)", async () => {
    // O seed não informa managed_by_engemase: vale o padrão.
    const managed = await t.client.query<{ managed: boolean }>(
      "SELECT managed_by_engemase AS managed FROM client_account WHERE organization_id = $1",
      [a.organizationId],
    )
    expect(managed.rows).toEqual([{ managed: true }])

    const limits = (value: string) =>
      attempt("UPDATE client_account SET limits = $2::jsonb WHERE organization_id = $1", [a.organizationId, value])
    for (const ok of ['{"machines": 0}', '{"machines": 50, "gateways": 4, "users": 30, "retentionMonths": 24}']) {
      await limits(ok)
    }
    for (const bad of [
      // Sem `machines` (a base da cobrança): não existe cliente "sem limite definido".
      "{}",
      '{"gateways": 4, "users": 30}',
      '["machines"]',
      "[]",
      "50",
      '{"machines": -1}',
      '{"machines": 2.5}',
      '{"machines": "50"}',
      '{"machines": null}',
      '{"machines": [50]}',
      '{"machines": {"max": 50}}',
      '{"machines": 50, "users": -2}',
    ]) {
      await expectDbError(limits(bad), /client_account_limits_chk/)
    }
    // Sem padrão: criar o cliente sem informar `limits` falha (não nasce com `{}`).
    await expectDbError(
      attempt(
        `WITH o AS (INSERT INTO organization (name, slug) VALUES ('Sem limites', 'sem-limites') RETURNING id)
         INSERT INTO client_account (organization_id) SELECT id FROM o`,
        [],
      ),
      /null value in column "limits"/,
    )
  })

  it("recusam valores fora da lista e regras quebradas", async () => {
    await expectDbError(
      attempt(
        "INSERT INTO machine_state_event (organization_id, machine_id, state, started_at) VALUES ($1, $2, 'PAUSED', now())",
        [a.organizationId, a.machineId],
      ),
      /machine_state_event_state_chk/,
    )
    await expectDbError(
      attempt(
        `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject)
         VALUES ($1, $2, date_trunc('minute', now()) + interval '2 days', 30, 0, 0, 0, 1, 0)`,
        [a.organizationId, a.machineId],
      ),
      /production_minute_seconds_chk/,
    )
    await expectDbError(
      attempt(
        `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject)
         VALUES ($1, $2, date_trunc('minute', now()) + interval '2 days 10 seconds', 60, 0, 0, 0, 1, 0)`,
        [a.organizationId, a.machineId],
      ),
      /production_minute_bucket_chk/,
    )
    await expectDbError(
      attempt('UPDATE machine SET state_rules = \'{"mode":"magic"}\' WHERE id = $1', [a.machineId]),
      /machine_state_mode_chk/,
    )
    await expectDbError(
      attempt("UPDATE gateway SET token_hash = 'texto-em-claro' WHERE id = $1", [a.gatewayId]),
      /gateway_token_hash_chk/,
    )
    await expectDbError(
      attempt("UPDATE member_access SET role = 'client_admin', scope = 'units' WHERE organization_id = $1", [
        a.organizationId,
      ]),
      /member_access_admin_scope_chk/,
    )
    await expectDbError(
      attempt("UPDATE support_access_grant SET ends_at = starts_at + interval '5 hours' WHERE organization_id = $1", [
        a.organizationId,
      ]),
      /support_access_grant_window_chk/,
    )
    await expectDbError(
      attempt("UPDATE remote_access_session SET decided_by = requested_by WHERE id = $1", [a.remoteSessionId]),
      /remote_access_session_self_approval_chk/,
    )
    await expectDbError(attempt("UPDATE shift SET days_of_week = '{0,8}' WHERE id = $1", [a.shiftId]), /shift_days_chk/)
    await expectDbError(
      attempt(`UPDATE device SET params = '{"bus":"00000000-0000-0000-0000-000000000000","unit_id":5}' WHERE id = $1`, [
        a.rtuDeviceId,
      ]),
      /device_params_bus_chk/,
    )
  })
})
