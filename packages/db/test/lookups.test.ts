/**
 * Buscas por hash de token antes de saber o cliente (autenticação do gateway, /enroll, terminal e
 * tokens próprios). O papel da aplicação não lê essas tabelas sem cliente, mas as funções
 * SECURITY DEFINER devolvem (id, organization_id) do registro cujo hash confere — e nada mais.
 */
import { PgDialect } from "drizzle-orm/pg-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { lookupSql, resolveByTokenHash, sha256Hex } from "../src/lookups"
import { type SeededTenant, seedTenant } from "./fixtures"
import { asTenant, count, createTestDatabase, expectDbError, type TestDatabase } from "./helpers"

describe("buscas por hash de token", () => {
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

  /** Busca como `app_user`, SEM cliente definido (como no início de uma requisição do gateway). */
  async function lookup(fn: string, token: string): Promise<{ id: string; organization_id: string }[]> {
    return asTenant(t.client, null, async (tx) => {
      const r = await tx.query<{ id: string; organization_id: string }>(`SELECT * FROM app.${fn}($1)`, [
        sha256Hex(token),
      ])
      return r.rows
    })
  }

  it("sem cliente, o app_user não lê as tabelas de credenciais diretamente", async () => {
    await asTenant(t.client, null, async (tx) => {
      expect(await count(tx, "SELECT 1 FROM gateway")).toBe(0)
      expect(await count(tx, "SELECT 1 FROM gateway_enrollment")).toBe(0)
      expect(await count(tx, "SELECT 1 FROM terminal")).toBe(0)
      expect(await count(tx, "SELECT 1 FROM account_token")).toBe(0)
    })
  })

  it("token do gateway resolve para o gateway e o cliente certos", async () => {
    expect(await lookup("resolve_gateway_token", a.gatewayToken)).toEqual([
      { id: a.gatewayId, organization_id: a.organizationId },
    ])
    expect(await lookup("resolve_gateway_token", b.gatewayToken)).toEqual([
      { id: b.gatewayId, organization_id: b.organizationId },
    ])
    expect(await lookup("resolve_gateway_token", "gw_live_inexistente")).toEqual([])
  })

  it("gateway revogado não autentica; token anterior vale só durante a rotação", async () => {
    const newToken = "gw_live_novo"
    await t.client.query(
      `UPDATE gateway SET previous_token_hash = token_hash, previous_token_expires_at = now() + interval '10 minutes',
         token_hash = $2 WHERE id = $1`,
      [a.gatewayId, sha256Hex(newToken)],
    )
    expect(await lookup("resolve_gateway_token", newToken)).toHaveLength(1)
    expect(await lookup("resolve_gateway_token", a.gatewayToken)).toHaveLength(1)

    await t.client.query("UPDATE gateway SET previous_token_expires_at = now() - interval '1 second' WHERE id = $1", [
      a.gatewayId,
    ])
    expect(await lookup("resolve_gateway_token", a.gatewayToken)).toEqual([])

    await t.client.query("UPDATE gateway SET status = 'revoked', revoked_at = now() WHERE id = $1", [a.gatewayId])
    expect(await lookup("resolve_gateway_token", newToken)).toEqual([])
  })

  it("código de ativação: válido uma vez e dentro do prazo", async () => {
    const found = await lookup("resolve_gateway_enrollment", b.enrollmentCode)
    expect(found).toHaveLength(1)
    expect(found[0]?.organization_id).toBe(b.organizationId)

    await t.client.query("UPDATE gateway_enrollment SET used_at = now() WHERE organization_id = $1", [b.organizationId])
    expect(await lookup("resolve_gateway_enrollment", b.enrollmentCode)).toEqual([])
  })

  it("terminal: token válido resolve; revogado não", async () => {
    expect(await lookup("resolve_terminal_token", b.terminalToken)).toEqual([
      { id: b.terminalId, organization_id: b.organizationId },
    ])
    await t.client.query("UPDATE terminal SET revoked_at = now() WHERE id = $1", [b.terminalId])
    expect(await lookup("resolve_terminal_token", b.terminalToken)).toEqual([])
  })

  it("token próprio de uso único: válido até ser usado", async () => {
    const found = await lookup("resolve_account_token", b.accountToken)
    expect(found).toHaveLength(1)
    expect(found[0]?.organization_id).toBe(b.organizationId)
    await t.client.query("UPDATE account_token SET used_at = now() WHERE organization_id = $1", [b.organizationId])
    expect(await lookup("resolve_account_token", b.accountToken)).toEqual([])
  })

  it("a função de busca não serve para ler outras colunas nem outras tabelas", async () => {
    // app_lookup só tem SELECT em colunas de credencial: nem o dono da função lê o nome do gateway.
    await expectDbError(
      t.client.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE app_lookup")
        await tx.query("SELECT name FROM gateway")
      }),
      /permission denied/,
    )
    await expectDbError(
      t.client.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE app_lookup")
        await tx.query("SELECT 1 FROM machine")
      }),
      /permission denied/,
    )
  })

  it("resolveByTokenHash() (Drizzle) e validação do hash", async () => {
    const ref = await resolveByTokenHash(t.db, "terminalToken", sha256Hex(a.terminalToken))
    expect(ref).toEqual({ id: a.terminalId, organizationId: a.organizationId })
    expect(await resolveByTokenHash(t.db, "accountToken", sha256Hex("nada"))).toBeNull()
    expect(() => lookupSql("gatewayToken", "nao-e-hash")).toThrow(/SHA-256/)
    // O SQL usa parâmetro (nada de interpolar o hash).
    const query = new PgDialect().sqlToQuery(lookupSql("gatewayToken", sha256Hex("x")))
    expect(query.params).toEqual([sha256Hex("x")])
    expect(query.sql).toBe("SELECT id, organization_id FROM app.resolve_gateway_token($1)")
  })
})
