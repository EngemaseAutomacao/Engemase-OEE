/**
 * Acesso remoto aos gateways (VPN de manutenção sob demanda, docs/12): o ciclo do PEDIDO na plataforma.
 *
 * - Pedir: só a equipe Engemase dentro do cliente (`diagnostics.run`), com motivo, chamado e duração; a
 *   política do cliente (desativado / duração máxima) vale na hora. Uma sessão viva por gateway e técnico.
 * - Aprovar ou recusar: só quem tem `remote_access.approve` (admin do cliente) e, se a política listar
 *   aprovadores, só eles. Quem pede nunca aprova (o banco também confere). A aprovação pode reduzir a duração.
 * - Encerrar: aprovador ou quem pediu. Sessão ativando/ativa → "encerrando" e `vpn.disable` na fila do
 *   gateway; aprovada que ainda não ligou → encerrada; pedido → cancelado (quem pediu) ou recusado.
 * - Política do cliente: modo (com aprovação ou desativado), duração máxima e inatividade.
 *
 * Ligar a VPN (`vpn.enable`) precisa da chave de uso único do provedor (Tailscale) e da aprovação assinada:
 * entra com a integração da VPN. Até lá, a sessão aprovada fica "aprovada" até o prazo e o cron fecha.
 * Tudo sob a RLS do cliente, com `remote_access_event` (só inserção) e auditoria.
 */
import { DEFAULT_COMMAND_TTL_S } from "@engemase/contracts"
import { REMOTE_SESSION_LIVE_STATUSES, auditLog, gateway, gatewayCommand, remoteAccessEvent, remoteAccessPolicy, remoteAccessSession, withTenant } from "@engemase/db"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { z } from "zod"
import { assertPermission, hasPermission, type TenantContext } from "@/lib/server/access/context"
import type { ConfigResult } from "@/lib/server/config/products"
import type { GatewayDb, GatewayTx } from "@/lib/server/gateway/types"
import { auditActor } from "@/lib/server/users/audit"

export interface PoliticaCliente {
  readonly mode: "disabled" | "approval" | "preapproved_window" | "emergency"
  readonly maxDurationMin: number
  readonly idleTimeoutMin: number
  readonly approverUserIds: readonly string[]
}

export const POLITICA_PADRAO: PoliticaCliente = { mode: "approval", maxDurationMin: 240, idleTimeoutMin: 15, approverUserIds: [] }

const PedidoInput = z.object({
  gatewayId: z.uuid("Escolha o gateway."),
  reason: z.string().trim().min(10, "Explique o motivo (pelo menos 10 letras).").max(500, "Motivo muito longo."),
  ticket: z.string().trim().min(1, "Informe o número do chamado.").max(40, "Chamado muito longo."),
  durationMin: z.number().int().min(15, "Pelo menos 15 minutos.").max(480, "No máximo 8 horas."),
})
const DecisaoInput = z.object({
  id: z.uuid(),
  durationMin: z.number().int().min(15).max(480).optional(),
  note: z.string().trim().max(500).optional(),
})
const RecusaInput = z.object({ id: z.uuid(), reason: z.string().trim().min(3, "Diga o motivo da recusa.").max(500) })
const PoliticaInput = z.object({
  mode: z.enum(["disabled", "approval"], "Modo inválido."),
  maxDurationMin: z.number().int().min(15, "Duração máxima de pelo menos 15 minutos.").max(480, "Duração máxima de até 8 horas."),
  idleTimeoutMin: z.number().int().min(5, "Inatividade de pelo menos 5 minutos.").max(120, "Inatividade de até 2 horas."),
})

const NAO_ENCONTRADO = { ok: false, mensagem: "Pedido não encontrado. Atualize a página." } as const

function erroDe(parsed: { success: false; error: z.ZodError }): { ok: false; mensagem: string } {
  return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Confira os dados." }
}

