/**
 * Chaves estrangeiras compostas `(x_id, organization_id)` (docs/15, seção 4, item 5 e risco 7):
 * é impossível, NO BANCO, ligar o gateway de A a uma máquina de B — mesmo para quem ignora a RLS
 * (o dono do banco) e mesmo conhecendo os ids.
 */
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type SeededTenant, seedTenant } from "./fixtures"
import { asTenant, createTestDatabase, expectDbError, type TestDatabase } from "./helpers"

const FK_ERROR = /violates foreign key constraint/

describe("FKs compostas entre tabelas de cliente", () => {
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

  /** Executa como dono (superusuário no PGlite, sem RLS) e desfaz no fim. */
  function asOwner(sql: string, params: unknown[]): Promise<unknown> {
    return t.client.transaction(async (tx) => {
      await tx.query(sql, params)
      await tx.rollback()
    })
  }

  const linkGatewayMachine =
    "INSERT INTO gateway_machine (organization_id, gateway_id, machine_id, unit_id) VALUES ($1, $2, $3, $4)"

  it("não liga o gateway de A a uma máquina de B (nem declarando o cliente A, nem o B)", async () => {
    // Declarando A: a máquina de B não existe como (id, A).
    await expectDbError(
      asOwner(linkGatewayMachine, [a.organizationId, a.gatewayId, b.unlinkedMachineId, a.unitId]),
      FK_ERROR,
    )
    // Declarando B: o gateway de A não existe como (id, B).
    await expectDbError(
      asOwner(linkGatewayMachine, [b.organizationId, a.gatewayId, b.unlinkedMachineId, b.unitId]),
      FK_ERROR,
    )
  })

  it("também não liga pelo papel da aplicação dentro do cliente A (a FK vale mesmo com RLS)", async () => {
    await expectDbError(
      asTenant(t.client, a.organizationId, (tx) =>
        tx.query(linkGatewayMachine, [a.organizationId, a.gatewayId, b.unlinkedMachineId, a.unitId]),
      ),
      FK_ERROR,
    )
  })

  it("o vínculo do próprio cliente funciona", async () => {
    await asTenant(t.client, a.organizationId, (tx) =>
      tx.query(linkGatewayMachine, [a.organizationId, a.gatewayId, a.unlinkedMachineId, a.unitId]),
    )
  })

  it("gateway e máquina precisam ser da MESMA unidade", async () => {
    await t.client.transaction(async (tx) => {
      const gw = await tx.query<{ id: string }>(
        "INSERT INTO gateway (organization_id, unit_id, name) VALUES ($1, $2, 'GW Planta 2') RETURNING id",
        [a.organizationId, a.otherUnitId],
      )
      const gatewayId = gw.rows[0]?.id
      // Declarando a unidade do gateway, a máquina (da Planta 1) não confere; e vice-versa.
      await tx.query("SAVEPOINT s1")
      await expectDbError(
        tx.query(linkGatewayMachine, [a.organizationId, gatewayId, a.unlinkedMachineId, a.otherUnitId]),
        /gateway_machine_machine_fk/,
      )
      await tx.query("ROLLBACK TO SAVEPOINT s1")
      await expectDbError(
        tx.query(linkGatewayMachine, [a.organizationId, gatewayId, a.unlinkedMachineId, a.unitId]),
        /gateway_machine_gateway_fk/,
      )
      await tx.rollback()
    })
  })

  it("uma máquina não pode ser alimentada por dois gateways", async () => {
    await t.client.transaction(async (tx) => {
      const gw = await tx.query<{ id: string }>(
        "INSERT INTO gateway (organization_id, unit_id, name) VALUES ($1, $2, 'GW reserva') RETURNING id",
        [a.organizationId, a.unitId],
      )
      await tx.query("SAVEPOINT s1")
      await expectDbError(
        tx.query(linkGatewayMachine, [a.organizationId, gw.rows[0]?.id, a.machineId, a.unitId]),
        /gateway_machine_machine_uq/,
      )
      await tx.rollback()
    })
  })

  it("tag: dispositivo de A + máquina de B é recusado", async () => {
    await expectDbError(
      asOwner(
        `INSERT INTO tag (organization_id, gateway_id, device_id, machine_id, address, data_type, role, poll_ms)
         VALUES ($1, $2, $3, $4, '{"area":"coil","offset":1}', 'bool', 'state.running', 1000)`,
        [a.organizationId, a.gatewayId, a.deviceId, b.machineId],
      ),
      FK_ERROR,
    )
  })

  it("tag: máquina do mesmo cliente, mas não ligada ao gateway do dispositivo, é recusada", async () => {
    await expectDbError(
      asOwner(
        `INSERT INTO tag (organization_id, gateway_id, device_id, machine_id, address, data_type, role, poll_ms)
         VALUES ($1, $2, $3, $4, '{"area":"coil","offset":1}', 'bool', 'state.running', 1000)`,
        [a.organizationId, a.gatewayId, a.deviceId, a.unlinkedMachineId],
      ),
      /tag_gateway_machine_fk/,
    )
  })

  it("dispositivo: dispositivo de B não entra no gateway de A; barramento RS-485 de outro gateway é recusado", async () => {
    await expectDbError(
      asOwner(
        `INSERT INTO device (organization_id, gateway_id, name, protocol, params)
         VALUES ($1, $2, 'Intruso', 'modbus-tcp', '{"host":"10.0.0.1","port":502,"unit_id":1}')`,
        [b.organizationId, a.gatewayId],
      ),
      FK_ERROR,
    )
    await expectDbError(
      asOwner(
        `INSERT INTO device (organization_id, gateway_id, serial_bus_id, name, protocol, params)
         VALUES ($1, $2, $3, 'RTU', 'modbus-rtu', '{"unit_id":2}')`,
        [a.organizationId, a.gatewayId, b.serialBusId],
      ),
      FK_ERROR,
    )
  })

  it("hierarquia: linha com área de outra unidade e máquina com linha de outro cliente são recusadas", async () => {
    await expectDbError(
      asOwner("INSERT INTO line (organization_id, unit_id, area_id, name) VALUES ($1, $2, $3, 'L')", [
        a.organizationId,
        a.otherUnitId,
        a.areaId,
      ]),
      /line_area_fk/,
    )
    await expectDbError(
      asOwner(
        `INSERT INTO machine (organization_id, unit_id, line_id, name, state_rules)
         VALUES ($1, $2, $3, 'M', '{"mode":"signals"}')`,
        [a.organizationId, a.unitId, b.lineId],
      ),
      FK_ERROR,
    )
  })

  it("séries temporais: o gateway de A não grava minuto, evento ou estado ao vivo em máquina de B", async () => {
    await expectDbError(
      asOwner(
        `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject)
         VALUES ($1, $2, date_trunc('minute', now()) + interval '1 day', 60, 0, 0, 0, 10, 0)`,
        [a.organizationId, b.machineId],
      ),
      FK_ERROR,
    )
    await expectDbError(
      asOwner(
        "INSERT INTO machine_state_event (organization_id, machine_id, state, started_at) VALUES ($1, $2, 'RUNNING', now())",
        [a.organizationId, b.machineId],
      ),
      FK_ERROR,
    )
    await expectDbError(
      asOwner(
        "INSERT INTO machine_live (organization_id, machine_id, state, state_since, at) VALUES ($1, $2, 'RUNNING', now(), now())",
        [a.organizationId, b.unlinkedMachineId],
      ),
      FK_ERROR,
    )
  })

  it("cadastros: produto de A × máquina de B e escopo com unidade de B são recusados", async () => {
    await expectDbError(
      asOwner(
        "INSERT INTO product_machine (organization_id, product_id, machine_id, ideal_cycle_s) VALUES ($1, $2, $3, 5)",
        [a.organizationId, a.productId, b.machineId],
      ),
      FK_ERROR,
    )
    await expectDbError(
      asOwner("INSERT INTO member_unit (organization_id, member_access_id, unit_id) VALUES ($1, $2, $3)", [
        a.organizationId,
        a.memberAccessId,
        b.unitId,
      ]),
      FK_ERROR,
    )
  })

  describe("escopo por máquina (member_machine, D11)", () => {
    const linkMemberMachine =
      "INSERT INTO member_machine (organization_id, member_access_id, machine_id) VALUES ($1, $2, $3)"

    it("não liga o vínculo de A a uma máquina de B (nem declarando o cliente A, nem o B)", async () => {
      // Declarando A: a máquina de B não existe como (id, A).
      await expectDbError(
        asOwner(linkMemberMachine, [a.organizationId, a.machineAccessId, b.machineId]),
        /member_machine_machine_fk/,
      )
      // Declarando B: o vínculo de A não existe como (id, B).
      await expectDbError(
        asOwner(linkMemberMachine, [b.organizationId, a.machineAccessId, b.machineId]),
        /member_machine_member_access_fk/,
      )
    })

    it("também não liga pelo papel da aplicação dentro do cliente A (a FK vale mesmo com RLS)", async () => {
      await expectDbError(
        asTenant(t.client, a.organizationId, (tx) =>
          tx.query(linkMemberMachine, [a.organizationId, a.machineAccessId, b.unlinkedMachineId]),
        ),
        /member_machine_machine_fk/,
      )
    })

    it("máquina inexistente é recusada; a do próprio cliente funciona", async () => {
      await expectDbError(
        asOwner(linkMemberMachine, [a.organizationId, a.machineAccessId, randomUUID()]),
        /member_machine_machine_fk/,
      )
      await asTenant(t.client, a.organizationId, (tx) =>
        tx.query(linkMemberMachine, [a.organizationId, a.machineAccessId, a.unlinkedMachineId]),
      )
    })
  })

  it("acesso remoto: encaminhamento só para dispositivo cadastrado no gateway da sessão", async () => {
    // Dispositivo de outro cliente.
    await expectDbError(
      asOwner(
        `INSERT INTO remote_access_forward (organization_id, session_id, gateway_id, device_id, target_host, target_port, requested_by, requested_duration_min)
         VALUES ($1, $2, $3, $4, '10.0.0.9', 502, $5, 30)`,
        [a.organizationId, a.remoteSessionId, a.gatewayId, b.deviceId, a.userId],
      ),
      FK_ERROR,
    )
  })

  describe("estorno de qualidade (quality_entry.reverses_id)", () => {
    const reverseQuality =
      "INSERT INTO quality_entry (organization_id, machine_id, at, quantity, reason, reverses_id) VALUES ($1, $2, now(), $3, 'Estorno', $4)"
    const REVERSES_FK = /quality_entry_reverses_fk/

    it("o app no cliente A não estorna lançamento do cliente B", async () => {
      await expectDbError(
        asTenant(t.client, a.organizationId, (tx) =>
          tx.query(reverseQuality, [a.organizationId, a.machineId, -3, b.qualityEntryId]),
        ),
        REVERSES_FK,
      )
      // Nem o dono do banco (sem RLS), declarando A ou B.
      await expectDbError(asOwner(reverseQuality, [a.organizationId, a.machineId, -3, b.qualityEntryId]), REVERSES_FK)
      await expectDbError(asOwner(reverseQuality, [b.organizationId, b.machineId, -3, a.qualityEntryId]), REVERSES_FK)
    })

    it("estorno de lançamento inexistente é recusado", async () => {
      await expectDbError(
        asTenant(t.client, a.organizationId, (tx) =>
          tx.query(reverseQuality, [a.organizationId, a.machineId, -3, randomUUID()]),
        ),
        REVERSES_FK,
      )
    })

    it("estorno tem quantidade negativa e não aponta para si mesmo", async () => {
      await expectDbError(
        asTenant(t.client, a.organizationId, (tx) =>
          tx.query(reverseQuality, [a.organizationId, a.machineId, 3, a.qualityEntryId]),
        ),
        /quality_entry_reversal_chk/,
      )
      const id = randomUUID()
      await expectDbError(
        asOwner(
          "INSERT INTO quality_entry (id, organization_id, machine_id, at, quantity, reverses_id) VALUES ($1, $2, $3, now(), -1, $1)",
          [id, a.organizationId, a.machineId],
        ),
        /quality_entry_reversal_chk/,
      )
    })

    it("o estorno do próprio cliente funciona (e lançamento comum segue sem reverses_id)", async () => {
      const rows = await asTenant(t.client, a.organizationId, async (tx) => {
        await tx.query(reverseQuality, [a.organizationId, a.machineId, -3, a.qualityEntryId])
        await tx.query(
          "INSERT INTO quality_entry (organization_id, machine_id, at, quantity, reason) VALUES ($1, $2, now(), 2, 'Bolha')",
          [a.organizationId, a.machineId],
        )
        const r = await tx.query<{ quantity: number; reverses_id: string | null }>(
          "SELECT quantity, reverses_id FROM quality_entry ORDER BY created_at, quantity",
        )
        return r.rows
      })
      expect(rows).toEqual([
        { quantity: 3, reverses_id: null },
        { quantity: -3, reverses_id: a.qualityEntryId },
        { quantity: 2, reverses_id: null },
      ])
    })
  })
})
