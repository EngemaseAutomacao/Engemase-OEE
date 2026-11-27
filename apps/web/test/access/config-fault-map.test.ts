/**
 * Mapa de códigos de falha do CLP (lib/server/config/fault-map.ts): só `config.write` (D12), RLS por
 * cliente, código repetido para as mesmas máquinas recusado, motivo e máquina de outro cliente não existem,
 * salvar troca o mapa inteiro com auditoria.
 */
import * as s from "@engemase/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import { lerMapaFalhas, salvarMapaFalhas } from "@/lib/server/config/fault-map"
import { type AuthHarness, createAuthHarness } from "../auth/support"
import { createPerson, type SeededClient, type SeededPerson, seedClient } from "./support"

describe("mapa de falhas do CLP", () => {
  let h: AuthHarness
  let a: SeededClient
  let b: SeededClient
  let eng: TenantContext
  let engB: TenantContext
  let admin: TenantContext
  let motivoA: string
  let motivoB: string
  let grupoA: string

  async function ctxOf(slug: string, person: SeededPerson): Promise<TenantContext> {
    const d = await loadTenantContext(h.t.db, { slug, user: person.user, sessionId: person.sessionId, now: new Date() })
    if (!d.ok) throw new Error(d.reason)
    return d.context
  }

  async function motivo(org: string, name: string): Promise<{ grupo: string; motivo: string }> {
    const [g] = await h.t.db.insert(s.downtimeReason).values({ organizationId: org, name: `Grupo ${name}`, category: "unplanned" }).returning()
    const [r] = await h.t.db.insert(s.downtimeReason).values({ organizationId: org, parentId: g?.id, name, category: "unplanned" }).returning()
    return { grupo: g?.id ?? "", motivo: r?.id ?? "" }
  }

  beforeAll(async () => {
    h = await createAuthHarness()
    a = await seedClient(h.t.db, "alfa-falhas")
    b = await seedClient(h.t.db, "beta-falhas")
    const sup = await createPerson(h.t.db, "super-falhas", { role: "super_admin", twoFactor: true })
    eng = await ctxOf(a.slug, sup)
    engB = await ctxOf(b.slug, sup)
    admin = await ctxOf(a.slug, a.admin)
    const ma = await motivo(a.organizationId, "Falta de material")
    motivoA = ma.motivo
    grupoA = ma.grupo
    motivoB = (await motivo(b.organizationId, "Do Beta")).motivo
  }, 60_000)

  afterAll(async () => {
    await h.t.client.close()
  })

  it("salva o mapa (geral e por máquina), lê de volta e troca tudo no próximo salvar, com auditoria", async () => {
    const rows = [
      { code: 47, text: " Falta de material no funil ", reasonId: motivoA, machineId: null },
      { code: 47, text: "Termopar aberto", reasonId: null, machineId: a.m1 },
      { code: 12, text: "Porta aberta", reasonId: null, machineId: null },
    ]
    expect(await salvarMapaFalhas(h.t.db, eng, { rows })).toEqual({ ok: true, dados: { codigos: 3, comMotivo: 1 } })
    expect(await lerMapaFalhas(h.t.db, eng)).toEqual([
      { code: 12, text: "Porta aberta", reasonId: null, machineId: null },
      { code: 47, text: "Falta de material no funil", reasonId: motivoA, machineId: null },
      { code: 47, text: "Termopar aberto", reasonId: null, machineId: a.m1 },
    ])

    expect(await salvarMapaFalhas(h.t.db, eng, { rows: [{ code: 5, text: "Emergência", reasonId: null, machineId: null }] })).toMatchObject({ ok: true })
    expect((await lerMapaFalhas(h.t.db, eng)).map((r) => r.code)).toEqual([5])

    const audit = await h.t.db.select({ action: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.action, "fault_code_map.updated"))
    expect(audit.length).toBeGreaterThanOrEqual(2)
  })

  it("recusa: código repetido para as mesmas máquinas, grupo no lugar de motivo, texto curto, código inválido", async () => {
    const dup = await salvarMapaFalhas(h.t.db, eng, {
      rows: [
        { code: 9, text: "Um", reasonId: null, machineId: null },
        { code: 9, text: "Dois", reasonId: null, machineId: null },
      ],
    })
    expect(dup).toMatchObject({ ok: false })
    expect(await salvarMapaFalhas(h.t.db, eng, { rows: [{ code: 9, text: "Alarme", reasonId: grupoA, machineId: null }] })).toMatchObject({ ok: false })
    expect(await salvarMapaFalhas(h.t.db, eng, { rows: [{ code: 9, text: "Al", reasonId: null, machineId: null }] })).toMatchObject({ ok: false })
    expect(await salvarMapaFalhas(h.t.db, eng, { rows: [{ code: 0, text: "Alarme", reasonId: null, machineId: null }] })).toMatchObject({ ok: false })
    expect(await salvarMapaFalhas(h.t.db, eng, { rows: [{ code: 1.5, text: "Alarme", reasonId: null, machineId: null }] })).toMatchObject({ ok: false })
    // Nada mudou com as recusas.
    expect((await lerMapaFalhas(h.t.db, eng)).map((r) => r.code)).toEqual([5])
  })

  it("nível 3: motivo e máquina de outro cliente não existem aqui; o mapa de B não aparece em A", async () => {
    expect(await salvarMapaFalhas(h.t.db, eng, { rows: [{ code: 7, text: "Alarme", reasonId: motivoB, machineId: null }] })).toMatchObject({ ok: false })
    expect(await salvarMapaFalhas(h.t.db, eng, { rows: [{ code: 7, text: "Alarme", reasonId: null, machineId: b.m1 }] })).toMatchObject({ ok: false })
    expect(await salvarMapaFalhas(h.t.db, eng, { rows: [{ code: 7, text: "Alarme", reasonId: null, machineId: a.mDeleted }] })).toMatchObject({ ok: false })
    await salvarMapaFalhas(h.t.db, engB, { rows: [{ code: 99, text: "Do Beta", reasonId: motivoB, machineId: null }] })
    expect((await lerMapaFalhas(h.t.db, eng)).map((r) => r.code)).toEqual([5])
    // Salvar em A não apaga o mapa de B.
    await salvarMapaFalhas(h.t.db, eng, { rows: [] })
    expect((await lerMapaFalhas(h.t.db, engB)).map((r) => r.code)).toEqual([99])
  })

  it("sem config.write (admin do cliente): recusado", async () => {
    await expect(salvarMapaFalhas(h.t.db, admin, { rows: [] })).rejects.toBeInstanceOf(AccessDeniedError)
    expect(await lerMapaFalhas(h.t.db, admin)).toEqual([])
  })
})