async function politica(tx: GatewayTx): Promise<PoliticaCliente> {
  const [p] = await tx
    .select({ mode: remoteAccessPolicy.mode, maxDurationMin: remoteAccessPolicy.maxDurationMin, idleTimeoutMin: remoteAccessPolicy.idleTimeoutMin, approverUserIds: remoteAccessPolicy.approverUserIds })
    .from(remoteAccessPolicy)
    .where(and(isNull(remoteAccessPolicy.unitId), isNull(remoteAccessPolicy.gatewayId)))
    .limit(1)
  return p ?? POLITICA_PADRAO
}

/** Política do cliente inteiro (sem linha = padrão: com aprovação, até 4 h). */
export async function lerPolitica(db: GatewayDb, ctx: TenantContext): Promise<PoliticaCliente> {
  assertPermission(ctx, "data.read")
  return withTenant(db, ctx.organizationId, politica)
}

async function evento(tx: GatewayTx, ctx: TenantContext, sessionId: string, type: string, data: Record<string, unknown>): Promise<void> {
  const a = auditActor(ctx)
  await tx.insert(remoteAccessEvent).values({ organizationId: ctx.organizationId, sessionId, type, actorType: a.actorType, actorId: a.actorId, data })
}

async function auditar(tx: GatewayTx, ctx: TenantContext, action: string, entityId: string, after: unknown): Promise<void> {
  await tx.insert(auditLog).values({ organizationId: ctx.organizationId, ...auditActor(ctx), action, entityType: "remote_access_session", entityId, after })
}

/** Pedido de acesso (equipe Engemase). */
export async function pedirAcesso(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "diagnostics.run")
  if (ctx.access.kind !== "engemase") return { ok: false, mensagem: "Só a equipe Engemase pede acesso remoto." }
  const parsed = PedidoInput.safeParse(input)
  if (!parsed.success) return erroDe(parsed)
  const v = parsed.data
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
    const p = await politica(tx)
    if (p.mode === "disabled") return { ok: false, mensagem: "O cliente desativou o acesso remoto. Combine com o admin do cliente." }
    if (v.durationMin > p.maxDurationMin) return { ok: false, mensagem: `A política do cliente permite até ${p.maxDurationMin} minutos por sessão.` }
    const [g] = await tx.select({ id: gateway.id, name: gateway.name }).from(gateway).where(eq(gateway.id, v.gatewayId)).limit(1)
    if (g === undefined) return { ok: false, mensagem: "Gateway não encontrado. Atualize a página." }
    const JA_ABERTO = { ok: false, mensagem: "Você já tem um pedido ou uma sessão aberta neste gateway." } as const
    const [vivo] = await tx
      .select({ id: remoteAccessSession.id })
      .from(remoteAccessSession)
      .where(and(eq(remoteAccessSession.gatewayId, g.id), eq(remoteAccessSession.requestedBy, ctx.user.id), inArray(remoteAccessSession.status, [...REMOTE_SESSION_LIVE_STATUSES])))
      .limit(1)
    if (vivo !== undefined) return JA_ABERTO
    try {
      // Ponto de salvamento: dois pedidos ao mesmo tempo → o índice único recusa um sem derrubar a transação.
      const [row] = await tx.transaction((sp) =>
        sp
          .insert(remoteAccessSession)
          .values({ organizationId: ctx.organizationId, gatewayId: g.id, requestedBy: ctx.user.id, reason: v.reason, ticket: v.ticket, requestedDurationMin: v.durationMin })
          .returning({ id: remoteAccessSession.id }),
      )
      if (row === undefined) throw new Error("pedido não gravado")
      await evento(tx, ctx, row.id, "requested", { duration_min: v.durationMin, ticket: v.ticket })
      await auditar(tx, ctx, "remote.request", row.id, { gateway_id: g.id, gateway: g.name, ticket: v.ticket, duration_min: v.durationMin, reason: v.reason })
      return { ok: true, dados: { id: row.id } }
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === "23505" || (error as { code?: string }).code === "23505") {
        return JA_ABERTO
      }
      throw error
    }
  })
}

async function podeAprovar(tx: GatewayTx, ctx: TenantContext): Promise<string | null> {
  if (!hasPermission(ctx, "remote_access.approve")) return "Só o admin do cliente aprova o acesso remoto."
  const p = await politica(tx)
  if (p.approverUserIds.length > 0 && !p.approverUserIds.includes(ctx.user.id)) return "A política do cliente define outros aprovadores."
  return null
}

