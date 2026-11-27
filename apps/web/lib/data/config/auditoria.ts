/**
 * Dados da tela "Auditoria" do cliente (docs/15: auditoria visível ao cliente, D5; risco 14: só no escopo de
 * quem lê). Com banco: os eventos dos últimos 90 dias (até 500) por `listAuditEntries` (RLS + escopo +
 * `audit.read`), com o rótulo da ação, a categoria, o nome do que mudou e o chamado da concessão de suporte.
 * Sem banco: os dados simulados (`buildAudit`).
 */
import { supportAccessGrant, withTenant } from "@engemase/db"
import { inArray } from "drizzle-orm"
import { buildAudit } from "@/components/settings/audit-data"
import type { AuditActorKind, AuditCategory, AuditRow } from "@/components/settings/types"
import { date, dateTime, time } from "@/lib/format"
import { DEFAULT_TZ } from "@/lib/mock"
import { CLIENT_ROLE_LABEL } from "@/lib/roles"
import { type AuditEntry, listAuditEntries } from "@/lib/server/access/summary"
import { bancoObrigatorio } from "../admin/acesso"
import { exigirCliente } from "./cliente"

const DAY = 86_400_000
export const AUDIT_DAYS = 90
export const AUDIT_LIMIT = 500

/** Rótulo e categoria de cada ação gravada pelo servidor. Ação nova sem rótulo aparece com o código. */
const ACOES: Record<string, { label: string; category: AuditCategory }> = {
  "client.create": { label: "Criou o cliente na plataforma", category: "lifecycle" },
  "unit.create": { label: "Cadastrou uma unidade", category: "config" },
  "unit.update": { label: "Alterou uma unidade", category: "config" },
  "area.create": { label: "Cadastrou uma área", category: "config" },
  "line.create": { label: "Cadastrou uma linha", category: "config" },
  "line.update": { label: "Alterou uma linha", category: "config" },
  "machine.create": { label: "Cadastrou uma máquina", category: "config" },
  "gateway.create": { label: "Provisionou um gateway", category: "config" },
  "gateway.enrolled": { label: "Gateway ativado", category: "config" },
  "gateway.activation_code_created": { label: "Gerou código de ativação do gateway", category: "config" },
  "gateway.config_published": { label: "Publicou a configuração do gateway", category: "config" },
  "gateway.command_created": { label: "Enviou um comando ao gateway", category: "config" },
  "gateway.command_cancelled": { label: "Cancelou um comando do gateway", category: "config" },
  "fault_code_map.updated": { label: "Alterou o mapa de falhas do CLP", category: "config" },
  "branding.updated": { label: "Alterou a aparência (cores e nome)", category: "branding" },
  "branding.reset": { label: "Restaurou a aparência padrão Engemase", category: "branding" },
  "product.created": { label: "Cadastrou um produto", category: "config" },
  "product.updated": { label: "Alterou um produto", category: "config" },
  "product.deleted": { label: "Excluiu um produto", category: "config" },
  "product.cycles_updated": { label: "Alterou ciclos ideais", category: "config" },
  "downtime_reason.created": { label: "Cadastrou um motivo de parada", category: "config" },
  "downtime_reason.updated": { label: "Alterou um motivo de parada", category: "config" },
  "downtime_reason.renamed": { label: "Renomeou um motivo de parada", category: "config" },
  "downtime_reason.color": { label: "Mudou a cor de um motivo", category: "config" },
  "downtime_reason.hidden": { label: "Ocultou um motivo de parada", category: "config" },
  "downtime_reason.shown": { label: "Reativou um motivo de parada", category: "config" },
  "downtime_reason.deleted": { label: "Excluiu um motivo de parada", category: "config" },
  "shift.created": { label: "Cadastrou um turno", category: "config" },
  "shift.updated": { label: "Alterou um turno", category: "config" },
  "shift.deleted": { label: "Excluiu um turno", category: "config" },
  "planned_downtime.created": { label: "Agendou uma parada planejada", category: "config" },
  "planned_downtime.updated": { label: "Alterou uma parada planejada", category: "config" },
  "planned_downtime.cancelled": { label: "Cancelou uma parada planejada", category: "config" },
  "member.create": { label: "Adicionou um usuário", category: "users" },
  "user.invite": { label: "Adicionou um usuário", category: "users" },
  "user.invite_resent": { label: "Reenviou o convite", category: "users" },
  "user.access_change": { label: "Alterou o acesso de um usuário", category: "users" },
  "user.disable": { label: "Desativou um usuário", category: "users" },
  "user.enable": { label: "Reativou um usuário", category: "users" },
  "user.password_reset_requested": { label: "Pediu nova senha para um usuário", category: "users" },
  "user.password_set": { label: "Definiu a senha", category: "users" },
  "user.two_factor_reset": { label: "Desligou a verificação em duas etapas de um usuário", category: "users" },
  "user.two_factor_reset_failed": { label: "Tentou desligar a verificação em duas etapas", category: "users" },
  "downtime.classified": { label: "Classificou uma parada", category: "production" },
  "downtime.unclassified": { label: "Desfez a classificação de uma parada", category: "production" },
  "quality_entry.created": { label: "Lançou refugo", category: "production" },
  "quality_entry.reversed": { label: "Estornou um lançamento de refugo", category: "production" },
  "production_run.operator_change": { label: "Trocou o produto em produção", category: "production" },
  "production_minute.rewritten": { label: "Dados de produção recalculados", category: "production" },
  "engemase.access": { label: "Equipe Engemase entrou no cliente", category: "support" },
  "support.grant_open": { label: "Abriu concessão de suporte", category: "support" },
  "support.grant_end": { label: "Encerrou concessão de suporte", category: "support" },
  "support_access_grant.expired": { label: "Concessão de suporte encerrada pelo prazo", category: "support" },
  "platform.assignment_create": { label: "Atribuiu um técnico Engemase ao cliente", category: "support" },
  "platform.assignment_renew": { label: "Renovou a atribuição de um técnico", category: "support" },
  "platform.assignment_revoke": { label: "Encerrou a atribuição de um técnico", category: "support" },
  "remote.request": { label: "Pediu acesso remoto ao gateway", category: "remote" },
  "remote.approve": { label: "Aprovou o acesso remoto", category: "remote" },
  "remote.reject": { label: "Recusou o acesso remoto", category: "remote" },
  "remote.end": { label: "Encerrou o acesso remoto", category: "remote" },
  "remote.policy_updated": { label: "Alterou a política de acesso remoto", category: "remote" },
  "terminal.created": { label: "Cadastrou um terminal", category: "terminals" },
  "terminal.updated": { label: "Alterou um terminal", category: "terminals" },
  "terminal.pairing_code": { label: "Gerou código de pareamento", category: "terminals" },
  "terminal.paired": { label: "Pareou um terminal", category: "terminals" },
  "terminal.revoked": { label: "Revogou um terminal", category: "terminals" },
  "unit_operator.created": { label: "Cadastrou um operador do chão", category: "terminals" },
  "unit_operator.updated": { label: "Alterou um operador do chão", category: "terminals" },
  "unit_operator.disabled": { label: "Desativou um operador do chão", category: "terminals" },
  "unit_operator.enabled": { label: "Reativou um operador do chão", category: "terminals" },
}

