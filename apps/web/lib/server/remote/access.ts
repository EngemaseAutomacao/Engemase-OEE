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
import { REMOTE_SESSION_LIVE_STATUSES, auditLog, gateway, gatewayCommand, machine, remoteAccessEvent, remoteAccessPolicy, remoteAccessSession, withTenant } from "@engemase/db"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { z } from "zod"
import { assertPermission, hasPermission, type TenantContext } from "@/lib/server/access/context"
import type { ConfigResult } from "@/lib/server/config/products"
import type { GatewayDb, GatewayTx } from "@/lib/server/gateway/types"
import { auditActor } from "@/lib/server/users/audit"
import type { ApprovalSigner } from "./approval"
import { nodeNameFor, type VpnProvider } from "./tailscale"

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
    const [g] = await tx.select({ id: gateway.id, name: gateway.name, unitId: gateway.unitId }).from(gateway).where(eq(gateway.id, v.gatewayId)).limit(1)
    // Gateway de outro cliente (RLS) ou fora das unidades atribuídas a quem pede: "não encontrado".
    if (g === undefined || !(await gatewayNoEscopo(tx, ctx, g.unitId))) return { ok: false, mensagem: "Gateway não encontrado. Atualize a página." }
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

/** A unidade do gateway está no escopo de quem age? (por máquinas: as unidades dessas máquinas) */
export async function gatewayNoEscopo(tx: GatewayTx, ctx: TenantContext, unitId: string): Promise<boolean> {
  switch (ctx.scope.kind) {
    case "all":
      return true
    case "units":
      return ctx.scope.unitIds.includes(unitId)
    case "machines": {
      if (ctx.scope.machineIds.length === 0) return false
      const ms = await tx.select({ unitId: machine.unitId }).from(machine).where(inArray(machine.id, [...ctx.scope.machineIds]))
      return ms.some((m) => m.unitId === unitId)
    }
  }
}

async function podeAprovar(tx: GatewayTx, ctx: TenantContext): Promise<string | null> {
  if (!hasPermission(ctx, "remote_access.approve")) return "Só o admin do cliente aprova o acesso remoto."
  const p = await politica(tx)
  if (p.approverUserIds.length > 0 && !p.approverUserIds.includes(ctx.user.id)) return "A política do cliente define outros aprovadores."
  return null
}

/** Aprova (pode reduzir a duração). */
/**
 * VPN configurada na plataforma: assinador da aprovação e provedor (Tailscale) presentes. Sem ela, a
 * aprovação fica só registrada (nenhum comando vai ao gateway).
 */
export interface VpnSetup {
  readonly signer: ApprovalSigner
}

