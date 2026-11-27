/**
 * Aparência do cliente (lib/server/config/branding.ts): tokens calculados no servidor, cor colada numa cor
 * de estado recusada, só `config.write` (D12), RLS por cliente, restaurar apaga a linha, auditoria.
 */
import * as s from "@engemase/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import { lerAparencia, restaurarAparencia, salvarAparencia } from "@/lib/server/config/branding"
import { type AuthHarness, createAuthHarness } from "../auth/support"
import { createPerson, type SeededClient, type SeededPerson, seedClient } from "./support"

describe("aparência do cliente", () => {
  let h: AuthHarness
  let a: SeededClient
  let b: SeededClient
  let eng: TenantContext
  let engB: TenantContext
  let admin: TenantContext

  async function ctxOf(slug: string, person: SeededPerson): Promise<TenantContext> {
    const d = await loadTenantContext(h.t.db, { slug, user: person.user, sessionId: person.sessionId, now: new Date() })
    if (!d.ok) throw new Error(d.reason)
    return d.context
  }

  beforeAll(async () => {
    h = await createAuthHarness()
    a = await seedClient(h.t.db, "alfa-marca")
    b = await seedClient(h.t.db, "beta-marca")
    const sup = await createPerson(h.t.db, "super-marca", { role: "super_admin", twoFactor: true })
    eng = await ctxOf(a.slug, sup)
    engB = await ctxOf(b.slug, sup)
    admin = await ctxOf(a.slug, a.admin)
  }, 60_000)

  afterAll(async () => {
    await h.t.client.close()
  })

  it("salva com tokens calculados no servidor (amarelo vira primária escura para passar no contraste)", async () => {
    expect(await lerAparencia(h.t.db, eng)).toBeNull()
    const r = await salvarAparencia(h.t.db, eng, { displayName: " Alfa OEE ", shortName: "Alfa", preset: null, brandColor: "#FACC15", sidebarMode: "brand-dark" })
    expect(r.ok).toBe(true)
    const lida = await lerAparencia(h.t.db, admin)
    expect(lida).toMatchObject({ displayName: "Alfa OEE", shortName: "Alfa", brandColor: "#facc15", sidebarMode: "brand-dark", adjusted: true })
    expect(lida?.tokens.light.primary).not.toBe("#facc15")
    expect(lida?.tokens.light.primary).toMatch(/^#[0-9a-f]{6}$/)

    // Salvar de novo substitui (uma linha por cliente).
    expect((await salvarAparencia(h.t.db, eng, { displayName: "Alfa", shortName: "Alfa", brandColor: "#1E3A8A", sidebarMode: "neutral" })).ok).toBe(true)
    expect(await h.t.db.select().from(s.clientBranding).where(eq(s.clientBranding.organizationId, a.organizationId))).toHaveLength(1)
  })

  it("recusa: cor colada no verde de produzindo, cor inválida, nome grande, modo de menu estranho", async () => {
    const verde = await salvarAparencia(h.t.db, eng, { displayName: "X", shortName: "X", brandColor: "#00A859", sidebarMode: "neutral" })
    expect(verde).toMatchObject({ ok: false })
    expect(verde.ok ? "" : verde.mensagem).toMatch(/Produzindo/)
    expect(await salvarAparencia(h.t.db, eng, { displayName: "X", shortName: "X", brandColor: "azul", sidebarMode: "neutral" })).toMatchObject({ ok: false })
    expect(await salvarAparencia(h.t.db, eng, { displayName: "X".repeat(41), shortName: "X", brandColor: "#1E3A8A", sidebarMode: "neutral" })).toMatchObject({ ok: false })
    expect(await salvarAparencia(h.t.db, eng, { displayName: "X", shortName: "X", brandColor: "#1E3A8A", sidebarMode: "rosa" })).toMatchObject({ ok: false })
    expect((await lerAparencia(h.t.db, eng))?.brandColor).toBe("#1e3a8a")
  })

  it("isolamento e permissões: B não vê a de A; admin do cliente não altera; restaurar volta ao padrão", async () => {
    expect(await lerAparencia(h.t.db, engB)).toBeNull()
    await expect(salvarAparencia(h.t.db, admin, { displayName: "X", shortName: "X", brandColor: "#1E3A8A", sidebarMode: "neutral" })).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(restaurarAparencia(h.t.db, admin)).rejects.toBeInstanceOf(AccessDeniedError)
    expect((await restaurarAparencia(h.t.db, engB)).ok).toBe(true)
    expect(await lerAparencia(h.t.db, eng)).not.toBeNull()
    expect((await restaurarAparencia(h.t.db, eng)).ok).toBe(true)
    expect(await lerAparencia(h.t.db, eng)).toBeNull()
    const actions = await h.t.db.select({ action: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.entityType, "client_branding"))
    expect(actions.map((x) => x.action).sort()).toEqual(["branding.reset", "branding.updated", "branding.updated"])
  })
})