const ENTIDADE: Record<string, string> = {
  organization: "Cliente",
  unit: "Unidade",
  area: "Área",
  line: "Linha",
  machine: "Máquina",
  gateway: "Gateway",
  product: "Produto",
  downtime_reason: "Motivo de parada",
  shift: "Turno",
  planned_downtime: "Parada planejada",
  member: "Usuário",
  user: "Usuário",
  machine_state_event: "Parada",
  quality_entry: "Refugo",
  production_run: "Produção",
  terminal: "Terminal",
  unit_operator: "Operador do chão",
  support_access_grant: "Concessão de suporte",
  platform_assignment: "Atribuição",
  session: "Sessão",
}

/** Ação conhecida → rótulo e categoria; desconhecida → pelo prefixo, com o código como rótulo. */
export function acaoDaAuditoria(action: string): { label: string; category: AuditCategory } {
  const known = ACOES[action]
  if (known) return known
  const prefix = action.split(".")[0] ?? ""
  const category: AuditCategory =
    prefix === "user" || prefix === "member"
      ? "users"
      : prefix === "terminal" || prefix === "unit_operator"
        ? "terminals"
        : prefix === "support" || prefix === "engemase" || prefix === "platform"
          ? "support"
          : prefix === "remote" || prefix === "vpn" || prefix === "ot"
            ? "remote"
            : "config"
  return { label: action, category }
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null
}

function campo(obj: unknown, key: string): unknown {
  return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>)[key] : undefined
}

function dayLabel(iso: string, nowMs: number): string {
  const d = date(iso)
  if (d === date(new Date(nowMs).toISOString())) return `Hoje · ${d}`
  if (d === date(new Date(nowMs - DAY).toISOString())) return `Ontem · ${d}`
  const long = new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: DEFAULT_TZ })
  return long.charAt(0).toUpperCase() + long.slice(1)
}

export interface Nomes {
  /** Nome de qualquer entidade cadastrada pelo id (unidade, linha, máquina, gateway, produto, turno...). */
  readonly entidade: ReadonlyMap<string, string>
  /** Papel no cliente por id de usuário. */
  readonly papel: ReadonlyMap<string, string>
  /** Chamado por id de concessão de suporte. */
  readonly chamado: ReadonlyMap<string, string>
}

