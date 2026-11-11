/**
 * RLS direto no banco (docs/15, seção 4, item 7.2): com `app.org_id = A`, o papel da aplicação
 * não lê nem grava dados do cliente B — em TODAS as tabelas de cliente.
 */
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { machine, unit } from "../src/schema/index"
import { NULLABLE_TENANT_TABLES, TENANT_TABLE_NAMES, TenantContextError, withTenant } from "../src/tenancy"
import { type SeededTenant, seedPlatformAuditEvent, seedTenant } from "./fixtures"
import { asRole, asTenant, count, createTestDatabase, expectDbError, ident, type TestDatabase } from "./helpers"

const RLS_ERROR = /row-level security/

describe("RLS por cliente", () => {
  let t: TestDatabase
  let a: SeededTenant
  let b: SeededTenant

  beforeAll(async () => {
    t = await createTestDatabase()
    a = await seedTenant(t.db, "alfa")
    b = await seedTenant(t.db, "beta")
    await seedPlatformAuditEvent(t.db)
  })

  afterAll(async () => {
    await t.client.close()
  })

  it("o seed tem dados dos dois clientes em todas as tabelas de cliente (visto pelo dono)", async () => {
    for (const table of TENANT_TABLE_NAMES) {
      for (const org of [a, b]) {
        const n = await count(t.client, `SELECT 1 FROM ${ident(table)} WHERE organization_id = $1`, [
          org.organizationId,
        ])
        expect(n, `${table} sem dados de ${org.slug}`).toBeGreaterThan(0)
      }
    }
  })

  it("SELECT: com app.org_id = A, cada tabela de cliente só mostra linhas de A", async () => {
    await asTenant(t.client, a.organizationId, async (tx) => {
      for (const table of TENANT_TABLE_NAMES) {
        const own = await count(tx, `SELECT 1 FROM ${ident(table)}`)
        const others = await count(tx, `SELECT 1 FROM ${ident(table)} WHERE organization_id IS DISTINCT FROM $1`, [
          a.organizationId,
        ])
        expect(own, `${table}: deveria ver as próprias linhas`).toBeGreaterThan(0)
        expect(others, `${table}: vazou linha de outro cliente`).toBe(0)
      }
    })
  })

  it("SELECT por id de B, com app.org_id = A, volta vazio", async () => {
    await asTenant(t.client, a.organizationId, async (tx) => {
      expect(await count(tx, "SELECT 1 FROM machine WHERE id = $1", [b.machineId])).toBe(0)
      expect(await count(tx, "SELECT 1 FROM gateway WHERE id = $1", [b.gatewayId])).toBe(0)
      expect(await count(tx, "SELECT 1 FROM production_minute WHERE machine_id = $1", [b.machineId])).toBe(0)
      expect(await count(tx, "SELECT 1 FROM member WHERE organization_id = $1", [b.organizationId])).toBe(0)
    })
  })

  it("sem app.org_id definido, nenhuma tabela de cliente mostra nada (fail-closed)", async () => {
    await asTenant(t.client, null, async (tx) => {
      for (const table of TENANT_TABLE_NAMES) {
        expect(await count(tx, `SELECT 1 FROM ${ident(table)}`), table).toBe(0)
      }
    })
  })

  it("eventos de plataforma (auditoria sem cliente) ficam invisíveis para o app", async () => {
    expect(NULLABLE_TENANT_TABLES).toEqual(["audit_log"])
    expect(await count(t.client, "SELECT 1 FROM audit_log WHERE organization_id IS NULL")).toBe(1)
    await asTenant(t.client, a.organizationId, async (tx) => {
      expect(await count(tx, "SELECT 1 FROM audit_log WHERE organization_id IS NULL")).toBe(0)
    })
  })

  it("INSERT de linha do cliente B com app.org_id = A é bloqueado", async () => {
    await expect(
      asTenant(t.client, a.organizationId, (tx) =>
        tx.query("INSERT INTO unit (organization_id, name) VALUES ($1, 'Intrusa')", [b.organizationId]),
      ),
    ).rejects.toThrow(RLS_ERROR)

    await expect(
      asTenant(t.client, a.organizationId, (tx) =>
        tx.query(
          `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject)
           VALUES ($1, $2, date_trunc('minute', now()), 60, 0, 0, 0, 10, 0)`,
          [b.organizationId, b.machineId],
        ),
      ),
    ).rejects.toThrow(RLS_ERROR)

    await expect(
      asTenant(t.client, a.organizationId, (tx) =>
        tx.query("INSERT INTO audit_log (organization_id, actor_type, action) VALUES ($1, 'user', 'x')", [
          b.organizationId,
        ]),
      ),
    ).rejects.toThrow(RLS_ERROR)
  })

  it("INSERT sem cliente (ou com organization_id nulo na auditoria) é bloqueado", async () => {
    await expect(
      asTenant(t.client, null, (tx) =>
        tx.query("INSERT INTO unit (organization_id, name) VALUES ($1, 'Sem contexto')", [a.organizationId]),
      ),
    ).rejects.toThrow(RLS_ERROR)
    await expect(
      asTenant(t.client, a.organizationId, (tx) =>
        tx.query("INSERT INTO audit_log (organization_id, actor_type, action) VALUES (NULL, 'system', 'x')"),
      ),
    ).rejects.toThrow(RLS_ERROR)
  })

  it("INSERT do próprio cliente funciona (a RLS não atrapalha o caminho feliz)", async () => {
    const inserted = await asTenant(t.client, a.organizationId, async (tx) => {
      await tx.query("INSERT INTO unit (organization_id, name) VALUES ($1, 'Planta 3')", [a.organizationId])
      await tx.query(
        `INSERT INTO production_minute (organization_id, machine_id, bucket_start, run_s, stop_s, fault_s, no_comm_s, total, reject)
         VALUES ($1, $2, date_trunc('minute', now()) + interval '1 day', 60, 0, 0, 0, 10, 0)`,
        [a.organizationId, a.machineId],
      )
      return count(tx, "SELECT 1 FROM unit WHERE name = 'Planta 3'")
    })
    expect(inserted).toBe(1)
  })

  it("UPDATE e DELETE de linhas de B, com app.org_id = A, não atingem nada", async () => {
    const affected = await asTenant(t.client, a.organizationId, async (tx) => {
      const results: Record<string, number> = {}
      const upd = await tx.query("UPDATE machine SET name = 'Hackeada' WHERE id = $1", [b.machineId])
      results.updateMachine = upd.affectedRows ?? 0
      const updAll = await tx.query("UPDATE unit SET name = name || '!' WHERE organization_id = $1", [b.organizationId])
      results.updateUnits = updAll.affectedRows ?? 0
      const del = await tx.query("DELETE FROM tag WHERE organization_id = $1", [b.organizationId])
      results.deleteTags = del.affectedRows ?? 0
      return results
    })
    expect(affected).toEqual({ updateMachine: 0, updateUnits: 0, deleteTags: 0 })
    const name = await t.client.query<{ name: string }>("SELECT name FROM machine WHERE id = $1", [b.machineId])
    expect(name.rows[0]?.name).toBe("Injetora 03")
  })

  it("UPDATE em massa em todas as tabelas de cliente com GRANT de UPDATE não atinge B", async () => {
    const result = await t.client.query<{ name: string }>(`
      SELECT DISTINCT table_name AS name FROM information_schema.role_table_grants
      WHERE grantee = 'app_user' AND privilege_type = 'UPDATE' AND table_schema = 'public'`)
    const updatable = result.rows.map((r) => r.name).filter((name) => TENANT_TABLE_NAMES.includes(name))
    expect(updatable.length).toBeGreaterThan(30)
    await asTenant(t.client, a.organizationId, async (tx) => {
      for (const table of updatable) {
        const r = await tx.query(
          `UPDATE ${ident(table)} SET organization_id = organization_id WHERE organization_id = $1`,
          [b.organizationId],
        )
        expect(r.affectedRows ?? 0, table).toBe(0)
      }
    })
  })

  it("UPDATE que tenta mover uma linha de A para B é bloqueado (WITH CHECK)", async () => {
    await expect(
      asTenant(t.client, a.organizationId, (tx) =>
        tx.query("UPDATE product SET organization_id = $1 WHERE id = $2", [b.organizationId, a.productId]),
      ),
    ).rejects.toThrow(RLS_ERROR)
  })

  it("não dá para trocar de cliente no meio da transação", async () => {
    await expect(
      asTenant(t.client, a.organizationId, (tx) => tx.query("SELECT app.set_tenant($1::uuid)", [b.organizationId])),
    ).rejects.toThrow(/outro cliente/)
  })

  it("app.org_id inválido derruba a consulta em vez de abrir os dados", async () => {
    await expect(
      asTenant(t.client, null, async (tx) => {
        await tx.query("SELECT set_config('app.org_id', 'nao-e-uuid', true)")
        return tx.query("SELECT 1 FROM machine")
      }),
    ).rejects.toThrow(/invalid input syntax for type uuid/)
  })

  it("GRANTs: auditoria só inserção, client_account só leitura, produção sem DELETE", async () => {
    const denied = /permission denied/
    await expect(
      asTenant(t.client, a.organizationId, (tx) => tx.query("UPDATE audit_log SET action = 'x'")),
    ).rejects.toThrow(denied)
    await expect(asTenant(t.client, a.organizationId, (tx) => tx.query("DELETE FROM audit_log"))).rejects.toThrow(
      denied,
    )
    await expect(
      asTenant(t.client, a.organizationId, (tx) => tx.query("UPDATE remote_access_event SET type = 'x'")),
    ).rejects.toThrow(denied)
    await expect(
      asTenant(t.client, a.organizationId, (tx) => tx.query("UPDATE client_account SET status = 'active'")),
    ).rejects.toThrow(denied)
    await expect(
      asTenant(t.client, a.organizationId, (tx) => tx.query("DELETE FROM production_minute")),
    ).rejects.toThrow(denied)
    await expect(asTenant(t.client, a.organizationId, (tx) => tx.query("SELECT 1 FROM session"))).rejects.toThrow(
      denied,
    )
    await expect(
      asTenant(t.client, a.organizationId, (tx) => tx.query("SELECT app.enable_tenant_rls('public.unit')")),
    ).rejects.toThrow(denied)
    // O cliente lê o próprio estado/plano.
    const status = await asTenant(t.client, a.organizationId, (tx) =>
      tx.query<{ status: string }>("SELECT status FROM client_account"),
    )
    expect(status.rows).toEqual([{ status: "active" }])
  })

  it('"user": o app só enxerga os membros do cliente atual', async () => {
    const emails = await asTenant(t.client, a.organizationId, async (tx) => {
      const r = await tx.query<{ email: string }>('SELECT email FROM "user" ORDER BY email')
      return r.rows.map((row) => row.email)
    })
    expect(emails).toEqual(["admin@alfa.example"])
    // Sem cliente, ninguém.
    expect(await asTenant(t.client, null, (tx) => count(tx, 'SELECT 1 FROM "user"'))).toBe(0)
  })

  it("auth_service (Better Auth) vê vínculos de todos os clientes, mas nada de produção", async () => {
    const members = await asRole(t.client, "auth_service", null, (tx) => count(tx, "SELECT 1 FROM member"))
    expect(members).toBe(2)
    await expect(asRole(t.client, "auth_service", null, (tx) => tx.query("SELECT 1 FROM machine"))).rejects.toThrow(
      /permission denied/,
    )
    await expect(asRole(t.client, "auth_service", null, (tx) => tx.query("DELETE FROM organization"))).rejects.toThrow(
      /permission denied/,
    )
  })

  it("withTenant() (Drizzle) isola as consultas tipadas", async () => {
    // Sem opções: o padrão já assume app_user (o PGlite conecta como superusuário).
    const machines = await withTenant(t.db, a.organizationId, (q) => q.select({ id: machine.id }).from(machine))
    expect(machines.map((m) => m.id).sort()).toEqual([a.machineId, a.unlinkedMachineId].sort())
  })

  it("withTenant() bloqueia escrita em outro cliente e valida o id", async () => {
    await expectDbError(
      withTenant(t.db, a.organizationId, (q) =>
        q.insert(unit).values({ organizationId: b.organizationId, name: "Intrusa" }),
      ),
      RLS_ERROR,
    )
    const renamed = await withTenant(t.db, a.organizationId, (q) =>
      q.update(machine).set({ name: "X" }).where(eq(machine.id, b.machineId)).returning(),
    )
    expect(renamed).toEqual([])
    await expect(withTenant(t.db, "alfa", async () => 1)).rejects.toThrow(TenantContextError)
    await expect(withTenant(t.db, "00000000-0000-0000-0000-00000000000g", async () => 1)).rejects.toThrow(
      TenantContextError,
    )
    await expect(withTenant(t.db, randomUUID(), async () => 1, { role: "postgres" as never })).rejects.toThrow(
      TenantContextError,
    )
  })

  it("withTenant(..., { role: null }) com conexão de superusuário NÃO isola (por isso o padrão é app_user)", async () => {
    const all = await withTenant(t.db, a.organizationId, (q) => q.select({ id: machine.id }).from(machine), {
      role: null,
    })
    expect(all.length).toBe(4)
  })
})
