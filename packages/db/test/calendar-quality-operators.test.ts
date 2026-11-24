/**
 * Tabelas e colunas do W2b (migrações 0007 e 0008), com as regras das lacunas do docs/17 (§4):
 * feriados por unidade (L2), motivos de refugo e estorno (L3), operadores por unidade (L19) e gateway
 * "Em trânsito" (L23). RLS por cliente em cada tabela nova, FKs compostas e as regras entre linhas.
 */
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { GATEWAY_TRANSIT_MAX_DAYS } from "../src/schema/enums"
import { TENANT_TABLE_NAMES } from "../src/tenancy"
import { type SeededTenant, seedTenant } from "./fixtures"
import { asTenant, count, createTestDatabase, expectDbError, ident, type TestDatabase } from "./helpers"

const RLS_ERROR = /row-level security/
const NEW_TABLES = ["unit_holiday", "reject_reason", "unit_operator"] as const

describe("tabelas novas do W2b: RLS por cliente", () => {
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

  it("são tabelas de cliente (entram no teste de catálogo e no rls.test.ts)", () => {
    expect(TENANT_TABLE_NAMES).toEqual(expect.arrayContaining([...NEW_TABLES]))
  })

  it("com app.org_id = A, cada uma só mostra linhas de A; sem cliente, nada", async () => {
    await asTenant(t.client, a.organizationId, async (tx) => {
      for (const table of NEW_TABLES) {
        expect(await count(tx, `SELECT 1 FROM ${ident(table)}`), table).toBe(1)
        expect(
          await count(tx, `SELECT 1 FROM ${ident(table)} WHERE organization_id <> $1`, [a.organizationId]),
          table,
        ).toBe(0)
      }
    })
    await asTenant(t.client, null, async (tx) => {
      for (const table of NEW_TABLES) expect(await count(tx, `SELECT 1 FROM ${ident(table)}`), table).toBe(0)
    })
  })

  it("INSERT com dados do cliente B, com app.org_id = A, é bloqueado", async () => {
    const attempts: [string, unknown[]][] = [
      [
        "INSERT INTO unit_holiday (organization_id, unit_id, holiday_date, name) VALUES ($1, $2, '2027-01-01', 'Ano-novo')",
        [b.organizationId, b.unitId],
      ],
      ["INSERT INTO reject_reason (organization_id, name) VALUES ($1, 'Bolha')", [b.organizationId]],
      ["INSERT INTO unit_operator (organization_id, unit_id, name) VALUES ($1, $2, 'Intruso')", [b.organizationId, b.unitId]],
    ]
    for (const [query, params] of attempts) {
      await expect(asTenant(t.client, a.organizationId, (tx) => tx.query(query, params))).rejects.toThrow(RLS_ERROR)
    }
  })

  it("UPDATE e DELETE de linhas de B, com app.org_id = A, não atingem nada", async () => {
    const affected = await asTenant(t.client, a.organizationId, async (tx) => {
      const results: number[] = []
      for (const table of NEW_TABLES) {
        const upd = await tx.query(`UPDATE ${ident(table)} SET name = 'X' WHERE organization_id = $1`, [b.organizationId])
        const del = await tx.query(`DELETE FROM ${ident(table)} WHERE organization_id = $1`, [b.organizationId])
        results.push(upd.affectedRows ?? 0, del.affectedRows ?? 0)
      }
      return results
    })
    expect(affected).toEqual([0, 0, 0, 0, 0, 0])
    for (const table of NEW_TABLES) {
      expect(await count(t.client, `SELECT 1 FROM ${ident(table)} WHERE organization_id = $1`, [b.organizationId])).toBe(1)
    }
  })

  it("o próprio cliente cadastra, altera e exclui (GRANTs de cadastro)", async () => {
    const result = await asTenant(t.client, a.organizationId, async (tx) => {
      await tx.query(
        "INSERT INTO unit_holiday (organization_id, unit_id, holiday_date, name) VALUES ($1, $2, '2027-01-01', 'Ano-novo')",
        [a.organizationId, a.unitId],
      )
      await tx.query("INSERT INTO reject_reason (organization_id, name, code) VALUES ($1, 'Bolha', 'BL')", [
        a.organizationId,
      ])
      await tx.query("INSERT INTO unit_operator (organization_id, unit_id, name) VALUES ($1, $2, 'Carlos')", [
        a.organizationId,
        a.unitId,
      ])
      await tx.query("UPDATE unit_operator SET active = false WHERE name = 'Carlos'")
      const del = await tx.query("DELETE FROM unit_holiday WHERE holiday_date = '2027-01-01'")
      return {
        deleted: del.affectedRows,
        reasons: await count(tx, "SELECT 1 FROM reject_reason"),
        inactive: await count(tx, "SELECT 1 FROM unit_operator WHERE NOT active"),
      }
    })
    expect(result).toEqual({ deleted: 1, reasons: 2, inactive: 1 })
  })

  it("FK composta: feriado e operador só em unidade do mesmo cliente (nem o dono burla)", async () => {
    await expectDbError(
      t.client.query(
        "INSERT INTO unit_holiday (organization_id, unit_id, holiday_date, name) VALUES ($1, $2, '2027-01-01', 'X')",
        [a.organizationId, b.unitId],
      ),
      /unit_holiday_unit_fk/,
    )
    await expectDbError(
      t.client.query("INSERT INTO unit_operator (organization_id, unit_id, name) VALUES ($1, $2, 'X')", [
        a.organizationId,
        b.unitId,
      ]),
      /unit_operator_unit_fk/,
    )
  })

  it("FK composta: lançamento, troca de produto e classificação só com motivo e operador do mesmo cliente", async () => {
    await expectDbError(
      t.client.query(
        "INSERT INTO quality_entry (organization_id, machine_id, at, quantity, reject_reason_id) VALUES ($1, $2, now(), 1, $3)",
        [a.organizationId, a.machineId, b.rejectReasonId],
      ),
      /quality_entry_reject_reason_fk/,
    )
    await expectDbError(
      t.client.query(
        "INSERT INTO quality_entry (organization_id, machine_id, at, quantity, operator_id) VALUES ($1, $2, now(), 1, $3)",
        [a.organizationId, a.machineId, b.unitOperatorId],
      ),
      /quality_entry_operator_fk/,
    )
    await expectDbError(
      t.client.query(
        "INSERT INTO production_run (organization_id, machine_id, started_at, source, operator_id) VALUES ($1, $2, now(), 'operator', $3)",
        [a.organizationId, a.machineId, b.unitOperatorId],
      ),
      /production_run_operator_fk/,
    )
    await expectDbError(
      t.client.query(
        "UPDATE machine_state_event SET classified_operator_id = $2 WHERE organization_id = $1",
        [a.organizationId, b.unitOperatorId],
      ),
      /machine_state_event_operator_fk/,
    )
  })

  it("um feriado por dia e unidade; matrícula única na unidade (excluídos não contam)", async () => {
    await expectDbError(
      t.client.query(
        "INSERT INTO unit_holiday (organization_id, unit_id, holiday_date, name) VALUES ($1, $2, '2026-12-25', 'De novo')",
        [a.organizationId, a.unitId],
      ),
      /unit_holiday_unit_date_uq/,
    )
    await expectDbError(
      t.client.query(
        "INSERT INTO unit_operator (organization_id, unit_id, name, employee_code) VALUES ($1, $2, 'Outra', '1042')",
        [a.organizationId, a.unitId],
      ),
      /unit_operator_unit_code_uq/,
    )
    // A mesma matrícula em outra unidade, sem matrícula, ou depois de excluir o cadastro antigo: pode.
    await t.client.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO unit_operator (organization_id, unit_id, name, employee_code) VALUES ($1, $2, 'Outra', '1042')",
        [a.organizationId, a.otherUnitId],
      )
      await tx.query("INSERT INTO unit_operator (organization_id, unit_id, name) VALUES ($1, $2, 'Sem matrícula')", [
        a.organizationId,
        a.unitId,
      ])
      await tx.query("UPDATE unit_operator SET deleted_at = now() WHERE id = $1", [a.unitOperatorId])
      await tx.query(
        "INSERT INTO unit_operator (organization_id, unit_id, name, employee_code) VALUES ($1, $2, 'Nova', '1042')",
        [a.organizationId, a.unitId],
      )
      await tx.rollback()
    })
    await expectDbError(
      t.client.query("INSERT INTO unit_operator (organization_id, unit_id, name, employee_code) VALUES ($1, $2, 'X', ' ')", [
        a.organizationId,
        a.unitId,
      ]),
      /unit_operator_code_chk/,
    )
    await expectDbError(
      t.client.query("INSERT INTO reject_reason (organization_id, name) VALUES ($1, 'rebarba')", [a.organizationId]),
      /reject_reason_org_name_uq/,
    )
  })
})