/** Aprova (pode reduzir a duração). Com a VPN configurada, põe o `vpn.enable` na fila do gateway. */
export async function aprovarAcesso(
  db: GatewayDb,
  ctx: TenantContext,
  input: unknown,
  now = new Date(),
  vpn: VpnSetup | null = null,
): Promise<ConfigResult<{ id: string; durationMin: number; vpnQueued: boolean }>> {
  assertPermission(ctx, "remote_access.approve")
  const parsed = DecisaoInput.safeParse(input)
  if (!parsed.success) return NAO_ENCONTRADO
  const v = parsed.data
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string; durationMin: number; vpnQueued: boolean }>> => {
    const sem = await podeAprovar(tx, ctx)
    if (sem !== null) return { ok: false, mensagem: sem }
    const [s] = await tx.select().from(remoteAccessSession).where(eq(remoteAccessSession.id, v.id)).for("update").limit(1)
    if (s === undefined) return NAO_ENCONTRADO
    if (s.requestedBy === ctx.user.id) return { ok: false, mensagem: "Quem pede o acesso não pode aprovar o próprio pedido." }
    if (s.status !== "requested") return { ok: false, mensagem: "Este pedido já foi decidido. Atualize a página." }
    const p = await politica(tx)
    if (p.mode === "disabled") return { ok: false, mensagem: "O acesso remoto está desativado na política. Mude a política para aprovar." }
    const durationMin = Math.min(v.durationMin ?? s.requestedDurationMin, s.requestedDurationMin, p.maxDurationMin)
    const expiresAt = new Date(now.getTime() + durationMin * 60_000)
    const nodeName = vpn ? nodeNameFor(s.gatewayId, s.id) : null
    await tx
      .update(remoteAccessSession)
      .set({
        status: "approved",
        ...(nodeName ? { vpnNodeId: nodeName } : {}),
        decidedBy: ctx.user.id,
        decidedAt: now,
        decisionNote: v.note || null,
        approvedDurationMin: durationMin,
        // Sem a VPN ligada, o prazo conta da aprovação (o cron fecha o que não ligou).
        expiresAt,
        updatedAt: now,
      })
      .where(eq(remoteAccessSession.id, s.id))
    if (vpn && nodeName) {
      // Aprovação assinada (o gateway confere antes de ligar). A chave do Tailscale NÃO vai aqui: é
      // criada na hora da entrega pelo /sync (`gateway/sync.ts`), para não ficar guardada no banco.
      const approval = vpn.signer.sign({
        typ: "engemase.vpn_approval.v1",
        gateway_id: s.gatewayId,
        session_id: s.id,
        requested_by: `user:${s.requestedBy}`,
        approved_by: `user:${ctx.user.id}`,
        approved_at: now.toISOString(),
        not_after: expiresAt.toISOString(),
        allow_ot_forward: false,
      })
      await tx.insert(gatewayCommand).values({
        organizationId: ctx.organizationId,
        gatewayId: s.gatewayId,
        type: "vpn.enable",
        payload: { session_id: s.id, node_name: nodeName, session_expires_at: expiresAt.toISOString(), idle_timeout_s: p.idleTimeoutMin * 60, approval },
        status: "pending",
        createdBy: ctx.user.id,
        expiresAt,
      })
    }
    await evento(tx, ctx, s.id, "approved", { duration_min: durationMin, note: v.note ?? null, vpn_queued: vpn !== null })
    await auditar(tx, ctx, "remote.approve", s.id, { duration_min: durationMin, requested_duration_min: s.requestedDurationMin, note: v.note ?? null })
    return { ok: true, dados: { id: s.id, durationMin, vpnQueued: vpn !== null } }
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

/** Põe `vpn.disable` na fila do gateway: ele fecha encaminhamentos, desconecta e devolve o resumo (docs/12). */
async function pedirDesligar(tx: GatewayTx, ctx: TenantContext, gatewayId: string, sessionId: string, reason: "requested" | "revoked", now: Date): Promise<void> {
  await tx.insert(gatewayCommand).values({
    organizationId: ctx.organizationId,
    gatewayId,
    type: "vpn.disable",
    payload: { session_id: sessionId, reason },
    status: "pending",
    createdBy: ctx.user.id,
    expiresAt: new Date(now.getTime() + DEFAULT_COMMAND_TTL_S["vpn.disable"] * 1000),
  })
}

/** Encerra (ou cancela o pedido). Aprovador ou quem pediu. */
export async function encerrarAcesso(
  db: GatewayDb,
  ctx: TenantContext,
  id: unknown,
  now = new Date(),
  vpn: VpnProvider | null = null,
): Promise<ConfigResult<{ id: string; status: string }>> {
  assertPermission(ctx, "data.read")
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return NAO_ENCONTRADO
  let noParaApagar: string | null = null
  const r = await withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string; status: string }>> => {
    const [s] = await tx.select().from(remoteAccessSession).where(eq(remoteAccessSession.id, id)).for("update").limit(1)
    if (s === undefined) return NAO_ENCONTRADO
    const solicitante = s.requestedBy === ctx.user.id
    // Encerrar só reduz acesso: qualquer admin do cliente pode, mesmo fora da lista de aprovadores.
    if (!solicitante && !hasPermission(ctx, "remote_access.approve")) return { ok: false, mensagem: "Só o admin do cliente ou quem pediu encerra o acesso." }
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
    if (status === "stopping") await pedirDesligar(tx, ctx, s.gatewayId, s.id, "requested", now)
    await evento(tx, ctx, s.id, status === "cancelled" ? "cancelled" : "end_requested", { from: s.status, to: status })
    await auditar(tx, ctx, "remote.end", s.id, { from: s.status, to: status })
    if (s.vpnNodeId && (status === "ended" || status === "stopping")) noParaApagar = s.vpnNodeId
    return { ok: true, dados: { id: s.id, status } }
  })
  // Garantia extra: tira o gateway da rede de manutenção agora (o gateway também desliga sozinho).
  if (r.ok && noParaApagar && vpn) await apagarNo(vpn, noParaApagar)
  return r
}

