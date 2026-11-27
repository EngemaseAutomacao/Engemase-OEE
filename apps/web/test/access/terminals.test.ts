/**
 * Terminais pareados (lib/server/terminal/terminals.ts; docs/15 riscos 11 e 12; L19): cadastro só pela
 * Engemase, código de uso único com prazo, token de aparelho (só o hash no banco) com prazo absoluto,
 * revogação imediata, escopo do terminal como contexto de acesso, cliente suspenso e isolamento (nível 3).
 */
import * as s from "@engemase/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import {
  criarTerminal,
  DEVICE_TOKEN_TTL_MS,
  editarTerminal,
  gerarCodigoTerminal,
  hashDeviceToken,
  PAIRING_CODE_TTL_MS,
  pairingIpKey,
  parearAparelho,
  revogarTerminal,
  terminalContext,
} from "@/lib/server/terminal/terminals"
import { type AuthHarness, createAuthHarness } from "../auth/support"
import { createPerson, type SeededClient, type SeededPerson, seedClient } from "./support"

const NOW = new Date("2026-11-27T15:00:00Z")

describe("terminais pareados", () => {
  let h: AuthHarness
  let a: SeededClient
  let b: SeededClient
  let superAdmin: SeededPerson
  let eng: TenantContext
  let ip = 0

  async function ctxOf(slug: string, person: SeededPerson): Promise<TenantContext> {
    const decision = await loadTenantContext(h.t.db, { slug, user: person.user, sessionId: person.sessionId, now: NOW })
    if (!decision.ok) throw new Error(`sem acesso: ${decision.reason}`)
    return decision.context
  }

  /** IP novo a cada pareamento (o limite por IP tem teste próprio). */
  const nextIp = () => `10.0.0.${++ip}`

  async function tablet(c: SeededClient, ctx: TenantContext, machineIds: string[]) {
    const r = await criarTerminal(h.t.db, ctx, { name: "Tablet injetora", kind: "operator_tablet", unitId: c.unit1, machineIds }, NOW)
    if (!r.ok) throw new Error(r.mensagem)
    return r.dados
  }

  beforeAll(async () => {
    h = await createAuthHarness({ now: () => NOW })
    a = await seedClient(h.t.db, "alfa-terminais")
    b = await seedClient(h.t.db, "beta-terminais")
    superAdmin = await createPerson(h.t.db, "super-terminais", { role: "super_admin", twoFactor: true })
    eng = await ctxOf(a.slug, superAdmin)
  }, 60_000)

  afterAll(async () => {
    await h.t.client.close()
  })

  it("cadastro gera código de uso único; o pareamento troca o código por um token (só o hash no banco)", async () => {
    const { id, code, expiresAt } = await tablet(a, eng, [a.m1])
    expect(code).toMatch(/^\d{4} \d{4}$/)
    expect(expiresAt.getTime()).toBe(NOW.getTime() + PAIRING_CODE_TTL_MS)

    const paired = await parearAparelho(h.t.db, code.replace(" ", "-"), { now: new Date(NOW.getTime() + 60_000), ip: nextIp() })
    expect(paired.ok).toBe(true)
    if (!paired.ok) return
    expect(paired.token).toMatch(/^tm_[A-Za-z0-9_-]{43}$/)
    expect(paired.terminalId).toBe(id)
    const [row] = await h.t.db.select().from(s.terminal).where(eq(s.terminal.id, id))
    expect(row?.tokenHash).toBe(hashDeviceToken(paired.token))
    expect(row?.expiresAt?.getTime()).toBe(NOW.getTime() + 60_000 + DEVICE_TOKEN_TTL_MS)

    // Código já usado: não vale de novo.
    expect(await parearAparelho(h.t.db, code, { now: new Date(NOW.getTime() + 120_000), ip: nextIp() })).toMatchObject({ ok: false, code: "invalid" })
    const audit = await h.t.db.select({ action: s.auditLog.action, actorType: s.auditLog.actorType }).from(s.auditLog).where(eq(s.auditLog.entityId, id))
    expect(audit).toEqual(expect.arrayContaining([{ action: "terminal.created", actorType: "engemase" }, { action: "terminal.paired", actorType: "terminal" }]))
  })

  it("código vencido, errado ou substituído por outro não pareia", async () => {
    const { id, code } = await tablet(a, eng, [a.m1])
    expect(await parearAparelho(h.t.db, code, { now: new Date(NOW.getTime() + PAIRING_CODE_TTL_MS + 1000), ip: nextIp() })).toMatchObject({ ok: false, code: "invalid" })
    expect(await parearAparelho(h.t.db, "0000 0000", { now: NOW, ip: nextIp() })).toMatchObject({ ok: false, code: "invalid" })
    expect(await parearAparelho(h.t.db, "x'; drop table terminal; --", { now: NOW, ip: nextIp() })).toMatchObject({ ok: false, code: "invalid" })

    const novo = await gerarCodigoTerminal(h.t.db, eng, id, NOW)
    const segundo = novo.ok ? novo.dados.code : ""
    expect(await parearAparelho(h.t.db, code, { now: NOW, ip: nextIp() })).toMatchObject({ ok: false })
    expect((await parearAparelho(h.t.db, segundo, { now: NOW, ip: nextIp() })).ok).toBe(true)
  })

  it("limite de tentativas por IP", async () => {
    const fixed = "192.168.99.1"
    for (let i = 0; i < 10; i++) expect(await parearAparelho(h.t.db, "1111 2222", { now: NOW, ip: fixed })).toMatchObject({ code: "invalid" })
    expect(await parearAparelho(h.t.db, "1111 2222", { now: NOW, ip: fixed })).toMatchObject({ ok: false, code: "rate_limited" })
  })

  it("contexto do aparelho: escopo do terminal e permissões mínimas (TV só lê; tablet também faz as ações do chão)", async () => {
    const t = await tablet(a, eng, [a.m1, a.m2])
    const p = await parearAparelho(h.t.db, t.code, { now: NOW, ip: nextIp() })
    const session = await terminalContext(h.t.db, p.ok ? p.token : "", NOW)
    expect(session?.ctx).toMatchObject({ organizationId: a.organizationId, access: { kind: "terminal", terminalId: t.id, terminalKind: "tablet" } })
    expect(session?.ctx.scope).toEqual({ kind: "machines", machineIds: expect.arrayContaining([a.m1, a.m2]) })
    expect([...(session?.ctx.permissions ?? [])].sort()).toEqual(["data.read", "floor.act"])

    const tv = await criarTerminal(h.t.db, eng, { name: "TV Linha A", kind: "andon_tv", unitId: a.unit1, lineIds: [a.line1] }, NOW)
    const ptv = await parearAparelho(h.t.db, tv.ok ? tv.dados.code : "", { now: NOW, ip: nextIp() })
    const tvSession = await terminalContext(h.t.db, ptv.ok ? ptv.token : "", NOW)
    expect([...(tvSession?.ctx.permissions ?? [])]).toEqual(["data.read"])
    // Máquinas da linha 1, sem a excluída.
    expect(tvSession?.terminal.machineIds).toEqual(expect.arrayContaining([a.m1, a.m2]))
    expect(tvSession?.terminal.machineIds).not.toContain(a.mDeleted)
    expect(tvSession?.terminal.machineIds).not.toContain(a.m3)

    // Token inexistente, malformado ou vazio: sem acesso.
    expect(await terminalContext(h.t.db, "tm_" + "A".repeat(43), NOW)).toBeNull()
    expect(await terminalContext(h.t.db, "qualquer coisa", NOW)).toBeNull()
    expect(await terminalContext(h.t.db, undefined, NOW)).toBeNull()
  })

  it("revogar corta o aparelho na hora e invalida os códigos; token vencido também não entra", async () => {
    const t = await tablet(a, eng, [a.m1])
    const p = await parearAparelho(h.t.db, t.code, { now: NOW, ip: nextIp() })
    const token = p.ok ? p.token : ""
    expect(await terminalContext(h.t.db, token, NOW)).not.toBeNull()
    expect(await revogarTerminal(h.t.db, eng, t.id, NOW)).toEqual({ ok: true, dados: { id: t.id } })
    expect(await terminalContext(h.t.db, token, NOW)).toBeNull()
    expect(await gerarCodigoTerminal(h.t.db, eng, t.id, NOW)).toMatchObject({ ok: false })

    const t2 = await tablet(a, eng, [a.m2])
    const p2 = await parearAparelho(h.t.db, t2.code, { now: NOW, ip: nextIp() })
    await h.t.db.update(s.terminal).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.terminal.id, t2.id))
    expect(await terminalContext(h.t.db, p2.ok ? p2.token : "", NOW)).toBeNull()
  })

  it("cliente suspenso: o terminal para de abrir", async () => {
    const c = await seedClient(h.t.db, "gama-terminais")
    const engC = await ctxOf(c.slug, superAdmin)
    const t = await tablet(c, engC, [c.m1])
    const p = await parearAparelho(h.t.db, t.code, { now: NOW, ip: nextIp() })
    const token = p.ok ? p.token : ""
    expect(await terminalContext(h.t.db, token, NOW)).not.toBeNull()
    await h.t.db.update(s.clientAccount).set({ status: "suspended" }).where(eq(s.clientAccount.organizationId, c.organizationId))
    expect(await terminalContext(h.t.db, token, NOW)).toBeNull()
  })

  it("limite por IP: IPv6 conta pelo bloco /64 (o atacante tem o bloco inteiro)", () => {
    expect(pairingIpKey("2001:db8:abcd:12::1")).toBe(pairingIpKey("2001:0db8:abcd:0012:ffff:ffff:ffff:ffff"))
    expect(pairingIpKey("2001:db8:abcd:12::1")).not.toBe(pairingIpKey("2001:db8:abcd:13::1"))
    expect(pairingIpKey("::1")).toBe("terminal-pair:ip6:0:0:0:0::/64")
    expect(pairingIpKey("10.0.0.1")).toBe("terminal-pair:ip:10.0.0.1")
    expect(pairingIpKey(null)).toBe("terminal-pair:ip:desconhecido")
  })

  it("cliente suspenso: o pareamento é recusado sem gastar o código", async () => {
    const c = await seedClient(h.t.db, "delta-terminais")
    const engC = await ctxOf(c.slug, superAdmin)
    const t = await tablet(c, engC, [c.m1])
    await h.t.db.update(s.clientAccount).set({ status: "suspended" }).where(eq(s.clientAccount.organizationId, c.organizationId))
    expect(await parearAparelho(h.t.db, t.code, { now: NOW, ip: nextIp() })).toMatchObject({ ok: false, code: "invalid" })
    const [row] = await h.t.db.select().from(s.terminal).where(eq(s.terminal.id, t.id))
    expect(row?.tokenHash).toBeNull()
    await h.t.db.update(s.clientAccount).set({ status: "active" }).where(eq(s.clientAccount.organizationId, c.organizationId))
    expect((await parearAparelho(h.t.db, t.code, { now: NOW, ip: nextIp() })).ok).toBe(true)
  })

  it("escopo validado; nível 3: unidade, linha, máquina ou terminal de outro cliente não existem aqui", async () => {
    expect(await criarTerminal(h.t.db, eng, { name: "TV sem linha", kind: "andon_tv", unitId: a.unit1, lineIds: [] }, NOW)).toMatchObject({ ok: false })
    expect(await criarTerminal(h.t.db, eng, { name: "Tablet outra unidade", kind: "operator_tablet", unitId: a.unit1, machineIds: [a.m3] }, NOW)).toMatchObject({ ok: false })
    expect(await criarTerminal(h.t.db, eng, { name: "Tablet de outro cliente", kind: "operator_tablet", unitId: a.unit1, machineIds: [b.m1] }, NOW)).toMatchObject({ ok: false })
    expect(await criarTerminal(h.t.db, eng, { name: "Unidade de outro cliente", kind: "operator_tablet", unitId: b.unit1, machineIds: [b.m1] }, NOW)).toMatchObject({ ok: false })

    const engB = await ctxOf(b.slug, superAdmin)
    const tB = await tablet(b, engB, [b.m1])
    expect(await editarTerminal(h.t.db, eng, { id: tB.id, name: "Tomado", machineIds: [a.m1] })).toMatchObject({ ok: false })
    expect(await gerarCodigoTerminal(h.t.db, eng, tB.id, NOW)).toMatchObject({ ok: false })
    expect(await revogarTerminal(h.t.db, eng, tB.id, NOW)).toMatchObject({ ok: false })
    const [row] = await h.t.db.select().from(s.terminal).where(eq(s.terminal.id, tB.id))
    expect(row).toMatchObject({ name: "Tablet injetora", revokedAt: null })
  })

  it("só a equipe Engemase (config.write) cadastra", async () => {
    const admin = await ctxOf(a.slug, a.admin)
    await expect(criarTerminal(h.t.db, admin, { name: "Do admin", kind: "operator_tablet", unitId: a.unit1, machineIds: [a.m1] }, NOW)).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(revogarTerminal(h.t.db, admin, a.m1, NOW)).rejects.toBeInstanceOf(AccessDeniedError)
  })
  // Por último: esgota o balde geral de propósito.
  it("limite geral: varredura de muitos IPs diferentes também para", async () => {
    // Horário próprio (bem depois dos outros testes) para o balde geral começar vazio.
    const later = new Date(NOW.getTime() + 30 * 86_400_000)
    let blocked = 0
    for (let i = 0; i < 320; i++) {
      const r = await parearAparelho(h.t.db, "9999 0000", { now: later, ip: `172.16.${Math.floor(i / 250)}.${i % 250}` })
      if (!r.ok && r.code === "rate_limited") blocked++
    }
    expect(blocked).toBeGreaterThan(0)
  }, 60_000)
})
