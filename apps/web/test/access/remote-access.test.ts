/**
 * Acesso remoto (lib/server/remote/access.ts): pedido só da equipe Engemase; aprovar/recusar só o admin do
 * cliente (nunca quem pediu); política (desativado recusa pedidos e os em aberto; duração máxima); encerrar
 * gera `vpn.disable` quando a VPN está ligada; RLS por cliente; eventos e auditoria.
 */
import * as s from "@engemase/db"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import { aprovarAcesso, encerrarAcesso, lerPolitica, pedirAcesso, recusarAcesso, salvarPolitica } from "@/lib/server/remote/access"
import { approvalSigner } from "@/lib/server/remote/approval"
import { generateKeyPairSync } from "node:crypto"
import { type AuthHarness, createAuthHarness } from "../auth/support"
import { assignFieldEngineer, createPerson, type SeededClient, type SeededPerson, seedClient } from "./support"

describe("acesso remoto: pedido, decisão e política", () => {
  let h: AuthHarness
  let a: SeededClient
  let b: SeededClient
  let eng: TenantContext
  let engB: TenantContext
  let admin: TenantContext
  let supervisor: TenantContext
  let gw: string
  let gw2: string
  let gwB: string

  async function ctxOf(slug: string, person: SeededPerson): Promise<TenantContext> {
    const d = await loadTenantContext(h.t.db, { slug, user: person.user, sessionId: person.sessionId, now: new Date() })
    if (!d.ok) throw new Error(d.reason)
    return d.context
  }
  async function gateway(c: SeededClient, name: string): Promise<string> {
    const [g] = await h.t.db.insert(s.gateway).values({ organizationId: c.organizationId, unitId: c.unit1, name, status: "pending_enrollment" }).returning()
    return g?.id ?? ""
  }
  const pedido = (gatewayId: string, extra: Record<string, unknown> = {}) => ({ gatewayId, reason: "Ajustar o barramento RS-485", ticket: "#1042", durationMin: 60, ...extra })

  beforeAll(async () => {
    h = await createAuthHarness()
    a = await seedClient(h.t.db, "alfa-remoto")
    b = await seedClient(h.t.db, "beta-remoto")
    const sup = await createPerson(h.t.db, "super-remoto", { role: "super_admin", twoFactor: true })
    eng = await ctxOf(a.slug, sup)
    engB = await ctxOf(b.slug, sup)
    admin = await ctxOf(a.slug, a.admin)
    supervisor = await ctxOf(a.slug, a.supervisorUnit1)
    gw = await gateway(a, "GW Injeção")
    gw2 = await gateway(a, "GW Sopro")
    gwB = await gateway(b, "GW Beta")
  }, 60_000)

  afterAll(async () => {
    await h.t.client.close()
  })

  it("pedido da Engemase → aprovação do admin (reduz a duração), com eventos e auditoria", async () => {
    const r = await pedirAcesso(h.t.db, eng, pedido(gw, { durationMin: 120 }))
    expect(r.ok).toBe(true)
    const id = r.ok ? r.dados.id : ""
    // Um pedido vivo por gateway e técnico.
    expect(await pedirAcesso(h.t.db, eng, pedido(gw))).toEqual({ ok: false, mensagem: "Você já tem um pedido ou uma sessão aberta neste gateway." })

    const ap = await aprovarAcesso(h.t.db, admin, { id, durationMin: 60, note: "Só até o almoço" })
    expect(ap).toEqual({ ok: true, dados: { id, durationMin: 60, vpnQueued: false } })
    const [row] = await h.t.db.select().from(s.remoteAccessSession).where(eq(s.remoteAccessSession.id, id))
    expect(row).toMatchObject({ status: "approved", approvedDurationMin: 60, decidedBy: a.admin.user.id })
    expect(row?.expiresAt).not.toBeNull()
    expect(await aprovarAcesso(h.t.db, admin, { id })).toMatchObject({ ok: false })

    const events = await h.t.db.select({ type: s.remoteAccessEvent.type }).from(s.remoteAccessEvent).where(eq(s.remoteAccessEvent.sessionId, id))
    expect(events.map((e) => e.type)).toEqual(["requested", "approved"])
    const audit = await h.t.db.select({ action: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.entityId, id))
    expect(audit.map((x) => x.action).sort()).toEqual(["remote.approve", "remote.request"])

    // Aprovada que não ligou: encerrar fecha na hora (sem comando ao gateway).
    expect(await encerrarAcesso(h.t.db, admin, id)).toMatchObject({ ok: true, dados: { status: "ended" } })
  })

  it("quem pode: admin do cliente não pede; supervisor e a Engemase não aprovam; quem pediu só cancela", async () => {
    await expect(pedirAcesso(h.t.db, admin, pedido(gw))).rejects.toBeInstanceOf(AccessDeniedError)
    const r = await pedirAcesso(h.t.db, eng, pedido(gw2))
    const id = r.ok ? r.dados.id : ""
    await expect(aprovarAcesso(h.t.db, supervisor, { id })).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(aprovarAcesso(h.t.db, eng, { id })).rejects.toBeInstanceOf(AccessDeniedError)
    expect(await encerrarAcesso(h.t.db, supervisor, id)).toMatchObject({ ok: false })
    expect(await encerrarAcesso(h.t.db, eng, id)).toMatchObject({ ok: true, dados: { status: "cancelled" } })
  })

  it("recusa com motivo; sessão ativa encerrada vira 'encerrando' com vpn.disable na fila", async () => {
    const r = await pedirAcesso(h.t.db, eng, pedido(gw))
    const id = r.ok ? r.dados.id : ""
    expect(await recusarAcesso(h.t.db, admin, { id, reason: "x" })).toMatchObject({ ok: false })
    expect(await recusarAcesso(h.t.db, admin, { id, reason: "Fora do horário combinado" })).toEqual({ ok: true, dados: { id } })
    expect((await h.t.db.select().from(s.remoteAccessSession).where(eq(s.remoteAccessSession.id, id)))[0]).toMatchObject({ status: "denied", decisionNote: "Fora do horário combinado" })

    const r2 = await pedirAcesso(h.t.db, eng, pedido(gw))
    const id2 = r2.ok ? r2.dados.id : ""
    await aprovarAcesso(h.t.db, admin, { id: id2 })
    await h.t.db.update(s.remoteAccessSession).set({ status: "active", startsAt: new Date() }).where(eq(s.remoteAccessSession.id, id2))
    expect(await encerrarAcesso(h.t.db, admin, id2)).toMatchObject({ ok: true, dados: { status: "stopping" } })
    const cmds = await h.t.db.select().from(s.gatewayCommand).where(and(eq(s.gatewayCommand.gatewayId, gw), eq(s.gatewayCommand.type, "vpn.disable")))
    expect(cmds.map((c) => c.payload)).toContainEqual({ session_id: id2, reason: "requested" })
  })

  it("política: duração máxima vale no pedido; desativar recusa os em aberto e bloqueia novos; só o admin muda", async () => {
    await expect(salvarPolitica(h.t.db, eng, { mode: "approval", maxDurationMin: 60, idleTimeoutMin: 15 })).rejects.toBeInstanceOf(AccessDeniedError)
    expect(await salvarPolitica(h.t.db, admin, { mode: "approval", maxDurationMin: 60, idleTimeoutMin: 90 })).toMatchObject({ ok: false })
    expect(await salvarPolitica(h.t.db, admin, { mode: "approval", maxDurationMin: 60, idleTimeoutMin: 15 })).toEqual({ ok: true, dados: { recusados: 0 } })
    expect(await lerPolitica(h.t.db, supervisor)).toMatchObject({ mode: "approval", maxDurationMin: 60 })
    expect(await pedirAcesso(h.t.db, eng, pedido(gw2, { durationMin: 120 }))).toEqual({ ok: false, mensagem: "A política do cliente permite até 60 minutos por sessão." })

    const aberto = await pedirAcesso(h.t.db, eng, pedido(gw2))
    expect(await salvarPolitica(h.t.db, admin, { mode: "disabled", maxDurationMin: 60, idleTimeoutMin: 15 })).toEqual({ ok: true, dados: { recusados: 1 } })
    expect((await h.t.db.select().from(s.remoteAccessSession).where(eq(s.remoteAccessSession.id, aberto.ok ? aberto.dados.id : "")))[0]?.status).toBe("denied")
    expect(await pedirAcesso(h.t.db, eng, pedido(gw2))).toMatchObject({ ok: false, mensagem: "O cliente desativou o acesso remoto. Combine com o admin do cliente." })
  })

  it("nível 3: gateway de outro cliente não existe aqui; a política de A não vale em B", async () => {
    // A política de A está desativada (teste anterior): reativa para ver a recusa pelo gateway.
    await salvarPolitica(h.t.db, admin, { mode: "approval", maxDurationMin: 240, idleTimeoutMin: 15 })
    expect(await pedirAcesso(h.t.db, eng, pedido(gwB))).toEqual({ ok: false, mensagem: "Gateway não encontrado. Atualize a página." })
    expect((await pedirAcesso(h.t.db, engB, pedido(gwB))).ok).toBe(true)
  })

  it("revisão de segurança: técnico só pede nas unidades atribuídas; desativar derruba o que foi liberado; admin fora da lista encerra", async () => {
    // Técnico atribuído só à unidade 2: o gateway da unidade 1 "não existe" para ele.
    const campo = await createPerson(h.t.db, "campo-remoto-u2", { role: "technician", twoFactor: true })
    await assignFieldEngineer(h.t.db, a.organizationId, campo, new Date(), { unitIds: [a.unit2] })
    const ctxCampo = await ctxOf(a.slug, campo)
    expect(await pedirAcesso(h.t.db, ctxCampo, pedido(gw))).toEqual({ ok: false, mensagem: "Gateway não encontrado. Atualize a página." })

    await salvarPolitica(h.t.db, admin, { mode: "approval", maxDurationMin: 240, idleTimeoutMin: 15 })
    const g3 = await gateway(a, "GW Extra")
    const aprovada = await pedirAcesso(h.t.db, eng, pedido(g3))
    const idAprovada = aprovada.ok ? aprovada.dados.id : ""
    await aprovarAcesso(h.t.db, admin, { id: idAprovada })
    const g4 = await gateway(a, "GW Quatro")
    const ligada = await pedirAcesso(h.t.db, eng, pedido(g4))
    const idLigada = ligada.ok ? ligada.dados.id : ""
    await aprovarAcesso(h.t.db, admin, { id: idLigada })
    await h.t.db.update(s.remoteAccessSession).set({ status: "active", startsAt: new Date() }).where(eq(s.remoteAccessSession.id, idLigada))

    await salvarPolitica(h.t.db, admin, { mode: "disabled", maxDurationMin: 240, idleTimeoutMin: 15 })
    const status = async (id: string) => (await h.t.db.select().from(s.remoteAccessSession).where(eq(s.remoteAccessSession.id, id)))[0]?.status
    expect(await status(idAprovada)).toBe("ended")
    expect(await status(idLigada)).toBe("stopping")
    const cmds = await h.t.db.select().from(s.gatewayCommand).where(and(eq(s.gatewayCommand.gatewayId, g4), eq(s.gatewayCommand.type, "vpn.disable")))
    expect(cmds.map((c) => c.payload)).toContainEqual({ session_id: idLigada, reason: "revoked" })

    // Política com lista de aprovadores que não inclui este admin: ainda assim ele pode ENCERRAR.
    await h.t.db.update(s.remoteAccessPolicy).set({ mode: "approval", approverUserIds: [a.adminNo2fa.user.id] }).where(eq(s.remoteAccessPolicy.organizationId, a.organizationId))
    const outro = await pedirAcesso(h.t.db, eng, pedido(g3))
    const idOutro = outro.ok ? outro.dados.id : ""
    expect(await aprovarAcesso(h.t.db, admin, { id: idOutro })).toEqual({ ok: false, mensagem: "A política do cliente define outros aprovadores." })
    expect(await encerrarAcesso(h.t.db, admin, idOutro)).toMatchObject({ ok: true, dados: { status: "denied" } })
  })

  it("VPN configurada: aprovar põe vpn.enable na fila com a aprovação assinada e SEM a chave do Tailscale", async () => {
    await salvarPolitica(h.t.db, admin, { mode: "approval", maxDurationMin: 240, idleTimeoutMin: 15 })
    await h.t.db.update(s.remoteAccessPolicy).set({ approverUserIds: [] }).where(eq(s.remoteAccessPolicy.organizationId, a.organizationId))
    const { privateKey } = generateKeyPairSync("ed25519")
    const signer = approvalSigner(privateKey.export({ format: "pem", type: "pkcs8" }).toString())!
    const g5 = await gateway(a, "GW Cinco")
    const r = await pedirAcesso(h.t.db, eng, pedido(g5))
    const id = r.ok ? r.dados.id : ""
    expect(await aprovarAcesso(h.t.db, admin, { id }, new Date(), { signer })).toMatchObject({ ok: true, dados: { vpnQueued: true } })
    const [cmd] = await h.t.db.select().from(s.gatewayCommand).where(and(eq(s.gatewayCommand.gatewayId, g5), eq(s.gatewayCommand.type, "vpn.enable")))
    const payload = cmd?.payload as Record<string, unknown>
    expect(payload).toMatchObject({ session_id: id, idle_timeout_s: 900 })
    expect(payload).not.toHaveProperty("auth_key")
    expect(String(payload.approval)).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
    const [sess] = await h.t.db.select().from(s.remoteAccessSession).where(eq(s.remoteAccessSession.id, id))
    expect(sess?.vpnNodeId).toBe(payload.node_name)
  })
})