/** Converte um evento do banco na linha da tela (função pura: testável sem banco). */
export function linhaDaAuditoria(e: AuditEntry, nomes: Nomes, nowMs: number): AuditRow {
  const at = e.at.toISOString()
  const meta = acaoDaAuditoria(e.action)
  const after = e.after
  let actorKind: AuditActorKind
  let actorRole: string | null
  switch (e.actorType) {
    case "engemase":
      actorKind = e.accessGrantId !== null || e.action.startsWith("support") ? "support" : "engemase"
      actorRole = "Equipe Engemase"
      break
    case "terminal":
      actorKind = "terminal"
      actorRole = "Terminal pareado"
      break
    case "system":
    case "gateway":
      actorKind = "system"
      actorRole = e.actorType === "gateway" ? "Gateway" : "Automático"
      break
    default:
      actorKind = "client"
      actorRole = (e.actorLabel !== null && nomes.papel.get(e.actorLabel)) || null
  }
  const entityName =
    (e.entityId !== null ? nomes.entidade.get(e.entityId) : undefined) ??
    texto(campo(after, "name")) ??
    texto(campo(after, "code")) ??
    texto(campo(after, "product_code")) ??
    texto(campo(after, "email")) ??
    (e.entityType !== null ? (ENTIDADE[e.entityType] ?? e.entityType) : "—")
  const operador = texto(campo(after, "operator_name"))
  const motivo = texto(campo(after, "reason"))
  const unidade = e.unitId !== null ? nomes.entidade.get(e.unitId) : undefined
  const details = [unidade && unidade !== entityName ? unidade : null, motivo, operador ? `Operador: ${operador}` : null].filter(Boolean).join(" · ") || null
  return {
    id: e.id,
    at,
    dayKey: date(at),
    dayLabel: dayLabel(at, nowMs),
    time: time(at),
    dateTime: dateTime(at),
    actor: e.actorLabel ?? (actorKind === "system" ? "Sistema" : "—"),
    actorKind,
    actorRole,
    impersonatedBy: null,
    action: e.action,
    actionLabel: meta.label,
    category: meta.category,
    entity: e.entityType ?? "",
    entityName,
    details,
    ticket: e.accessGrantId !== null ? (nomes.chamado.get(e.accessGrantId) ?? null) : null,
    daysAgo: Math.floor((nowMs - e.at.getTime()) / DAY),
  }
}

export async function dadosAuditoria(slug: string) {
  const { r, client, ctx } = await exigirCliente(slug, "audit.read")
  if (ctx === null) return { client, banco: false, rows: buildAudit(client), truncated: false }

  const db = bancoObrigatorio()
  const now = Date.now()
  const desde = now - AUDIT_DAYS * DAY
  const entries = (await listAuditEntries(db, ctx, { limit: AUDIT_LIMIT })).filter((e) => e.at.getTime() >= desde)

  const grants = [...new Set(entries.map((e) => e.accessGrantId).filter((id): id is string => id !== null))]
  const chamado = new Map<string, string>()
  if (grants.length > 0) {
    const rows = await withTenant(db, ctx.organizationId, (tx) =>
      tx.select({ id: supportAccessGrant.id, ticket: supportAccessGrant.ticket }).from(supportAccessGrant).where(inArray(supportAccessGrant.id, grants)),
    )
    for (const g of rows) if (g.ticket) chamado.set(g.id, g.ticket.startsWith("#") ? g.ticket : `#${g.ticket}`)
  }

  const entidade = new Map<string, string>()
  for (const u of r.getUnits(client.id)) entidade.set(u.id, u.name)
  for (const l of r.getLines(client.id)) entidade.set(l.id, l.name)
  for (const m of r.getMachines(client.id)) entidade.set(m.id, m.name)
  for (const g of r.getGateways(client.id)) entidade.set(g.id, g.name)
  for (const p of r.getProducts(client.id)) entidade.set(p.id, `${p.code} · ${p.name}`)
  for (const s of r.getShifts(client.id)) entidade.set(s.id, s.name)
  const papel = new Map<string, string>()
  for (const u of r.getClientUsers(client.id)) {
    entidade.set(u.id, u.name)
    const role = u.memberships.find((m) => m.clientId === client.id)?.role
    if (role) papel.set(u.name, CLIENT_ROLE_LABEL[role])
  }

  const rows = entries.map((e) => linhaDaAuditoria(e, { entidade, papel, chamado }, now))
  return { client, banco: true, rows, truncated: entries.length >= AUDIT_LIMIT }
}