describe("estorno de refugo (L3)", () => {
  let t: TestDatabase
  let a: SeededTenant

  const reverse =
    "INSERT INTO quality_entry (organization_id, machine_id, at, quantity, reverses_id, reversal_reason) VALUES ($1, $2, now(), $3, $4, $5)"

  beforeAll(async () => {
    t = await createTestDatabase()
    a = await seedTenant(t.db, "alfa")
  })

  afterAll(async () => {
    await t.client.close()
  })

  it("lançamento comum é positivo e não leva motivo de estorno", async () => {
    await expectDbError(
      asTenant(t.client, a.organizationId, (tx) =>
        tx.query("INSERT INTO quality_entry (organization_id, machine_id, at, quantity) VALUES ($1, $2, now(), -2)", [
          a.organizationId,
          a.machineId,
        ]),
      ),
      /quality_entry_sign_chk/,
    )
    await expectDbError(
      asTenant(t.client, a.organizationId, (tx) =>
        tx.query(
          "INSERT INTO quality_entry (organization_id, machine_id, at, quantity, reversal_reason) VALUES ($1, $2, now(), 2, 'x')",
          [a.organizationId, a.machineId],
        ),
      ),
      /quality_entry_reversal_reason_chk/,
    )
  })

  it("o estorno exige motivo", async () => {
    for (const motivo of [null, "  "]) {
      await expectDbError(
        asTenant(t.client, a.organizationId, (tx) =>
          tx.query(reverse, [a.organizationId, a.machineId, -3, a.qualityEntryId, motivo]),
        ),
        /quality_entry_reversal_reason_chk/,
      )
    }
  })

  it("o estorno tem a quantidade oposta à do original e é da mesma máquina", async () => {
    await expectDbError(
      asTenant(t.client, a.organizationId, (tx) =>
        tx.query(reverse, [a.organizationId, a.machineId, -2, a.qualityEntryId, "Contagem errada"]),
      ),
      /quantidade oposta/,
    )
    await expectDbError(
      asTenant(t.client, a.organizationId, (tx) =>
        tx.query(reverse, [a.organizationId, a.unlinkedMachineId, -3, a.qualityEntryId, "Máquina errada"]),
      ),
      /mesma máquina/,
    )
  })

  it("no máximo um estorno por lançamento, e estorno não se estorna", async () => {
    const reversalId = randomUUID()
    await asTenant(t.client, a.organizationId, async (tx) => {
      await tx.query(
        "INSERT INTO quality_entry (id, organization_id, machine_id, at, quantity, reverses_id, reversal_reason) VALUES ($1, $2, $3, now(), -3, $4, 'Lançado em dobro')",
        [reversalId, a.organizationId, a.machineId, a.qualityEntryId],
      )
      await expectDbError(
        tx.query("SAVEPOINT s1").then(() =>
          tx.query(reverse, [a.organizationId, a.machineId, -3, a.qualityEntryId, "De novo"]),
        ),
        /quality_entry_one_reversal_uq/,
      )
      await tx.query("ROLLBACK TO SAVEPOINT s1")
      await expectDbError(
        tx.query(reverse, [a.organizationId, a.machineId, 3, reversalId, "Estorno do estorno"]),
        /quality_entry_reversal_chk/,
      )
      await tx.query("ROLLBACK TO SAVEPOINT s1")
      // Mesmo com quantidade negativa, apontar para um estorno é recusado pelo gatilho.
      await expectDbError(
        tx.query(reverse, [a.organizationId, a.machineId, -3, reversalId, "Estorno do estorno"]),
        /não se estorna um estorno/,
      )
      await tx.query("ROLLBACK TO SAVEPOINT s1")
    })
  })

  it("o estorno certo passa, com motivo de refugo e operador do próprio cliente", async () => {
    const rows = await asTenant(t.client, a.organizationId, async (tx) => {
      await tx.query(reverse, [a.organizationId, a.machineId, -3, a.qualityEntryId, "Lançado na máquina errada"])
      const r = await tx.query<{ quantity: number; reject_reason_id: string | null; operator_id: string | null }>(
        "SELECT quantity, reject_reason_id, operator_id FROM quality_entry ORDER BY created_at, quantity DESC",
      )
      return r.rows
    })
    expect(rows).toEqual([
      { quantity: 3, reject_reason_id: a.rejectReasonId, operator_id: a.unitOperatorId },
      { quantity: -3, reject_reason_id: null, operator_id: null },
    ])
  })

  it("o app não altera nem apaga lançamentos (só SELECT e INSERT)", async () => {
    await expect(
      asTenant(t.client, a.organizationId, (tx) => tx.query("UPDATE quality_entry SET quantity = 9")),
    ).rejects.toThrow(/permission denied/)
    await expect(asTenant(t.client, a.organizationId, (tx) => tx.query("DELETE FROM quality_entry"))).rejects.toThrow(
      /permission denied/,
    )
  })
})

