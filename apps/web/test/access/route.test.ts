/**
 * Rota com dado de cliente, de ponta a ponta (docs/15, seção 4, item 7.3): login real (Better Auth) →
 * cookie → GET /api/clientes/{slug}/maquinas. Pessoa de A pedindo B recebe 404 (igual a cliente
 * inexistente); sem login 401; escopo por unidade aplicado; sessão de pessoa que exige 2FA sem 2FA, 403.
 */
import * as s from "@engemase/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { GET } from "@/app/api/clientes/[cliente]/maquinas/route"
import { listMachines } from "@/lib/server/access/data"
import { tenantForRequest } from "@/lib/server/access/route"
import { type AuthHarness, browserHeaders, cookiesFrom, createAuthHarness, createUserWithPassword } from "../auth/support"
import { type SeededClient, seedClient } from "./support"

describe("rota de cliente com login real", () => {
  let h: AuthHarness
  let a: SeededClient
  let b: SeededClient
  let supervisorCookie = ""
  let adminNo2faCookie = ""

  async function login(email: string, password: string): Promise<string> {
    const res = await h.auth.api.signInEmail({ body: { email, password }, headers: browserHeaders(), asResponse: true })
    expect(res.status).toBe(200)
    return cookiesFrom(res.headers)
  }

  async function member(org: SeededClient, userId: string, role: s.ClientRole, scope: s.AccessScope, unitIds: string[] = []) {
    const [m] = await h.t.db.insert(s.member).values({ organizationId: org.organizationId, userId }).returning()
    const [ma] = await h.t.db
      .insert(s.memberAccess)
      .values({ organizationId: org.organizationId, memberId: m!.id, role, scope })
      .returning()
    for (const unitId of unitIds) {
      await h.t.db.insert(s.memberUnit).values({ organizationId: org.organizationId, memberAccessId: ma!.id, unitId })
    }
  }

  const call = (slug: string, cookie: string) =>
    tenantForRequest(new Request(`http://localhost:3000/api/clientes/${slug}/maquinas`, { headers: browserHeaders(cookie) }), slug, "data.read", {
      auth: h.auth,
      authDb: h.t.db,
      db: h.t.db,
    })

  beforeAll(async () => {
    h = await createAuthHarness()
    a = await seedClient(h.t.db, "alfa")
    b = await seedClient(h.t.db, "beta")
    const supervisor = await createUserWithPassword(h)
    await member(a, supervisor.id, "supervisor", "units", [a.unit1])
    supervisorCookie = await login(supervisor.email, supervisor.password)
    const admin = await createUserWithPassword(h)
    await member(a, admin.id, "client_admin", "all")
    adminNo2faCookie = await login(admin.email, admin.password)
  })

  afterAll(async () => {
    await h.t.client.close()
  })

  it("pessoa de A no próprio cliente: só as máquinas do escopo (unidade 1)", async () => {
    const result = await call(a.slug, supervisorCookie)
    if ("response" in result) throw new Error(`esperava acesso, veio ${result.response.status}`)
    const machines = await listMachines(h.t.db, result.ctx)
    expect(machines.map((m) => m.id).sort()).toEqual([a.m1, a.m2].sort())
  })

  it("pessoa de A pedindo B: 404, igual a cliente inexistente", async () => {
    const other = await call(b.slug, supervisorCookie)
    const missing = await call("nao-existe", supervisorCookie)
    if (!("response" in other) || !("response" in missing)) throw new Error("esperava 404")
    expect(other.response.status).toBe(404)
    expect(missing.response.status).toBe(404)
    expect(await other.response.json()).toEqual(await missing.response.json())
  })

  it("sem cookie, ou com cookie forjado: 401", async () => {
    for (const cookie of ["", "engemase.session_token=forjado.assinatura"]) {
      const result = await call(a.slug, cookie)
      if (!("response" in result)) throw new Error("esperava 401")
      expect(result.response.status).toBe(401)
    }
  })

  it("admin do cliente sem 2FA: 403 com o pedido para ativar", async () => {
    const result = await call(a.slug, adminNo2faCookie)
    if (!("response" in result)) throw new Error("esperava 403")
    expect(result.response.status).toBe(403)
    expect(await result.response.json()).toMatchObject({ error: "two_factor_required" })
  })

  it("o route handler sem banco configurado responde 503 (nunca vaza nada)", async () => {
    const response = await GET(new Request("http://localhost:3000/api/clientes/alfa/maquinas"), {
      params: Promise.resolve({ cliente: "alfa" }),
    })
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
})
