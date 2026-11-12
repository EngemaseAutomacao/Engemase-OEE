/**
 * Buscas antes de saber o cliente (autenticação do gateway, /enroll, terminal, tokens próprios e slug
 * da URL). O papel da aplicação não lê essas tabelas sem cliente, mas as funções SECURITY DEFINER
 * devolvem (id, organization_id) do registro cujo hash confere — e, nas variantes `*_state`, o estado
 * da credencial — e nada mais.
 */
import type { Transaction } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  GATEWAY_ENROLLMENT_STATES,
  GATEWAY_TOKEN_STATES,
  GATEWAY_TOKEN_VALID_STATES,
  gatewayEnrollmentStateSql,
  gatewayTokenStateSql,
  lookupSql,
  type RowsExecutor,
  resolveByTokenHash,
  resolveGatewayEnrollmentState,
  resolveGatewayTokenState,
  resolveOrganizationSlug,
  sha256Hex,
} from "../src/lookups"
import { type SeededTenant, seedTenant } from "./fixtures"
import { asTenant, count, createTestDatabase, expectDbError, type TestDatabase } from "./helpers"

/** Executa `fn` com o Drizzle como `app_user`, sem cliente definido (as buscas só leem). */
function asAppUserDb<T>(t: TestDatabase, fn: (db: RowsExecutor) => Promise<T>): Promise<T> {
  return t.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`)
    return fn(tx)
  })
}

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

  it("slug do cliente resolve sem cliente definido e devolve só o id", async () => {
    const rows = await asTenant(t.client, null, async (tx) => {
      const r = await tx.query<Record<string, unknown>>("SELECT * FROM app.resolve_org_slug($1)", [a.slug])
      return r.rows
    })
    expect(rows).toEqual([{ id: a.organizationId }])
    const none = await asTenant(t.client, null, async (tx) => {
      const r = await tx.query("SELECT * FROM app.resolve_org_slug($1)", ["inexistente"])
      return r.rows
    })
    expect(none).toEqual([])
    // ...e, mesmo assim, a tabela continua fechada para o app sem cliente.
    expect(await asTenant(t.client, null, (tx) => count(tx, "SELECT 1 FROM organization"))).toBe(0)
  })

  it("resolveOrganizationSlug() (Drizzle, como app_user) e validação do formato", async () => {
    expect(await asAppUserDb(t, (db) => resolveOrganizationSlug(db, b.slug))).toBe(b.organizationId)
    expect(await asAppUserDb(t, (db) => resolveOrganizationSlug(db, "nao-existe"))).toBeNull()
    // Formato inválido nem vai ao banco.
    const neverCalled: RowsExecutor = { execute: () => Promise.reject(new Error("não devia consultar")) }
    expect(await resolveOrganizationSlug(neverCalled, "Não É Slug")).toBeNull()
  })

  it("app_lookup lê só id e slug de organization", async () => {
    await expectDbError(
      t.client.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE app_lookup")
        await tx.query("SELECT name FROM organization")
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

describe("estado da credencial (código de ativação e token do gateway)", () => {
  let t: TestDatabase
  let a: SeededTenant
  let b: SeededTenant
  let enrollmentId: string

  beforeAll(async () => {
    t = await createTestDatabase()
    a = await seedTenant(t.db, "alfa")
    b = await seedTenant(t.db, "beta")
    const r = await t.client.query<{ id: string }>("SELECT id FROM gateway_enrollment WHERE organization_id = $1", [
      a.organizationId,
    ])
    enrollmentId = r.rows[0]?.id ?? ""
  })

  afterAll(async () => {
    await t.client.close()
  })

  /**
   * Monta um cenário como dono (`setup`), troca para `app_user` SEM cliente (início da requisição)
   * e consulta a função com o hash do segredo. Tudo é desfeito no fim.
   */
  async function scenario(
    setup: (tx: Transaction) => Promise<unknown>,
    fn: string,
    secret: string,
  ): Promise<Record<string, unknown>[]> {
    return t.client.transaction(async (tx) => {
      await setup(tx)
      await tx.exec("SET LOCAL ROLE app_user")
      const r = await tx.query<Record<string, unknown>>(`SELECT * FROM app.${fn}($1)`, [sha256Hex(secret)])
      await tx.rollback()
      return r.rows
    })
  }

  const nothing = async (): Promise<void> => {}

  describe("código de ativação: app.resolve_gateway_enrollment_state", () => {
    const fn = "resolve_gateway_enrollment_state"

    it("válido: devolve o registro, o cliente, o gateway e o estado", async () => {
      expect(await scenario(nothing, fn, a.enrollmentCode)).toEqual([
        { id: enrollmentId, organization_id: a.organizationId, gateway_id: a.gatewayId, state: "valid" },
      ])
      const fromB = await scenario(nothing, fn, b.enrollmentCode)
      expect(fromB).toHaveLength(1)
      expect(fromB[0]?.organization_id).toBe(b.organizationId)
    })

    it("código desconhecido: nenhuma linha (→ 400 activation_code_invalid)", async () => {
      expect(await scenario(nothing, fn, "ENR-inexistente")).toEqual([])
    })

    it("usado → used; vencido → expired; usado E vencido → used", async () => {
      const markUsed = (tx: Transaction) =>
        tx.query("UPDATE gateway_enrollment SET used_at = now() WHERE id = $1", [enrollmentId])
      // Vencido: expires_at logo depois da criação (o CHECK exige expires_at > created_at), já no passado.
      const markExpired = (tx: Transaction) =>
        tx.query("UPDATE gateway_enrollment SET expires_at = created_at + interval '1 microsecond' WHERE id = $1", [
          enrollmentId,
        ])
      expect((await scenario(markUsed, fn, a.enrollmentCode))[0]?.state).toBe("used")
      expect((await scenario(markExpired, fn, a.enrollmentCode))[0]?.state).toBe("expired")
      const both = async (tx: Transaction) => {
        await markUsed(tx)
        await markExpired(tx)
      }
      expect((await scenario(both, fn, a.enrollmentCode))[0]?.state).toBe("used")
    })

    it("gateway revogado ou excluído → gateway_revoked (mesmo com o código já usado)", async () => {
      const revoke = (tx: Transaction) =>
        tx.query("UPDATE gateway SET status = 'revoked', revoked_at = now() WHERE id = $1", [a.gatewayId])
      expect((await scenario(revoke, fn, a.enrollmentCode))[0]?.state).toBe("gateway_revoked")
      const revokeUsed = async (tx: Transaction) => {
        await revoke(tx)
        await tx.query("UPDATE gateway_enrollment SET used_at = now() WHERE id = $1", [enrollmentId])
      }
      expect((await scenario(revokeUsed, fn, a.enrollmentCode))[0]?.state).toBe("gateway_revoked")
      const remove = (tx: Transaction) => tx.query("UPDATE gateway SET deleted_at = now() WHERE id = $1", [a.gatewayId])
      expect((await scenario(remove, fn, a.enrollmentCode))[0]?.state).toBe("gateway_revoked")
    })

    it("a função antiga (só válidos) concorda: devolve linha só no estado valid", async () => {
      const setups: [string, (tx: Transaction) => Promise<unknown>][] = [
        ["valid", nothing],
        ["used", (tx) => tx.query("UPDATE gateway_enrollment SET used_at = now() WHERE id = $1", [enrollmentId])],
        [
          "gateway_revoked",
          (tx) => tx.query("UPDATE gateway SET status = 'revoked', revoked_at = now() WHERE id = $1", [a.gatewayId]),
        ],
      ]
      for (const [state, setup] of setups) {
        const old = await scenario(setup, "resolve_gateway_enrollment", a.enrollmentCode)
        expect(old.length, state).toBe(state === "valid" ? 1 : 0)
      }
    })
  })

  describe("token do gateway: app.resolve_gateway_token_state", () => {
    const fn = "resolve_gateway_token_state"
    const newToken = "gw_live_novo_token_da_rotacao"
    /** Rotação: o token do seed vira o anterior (válido por mais 10 min) e entra um novo. */
    const rotate = (tx: Transaction) =>
      tx.query(
        `UPDATE gateway SET previous_token_hash = token_hash, previous_token_expires_at = now() + interval '10 minutes',
           token_hash = $2 WHERE id = $1`,
        [a.gatewayId, sha256Hex(newToken)],
      )

    it("token atual de gateway ativo → active (só id, organization_id e state)", async () => {
      expect(await scenario(nothing, fn, a.gatewayToken)).toEqual([
        { id: a.gatewayId, organization_id: a.organizationId, state: "active" },
      ])
      expect(await scenario(nothing, fn, b.gatewayToken)).toEqual([
        { id: b.gatewayId, organization_id: b.organizationId, state: "active" },
      ])
    })

    it("token desconhecido: nenhuma linha (→ 401 unauthorized)", async () => {
      expect(await scenario(nothing, fn, "gw_live_inexistente")).toEqual([])
    })

    it("rotação: novo → active, anterior → previous; terminada a janela, anterior → rotated", async () => {
      expect((await scenario(rotate, fn, newToken))[0]?.state).toBe("active")
      expect((await scenario(rotate, fn, a.gatewayToken))[0]?.state).toBe("previous")
      const windowOver = async (tx: Transaction) => {
        await rotate(tx)
        await tx.query("UPDATE gateway SET previous_token_expires_at = now() - interval '1 second' WHERE id = $1", [
          a.gatewayId,
        ])
      }
      expect((await scenario(windowOver, fn, a.gatewayToken))[0]?.state).toBe("rotated")
      expect((await scenario(windowOver, fn, newToken))[0]?.state).toBe("active")
    })

    it("gateway revogado ou excluído → revoked (token atual e anterior)", async () => {
      const revoke = async (tx: Transaction) => {
        await rotate(tx)
        await tx.query("UPDATE gateway SET status = 'revoked', revoked_at = now() WHERE id = $1", [a.gatewayId])
      }
      expect(await scenario(revoke, fn, newToken)).toEqual([
        { id: a.gatewayId, organization_id: a.organizationId, state: "revoked" },
      ])
      expect((await scenario(revoke, fn, a.gatewayToken))[0]?.state).toBe("revoked")
      const remove = (tx: Transaction) => tx.query("UPDATE gateway SET deleted_at = now() WHERE id = $1", [a.gatewayId])
      expect((await scenario(remove, fn, a.gatewayToken))[0]?.state).toBe("revoked")
    })

    it("gateway aguardando nova ativação → pending_enrollment", async () => {
      const pending = (tx: Transaction) =>
        tx.query("UPDATE gateway SET status = 'pending_enrollment' WHERE id = $1", [a.gatewayId])
      expect((await scenario(pending, fn, a.gatewayToken))[0]?.state).toBe("pending_enrollment")
    })

    it("a função antiga concorda: autentica só nos estados active e previous", async () => {
      const cases: [string, (tx: Transaction) => Promise<unknown>, string][] = [
        ["active", rotate, newToken],
        ["previous", rotate, a.gatewayToken],
        [
          "rotated",
          async (tx) => {
            await rotate(tx)
            await tx.query("UPDATE gateway SET previous_token_expires_at = now() - interval '1 second' WHERE id = $1", [
              a.gatewayId,
            ])
          },
          a.gatewayToken,
        ],
        [
          "revoked",
          (tx) => tx.query("UPDATE gateway SET status = 'revoked', revoked_at = now() WHERE id = $1", [a.gatewayId]),
          a.gatewayToken,
        ],
      ]
      for (const [state, setup, secret] of cases) {
        expect((await scenario(setup, fn, secret))[0]?.state, state).toBe(state)
        const old = await scenario(setup, "resolve_gateway_token", secret)
        expect(old.length, state).toBe((GATEWAY_TOKEN_VALID_STATES as readonly string[]).includes(state) ? 1 : 0)
      }
    })
  })

  it("helpers do Drizzle (como app_user, sem cliente) e SQL parametrizado", async () => {
    expect(await asAppUserDb(t, (db) => resolveGatewayTokenState(db, sha256Hex(a.gatewayToken)))).toEqual({
      id: a.gatewayId,
      organizationId: a.organizationId,
      state: "active",
    })
    expect(await asAppUserDb(t, (db) => resolveGatewayTokenState(db, sha256Hex("gw_live_x")))).toBeNull()
    expect(await asAppUserDb(t, (db) => resolveGatewayEnrollmentState(db, sha256Hex(b.enrollmentCode)))).toEqual({
      id: expect.any(String),
      organizationId: b.organizationId,
      gatewayId: b.gatewayId,
      state: "valid",
    })
    expect(await asAppUserDb(t, (db) => resolveGatewayEnrollmentState(db, sha256Hex("nada")))).toBeNull()

    expect(() => gatewayTokenStateSql("nao-e-hash")).toThrow(/SHA-256/)
    expect(() => gatewayEnrollmentStateSql("nao-e-hash")).toThrow(/SHA-256/)
    const dialect = new PgDialect()
    const tokenQuery = dialect.sqlToQuery(gatewayTokenStateSql(sha256Hex("x")))
    expect(tokenQuery.params).toEqual([sha256Hex("x")])
    expect(tokenQuery.sql).toBe("SELECT id, organization_id, state FROM app.resolve_gateway_token_state($1)")
    const codeQuery = dialect.sqlToQuery(gatewayEnrollmentStateSql(sha256Hex("x")))
    expect(codeQuery.sql).toBe(
      "SELECT id, organization_id, gateway_id, state FROM app.resolve_gateway_enrollment_state($1)",
    )
  })

  it("as listas de estados do TypeScript cobrem os estados que o banco devolve", () => {
    expect([...GATEWAY_ENROLLMENT_STATES].sort()).toEqual(["expired", "gateway_revoked", "used", "valid"])
    expect([...GATEWAY_TOKEN_STATES].sort()).toEqual(["active", "pending_enrollment", "previous", "revoked", "rotated"])
  })
})