describe("gateway \"Em trânsito\" (L23)", () => {
  let t: TestDatabase
  let a: SeededTenant

  beforeAll(async () => {
    t = await createTestDatabase()
    a = await seedTenant(t.db, "alfa")
  })

  afterAll(async () => {
    await t.client.close()
  })

  const setTransit = "UPDATE gateway SET in_transit_since = $2::timestamptz, in_transit_until = $3::timestamptz WHERE id = $1"

  it(`prazo de até ${GATEWAY_TRANSIT_MAX_DAYS} dias, com início e fim juntos`, async () => {
    expect(GATEWAY_TRANSIT_MAX_DAYS).toBe(30)
    const since = "2026-11-20T12:00:00Z"
    await asTenant(t.client, a.organizationId, async (tx) => {
      const ok = await tx.query(setTransit, [a.gatewayId, since, "2026-12-20T12:00:00Z"])
      expect(ok.affectedRows).toBe(1)
      // Instalado: a aplicação marca installed_at e encerra o trânsito.
      await tx.query(
        "UPDATE gateway SET installed_at = now(), in_transit_since = NULL, in_transit_until = NULL WHERE id = $1",
        [a.gatewayId],
      )
    })
    for (const [from, to] of [
      [since, "2026-12-20T12:00:01Z"],
      [since, since],
      [since, null],
      [null, "2026-12-01T00:00:00Z"],
    ]) {
      await expectDbError(
        asTenant(t.client, a.organizationId, (tx) => tx.query(setTransit, [a.gatewayId, from, to])),
        /gateway_in_transit_chk/,
      )
    }
  })

  it("um gateway em trânsito continua ativo e autenticando (não é um status novo)", async () => {
    const status = await asTenant(t.client, a.organizationId, async (tx) => {
      await tx.query(setTransit, [a.gatewayId, "2026-11-20T12:00:00Z", "2026-12-01T00:00:00Z"])
      const r = await tx.query<{ status: string }>("SELECT status FROM gateway WHERE id = $1", [a.gatewayId])
      return r.rows[0]?.status
    })
    expect(status).toBe("active")
  })
})
