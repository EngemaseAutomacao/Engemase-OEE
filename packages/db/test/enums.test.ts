/**
 * Os "enums" do banco (texto + CHECK) que vêm do contrato gateway ↔ nuvem precisam continuar
 * iguais aos de `@engemase/contracts`. Se este teste falhar: atualize `src/schema/enums.ts`
 * e gere uma migração nova com `pnpm db:generate`.
 */
import {
  BaudRateSchema,
  DATA_TYPES as CONTRACT_DATA_TYPES,
  DeviceConnStatusSchema,
  MACHINE_STATES as CONTRACT_MACHINE_STATES,
  ParitySchema,
  ProtocolSchema,
  StateRulesSchema,
  TAG_ROLES as CONTRACT_TAG_ROLES,
  WordOrderSchema,
} from "@engemase/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  BAUD_RATES,
  DATA_TYPES,
  DEVICE_CONN_STATUSES,
  MACHINE_STATES,
  PARITIES,
  PROTOCOLS,
  STATE_MODES,
  TAG_ROLES,
  WORD_ORDERS,
} from "../src/schema/enums"
import { type SeededTenant, seedTenant } from "./fixtures"
import { createTestDatabase, expectDbError, type TestDatabase } from "./helpers"

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