/** Aprova (pode reduzir a duração). */
export async function aprovarAcesso(db: GatewayDb, ctx: TenantContext, input: unknown, now = new Date()): Promise<ConfigResult<{ id: string; durationMin: number }>> {
  assertPermission(ctx, "remote_access.approve")
  const parsed = DecisaoInput.safeParse(input)
  if (!parsed.success) return NAO_ENCONTRADO
  const v = parsed.data
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string; durationMin: number }>> => {
    const sem = await podeAprovar(tx, ctx)
    if (sem !== null) return { ok: false, mensagem: sem }
    const [s] = await tx.select().from(remoteAccessSession).where(eq(remoteAccessSession.id, v.id)).for("update").limit(1)
    if (s === undefined) return NAO_ENCONTRADO
    if (s.requestedBy === ctx.user.id) return { ok: false, mensagem: "Quem pede o acesso não pode aprovar o próprio pedido." }
    if (s.status !== "requested") return { ok: false, mensagem: "Este pedido já foi decidido. Atualize a página." }
    const p = await politica(tx)
    if (p.mode === "disabled") return { ok: false, mensagem: "O acesso remoto está desativado na política. Mude a política para aprovar." }
    const durationMin = Math.min(v.durationMin ?? s.requestedDurationMin, s.requestedDurationMin, p.maxDurationMin)
    await tx
      .update(remoteAccessSession)
      .set({
        status: "approved",
        decidedBy: ctx.user.id,
        decidedAt: now,
        decisionNote: v.note || null,
        approvedDurationMin: durationMin,
        // Sem a VPN ligada, o prazo conta da aprovação (o cron fecha o que não ligou).
        expiresAt: new Date(now.getTime() + durationMin * 60_000),
        updatedAt: now,
      })
      .where(eq(remoteAccessSession.id, s.id))
    await evento(tx, ctx, s.id, "approved", { duration_min: durationMin, note: v.note ?? null })
    await auditar(tx, ctx, "remote.approve", s.id, { duration_min: durationMin, requested_duration_min: s.requestedDurationMin, note: v.note ?? null })
    return { ok: true, dados: { id: s.id, durationMin } }
  })
}

/** Recusa, com motivo. */
export async function recusarAcesso(db: GatewayDb, ctx: TenantContext, input: unknown, now = new Date()): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "remote_access.approve")
  const parsed = RecusaInput.safeParse(input)
  if (!parsed.success) return erroDe(parsed)
  const v = parsed.data
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
    const sem = await podeAprovar(tx, ctx)
    if (sem !== null) return { ok: false, mensagem: sem }
    const [s] = await tx.select().from(remoteAccessSession).where(eq(remoteAccessSession.id, v.id)).for("update").limit(1)
    if (s === undefined) return NAO_ENCONTRADO
    if (s.requestedBy === ctx.user.id) return { ok: false, mensagem: "Quem pede o acesso não pode decidir o próprio pedido." }
    if (s.status !== "requested") return { ok: false, mensagem: "Este pedido já foi decidido. Atualize a página." }
    await tx
      .update(remoteAccessSession)
      .set({ status: "denied", decidedBy: ctx.user.id, decidedAt: now, decisionNote: v.reason, endedAt: now, endReason: "denied", updatedAt: now })
      .where(eq(remoteAccessSession.id, s.id))
    await evento(tx, ctx, s.id, "denied", { reason: v.reason })
    await auditar(tx, ctx, "remote.reject", s.id, { reason: v.reason })
    return { ok: true, dados: { id: s.id } }
  })
}

