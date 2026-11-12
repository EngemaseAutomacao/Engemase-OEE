/**
 * Teste de catálogo (docs/15, seção 4, item 7.1): falha se alguma tabela com `organization_id`
 * ficar sem RLS forçada, sem a política restritiva de cliente ou com FK não composta.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { NULLABLE_TENANT_TABLES, TENANT_TABLE_NAMES } from "../src/tenancy"
import {
  applicationRoles,
  nullableOrganizationIdColumns,
  permissivePolicies,
  securityDefinerFunctionExecutors,
  securityDefinerFunctions,
  tablesReadableByAppUserWithoutForcedRls,
  tablesWithOrganizationId,
  tenantForeignKeysWithoutOrganization,
  tenantTablesWithoutForcedRls,
  tenantTablesWithoutIsolationPolicy,
  tenantTablesWithoutOrganizationFk,
} from "./catalog"
import { createTestDatabase, type TestDatabase } from "./helpers"

describe("catálogo do banco", () => {
  let t: TestDatabase

  beforeAll(async () => {
    t = await createTestDatabase()
  })

  afterAll(async () => {
    await t.client.close()
  })

  it("as tabelas com organization_id no banco são as do schema TypeScript", async () => {
    expect(await tablesWithOrganizationId(t.client)).toEqual([...TENANT_TABLE_NAMES])
    // Sanidade: a lista cobre o que a tarefa exige (inclusive séries temporais e auditoria).
    expect(TENANT_TABLE_NAMES).toEqual(
      expect.arrayContaining(["production_minute", "machine_state_event", "oee_shift", "audit_log", "member", "tag"]),
    )
  })

  it("toda tabela com organization_id tem RLS habilitada E forçada", async () => {
    expect(await tenantTablesWithoutForcedRls(t.client)).toEqual([])
  })

  it("toda tabela com organization_id tem a política restritiva de cliente para app_user", async () => {
    expect(await tenantTablesWithoutIsolationPolicy(t.client)).toEqual([])
  })

  it("o teste de catálogo pega uma tabela nova esquecida sem RLS", async () => {
    await t.client.transaction(async (tx) => {
      await tx.exec("CREATE TABLE public.rogue (id uuid PRIMARY KEY, organization_id uuid NOT NULL)")
      expect(await tenantTablesWithoutForcedRls(tx)).toEqual(["rogue"])
      expect(await tenantTablesWithoutIsolationPolicy(tx)).toEqual(["rogue"])
      // Só ENABLE (sem FORCE) também é pego: o dono da tabela passaria por cima da RLS.
      await tx.exec("ALTER TABLE public.rogue ENABLE ROW LEVEL SECURITY")
      expect(await tenantTablesWithoutForcedRls(tx)).toEqual(["rogue"])
      // Com a função da migração, a tabela fica conforme.
      await tx.exec("SELECT app.enable_tenant_rls('public.rogue')")
      expect(await tenantTablesWithoutForcedRls(tx)).toEqual([])
      expect(await tenantTablesWithoutIsolationPolicy(tx)).toEqual([])
      await tx.rollback()
    })
  })

  it("toda tabela que o app_user pode ler tem RLS habilitada E forçada (inclusive organization e user)", async () => {
    expect(await tablesReadableByAppUserWithoutForcedRls(t.client)).toEqual([])
    // Sanidade: as tabelas de identidade que o app lê estão no alcance da verificação.
    const readable = await t.client.query<{ name: string }>(`
      SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('organization', 'user')
        AND has_any_column_privilege('app_user', c.oid, 'SELECT')
      ORDER BY 1`)
    expect(readable.rows.map((r) => r.name)).toEqual(["organization", "user"])
  })

  it("o teste pega uma tabela sem organization_id legível pelo app e sem RLS", async () => {
    await t.client.transaction(async (tx) => {
      await tx.exec("CREATE TABLE public.rogue_lookup (id uuid PRIMARY KEY, label text)")
      await tx.exec("GRANT SELECT (id) ON public.rogue_lookup TO app_user")
      expect(await tablesReadableByAppUserWithoutForcedRls(tx)).toEqual(["rogue_lookup"])
      await tx.rollback()
    })
  })

  it("organization_id é NOT NULL em todas as tabelas de cliente, exceto a auditoria", async () => {
    expect(await nullableOrganizationIdColumns(t.client)).toEqual([...NULLABLE_TENANT_TABLES])
  })

  it("toda tabela de cliente referencia organization(id)", async () => {
    expect(await tenantTablesWithoutOrganizationFk(t.client)).toEqual([])
  })

  it("toda FK entre tabelas de cliente é composta com organization_id", async () => {
    expect(await tenantForeignKeysWithoutOrganization(t.client)).toEqual([])
  })

  it("o teste de FK composta pega uma FK simples entre tabelas de cliente", async () => {
    await t.client.transaction(async (tx) => {
      await tx.exec(
        "CREATE TABLE public.rogue_child (id uuid PRIMARY KEY, organization_id uuid NOT NULL, machine_id uuid REFERENCES public.machine (id))",
      )
      const found = await tenantForeignKeysWithoutOrganization(tx)
      expect(found.map((fk) => fk.from)).toEqual(["rogue_child"])
      await tx.rollback()
    })
  })

  it("os papéis da aplicação não são superusuário nem têm BYPASSRLS", async () => {
    expect(await applicationRoles(t.client)).toEqual([
      { name: "app_lookup", superuser: false, bypassRls: false },
      { name: "app_user", superuser: false, bypassRls: false },
      { name: "auth_service", superuser: false, bypassRls: false },
    ])
  })

  it("as políticas permissivas são só as previstas (qualquer nova exige revisão)", async () => {
    const policies = await permissivePolicies(t.client)
    const unexpected = policies.filter((p) => {
      if (p.policy === "tenant_access") return !(p.roles === "app_user" && TENANT_TABLE_NAMES.includes(p.table))
      if (p.policy === "auth_service_all") {
        return !(p.roles === "auth_service" && ["member", "organization", "user"].includes(p.table))
      }
      if (p.policy === "user_member_of_tenant")
        return !(p.roles === "app_user" && p.table === "user" && p.cmd === "SELECT")
      if (p.policy === "organization_of_tenant")
        return !(p.roles === "app_user" && p.table === "organization" && p.cmd === "SELECT")
      if (p.policy === "lookup_by_slug")
        return !(p.roles === "app_lookup" && p.table === "organization" && p.cmd === "SELECT")
      if (p.policy === "lookup_by_token_hash") {
        return !(
          p.roles === "app_lookup" &&
          p.cmd === "SELECT" &&
          ["gateway", "gateway_enrollment", "terminal", "account_token"].includes(p.table)
        )
      }
      return true
    })
    expect(unexpected).toEqual([])
    // Toda tabela de cliente tem a permissiva do app_user (sem ela, o app não leria nada).
    const withAccess = policies.filter((p) => p.policy === "tenant_access").map((p) => p.table)
    expect(withAccess).toEqual([...TENANT_TABLE_NAMES])
  })

  it("as funções SECURITY DEFINER pertencem a app_lookup e fixam o search_path", async () => {
    const functions = await securityDefinerFunctions(t.client)
    expect(functions.map((f) => f.name)).toEqual([
      "resolve_account_token",
      "resolve_gateway_enrollment",
      "resolve_gateway_enrollment_state",
      "resolve_gateway_token",
      "resolve_gateway_token_state",
      "resolve_org_slug",
      "resolve_terminal_token",
    ])
    for (const f of functions) {
      expect(f.owner).toBe("app_lookup")
      expect(f.config).toContain("search_path=pg_catalog, pg_temp")
    }
  })

  it("as funções SECURITY DEFINER só podem ser executadas pelo app_user (nunca PUBLIC)", async () => {
    const executors = await securityDefinerFunctionExecutors(t.client)
    expect(executors.length).toBe(7)
    for (const f of executors) expect(f.executors, f.name).toBe("app_lookup,app_user")
    // auth_service não resolve token nem slug (não precisa: lê organization pela própria política).
    const authCanExecute = await t.client.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app' AND p.prosecdef AND has_function_privilege('auth_service', p.oid, 'EXECUTE')`)
    expect(authCanExecute.rows[0]?.n).toBe(0)
  })

  it("app_user não tem nenhum privilégio nas tabelas internas do Better Auth", async () => {
    const result = await t.client.query<{ table: string; privilege: string }>(`
      SELECT table_name AS "table", privilege_type AS privilege
      FROM information_schema.role_table_grants
      WHERE grantee = 'app_user' AND table_name IN ('session', 'account', 'verification')`)
    expect(result.rows).toEqual([])
  })
})