/** Apaga o nó do gateway no Tailscale; falha só vai para o log (o cron tenta de novo). */
export async function apagarNo(vpn: VpnProvider, nodeName: string): Promise<void> {
  try {
    await vpn.deleteNode(nodeName)
  } catch (error) {
    console.error(`[vpn] não foi possível apagar o nó ${nodeName}; o cron tenta de novo`, error)
  }
}

/** Política do cliente inteiro (admin do cliente). Desativar recusa os pedidos em aberto e encerra as sessões liberadas. */
export async function salvarPolitica(db: GatewayDb, ctx: TenantContext, input: unknown, now = new Date()): Promise<ConfigResult<{ recusados: number }>> {
  assertPermission(ctx, "remote_access.approve")
  const parsed = PoliticaInput.safeParse(input)
  if (!parsed.success) return erroDe(parsed)
  const v = parsed.data
  if (v.idleTimeoutMin > v.maxDurationMin) return { ok: false, mensagem: "A inatividade não pode passar da duração máxima." }
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ recusados: number }>> => {
    const set = { mode: v.mode, maxDurationMin: v.maxDurationMin, idleTimeoutMin: v.idleTimeoutMin, updatedBy: ctx.user.id, updatedAt: now }
    // Uma linha por cliente (unidade e gateway nulos; a restrição única trata nulos como iguais).
    await tx
      .insert(remoteAccessPolicy)
      .values({ organizationId: ctx.organizationId, ...set })
      .onConflictDoUpdate({ target: [remoteAccessPolicy.organizationId, remoteAccessPolicy.unitId, remoteAccessPolicy.gatewayId], set })
    let recusados = 0
    let encerradas = 0
    if (v.mode === "disabled") {
      const rows = await tx
        .update(remoteAccessSession)
        .set({ status: "denied", decidedBy: ctx.user.id, decidedAt: now, decisionNote: "Acesso remoto desativado pela política", endedAt: now, endReason: "denied", updatedAt: now })
        .where(eq(remoteAccessSession.status, "requested"))
        .returning({ id: remoteAccessSession.id })
      recusados = rows.length
      for (const r of rows) await evento(tx, ctx, r.id, "denied", { reason: "policy_disabled" })
      // Desativar também derruba o que já foi liberado: aprovada que não ligou → encerrada; ligando/ligada →
      // encerrando, com `vpn.disable` na fila do gateway.
      const aprovadas = await tx
        .update(remoteAccessSession)
        .set({ status: "ended", endedAt: now, endedBy: ctx.user.id, endReason: "revoked", updatedAt: now })
        .where(eq(remoteAccessSession.status, "approved"))
        .returning({ id: remoteAccessSession.id })
      for (const r of aprovadas) await evento(tx, ctx, r.id, "end_requested", { reason: "policy_disabled" })
      const ligadas = await tx
        .update(remoteAccessSession)
        .set({ status: "stopping", updatedAt: now })
        .where(inArray(remoteAccessSession.status, ["activating", "active"]))
        .returning({ id: remoteAccessSession.id, gatewayId: remoteAccessSession.gatewayId })
      for (const r of ligadas) {
        await pedirDesligar(tx, ctx, r.gatewayId, r.id, "revoked", now)
        await evento(tx, ctx, r.id, "end_requested", { reason: "policy_disabled" })
      }
      encerradas = aprovadas.length + ligadas.length
    }
    await tx.insert(auditLog).values({
      organizationId: ctx.organizationId,
      ...auditActor(ctx),
      action: "remote.policy_updated",
      entityType: "remote_access_policy",
      after: { mode: v.mode, max_duration_min: v.maxDurationMin, idle_timeout_min: v.idleTimeoutMin, denied_requests: recusados, ended_sessions: encerradas },
    })
    return { ok: true, dados: { recusados } }
  })
}