/** Encerra (ou cancela o pedido). Aprovador ou quem pediu. */
export async function encerrarAcesso(db: GatewayDb, ctx: TenantContext, id: unknown, now = new Date()): Promise<ConfigResult<{ id: string; status: string }>> {
  assertPermission(ctx, "data.read")
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return NAO_ENCONTRADO
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string; status: string }>> => {
    const [s] = await tx.select().from(remoteAccessSession).where(eq(remoteAccessSession.id, id)).for("update").limit(1)
    if (s === undefined) return NAO_ENCONTRADO
    const solicitante = s.requestedBy === ctx.user.id
    if (!solicitante && (await podeAprovar(tx, ctx)) !== null) return { ok: false, mensagem: "Só o admin do cliente ou quem pediu encerra o acesso." }
    let status: "cancelled" | "denied" | "ended" | "stopping"
    switch (s.status) {
      case "requested":
        status = solicitante ? "cancelled" : "denied"
        break
      case "approved":
        status = "ended"
        break
      case "activating":
      case "active":
        status = "stopping"
        break
      default:
        return { ok: false, mensagem: "Esta sessão já terminou. Atualize a página." }
    }
    const fim = status === "stopping" ? {} : { endedAt: now, endedBy: ctx.user.id, endReason: "requested" }
    await tx
      .update(remoteAccessSession)
      .set({ status, ...fim, ...(s.status === "requested" && !solicitante ? { decidedBy: ctx.user.id, decidedAt: now } : {}), updatedAt: now })
      .where(eq(remoteAccessSession.id, s.id))
    if (status === "stopping") {
      // O gateway fecha encaminhamentos, desconecta e devolve o resumo (docs/12).
      await tx.insert(gatewayCommand).values({
        organizationId: ctx.organizationId,
        gatewayId: s.gatewayId,
        type: "vpn.disable",
        payload: { session_id: s.id, reason: "requested" },
        status: "pending",
        createdBy: ctx.user.id,
        expiresAt: new Date(now.getTime() + DEFAULT_COMMAND_TTL_S["vpn.disable"] * 1000),
      })
    }
    await evento(tx, ctx, s.id, status === "cancelled" ? "cancelled" : "end_requested", { from: s.status, to: status })
    await auditar(tx, ctx, "remote.end", s.id, { from: s.status, to: status })
    return { ok: true, dados: { id: s.id, status } }
  })
}

/** Política do cliente inteiro (admin do cliente). Desativar recusa os pedidos em aberto. */
export async function salvarPolitica(db: GatewayDb, ctx: TenantContext, input: unknown, now = new Date()): Promise<ConfigResult<{ recusados: number }>> {
  assertPermission(ctx, "remote_access.approve")
  const parsed = PoliticaInput.safeParse(input)
  if (!parsed.success) return erroDe(parsed)
  const v = parsed.data
  if (v.idleTimeoutMin > v.maxDurationMin) return { ok: false, mensagem: "A inatividade não pode passar da duração máxima." }
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ recusados: number }>> => {
    const set = { mode: v.mode, maxDurationMin: v.maxDurationMin, idleTimeoutMin: v.idleTimeoutMin, updatedBy: ctx.user.id, updatedAt: now }
    const [atual] = await tx
      .select({ id: remoteAccessPolicy.id })
      .from(remoteAccessPolicy)
      .where(and(isNull(remoteAccessPolicy.unitId), isNull(remoteAccessPolicy.gatewayId)))
      .limit(1)
    if (atual) await tx.update(remoteAccessPolicy).set(set).where(eq(remoteAccessPolicy.id, atual.id))
    else await tx.insert(remoteAccessPolicy).values({ organizationId: ctx.organizationId, ...set })
    let recusados = 0
    if (v.mode === "disabled") {
      const rows = await tx
        .update(remoteAccessSession)
        .set({ status: "denied", decidedBy: ctx.user.id, decidedAt: now, decisionNote: "Acesso remoto desativado pela política", endedAt: now, endReason: "denied", updatedAt: now })
        .where(eq(remoteAccessSession.status, "requested"))
        .returning({ id: remoteAccessSession.id })
      recusados = rows.length
      for (const r of rows) await evento(tx, ctx, r.id, "denied", { reason: "policy_disabled" })
    }
    await tx.insert(auditLog).values({
      organizationId: ctx.organizationId,
      ...auditActor(ctx),
      action: "remote.policy_updated",
      entityType: "remote_access_policy",
      after: { mode: v.mode, max_duration_min: v.maxDurationMin, idle_timeout_min: v.idleTimeoutMin, denied_requests: recusados },
    })
    return { ok: true, dados: { recusados } }
  })
}
