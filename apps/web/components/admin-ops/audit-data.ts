/**
 * Auditoria global (console Engemase), montada a partir de `getAuditLog()`.
 * Usado SÓ por páginas (servidor). Devolve linhas serializáveis já formatadas.
 */
import { MOCK_NOW, getAuditLog, getClientById, getClients, getPlatformUsers, getUsers } from "@/lib/mock"
import { date, time } from "@/lib/format"
import { CLIENT_ROLE_LABEL, PLATFORM_ROLE_LABEL } from "@/lib/roles"
import type { AuditCategory } from "./labels"

export type ActorKind = "engemase" | "client" | "system"

const ACTION_LABEL: Record<string, string> = {
  "config.publish": "Publicou configuração",
  "tag.test_read": "Leitura de teste de tag",
  "user.invite": "Convidou usuário",
  "stop.classify": "Classificou parada",
  "support.impersonate": "Acesso de suporte",
  "shift.update": "Alterou turno",
  "client.create": "Criou cliente",
  "client.suspend": "Suspendeu cliente",
  "gateway.create": "Provisionou gateway",
  "platform.user_create": "Adicionou membro da equipe",
}

const ENTITY_LABEL: Record<string, string> = {
  gateway: "Gateway",
  tag: "Tag",
  usuario: "Usuário",
  maquina: "Máquina",
  cliente: "Cliente",
  turno: "Turno",
}

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action
}

function categoryOf(action: string, clientId: string | null): AuditCategory {
  if (action.startsWith("support.")) return "support"
  if (clientId === null || action.startsWith("client.") || action.startsWith("platform.")) return "platform"
  if (action.startsWith("user.") || action.startsWith("terminal.") || action.startsWith("remote_access.")) return "access"
  if (action.startsWith("stop.") || action.startsWith("shift.") || action.startsWith("product.") || action.startsWith("reject.")) return "production"
  return "config"
}

export interface AuditRow {
  id: string
  at: string
  dayKey: string
  dayLabel: string
  timeLabel: string
  fullLabel: string
  actorName: string
  actorKind: ActorKind
  actorRole: string
  impersonatedBy: string | null
  clientId: string | null
  clientName: string
  action: string
  actionLabel: string
  category: AuditCategory
  entity: string
  entityLabel: string
  entityName: string
  details: string
}

export interface AuditData {
  rows: AuditRow[]
  clients: { id: string; name: string }[]
  since: string
}

export function buildAudit(): AuditData {
  const platform = getPlatformUsers()
  const users = getUsers()
  const today = date(MOCK_NOW)
  const yesterday = date(new Date(Date.parse(MOCK_NOW) - 86_400_000).toISOString())

  const rows: AuditRow[] = getAuditLog().map((a) => {
    const p = platform.find((u) => u.name === a.actorName)
    const u = p ?? users.find((x) => x.name === a.actorName)
    const membership = !p && u ? (u.memberships.find((m) => m.clientId === a.clientId) ?? u.memberships[0]) : undefined
    const d = date(a.at)
    const weekday = new Date(a.at).toLocaleDateString("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" })
    return {
      id: a.id,
      at: a.at,
      dayKey: d,
      dayLabel: d === today ? `Hoje · ${d.slice(0, 5)}` : d === yesterday ? `Ontem · ${d.slice(0, 5)}` : `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${d}`,
      timeLabel: time(a.at),
      fullLabel: `${d} às ${time(a.at)}`,
      actorName: a.actorName,
      actorKind: p ? "engemase" : u ? "client" : "system",
      actorRole: p ? `Engemase · ${PLATFORM_ROLE_LABEL[p.platformRole!]}` : membership ? CLIENT_ROLE_LABEL[membership.role] : "Sistema",
      impersonatedBy: a.impersonatedBy,
      clientId: a.clientId,
      clientName: a.clientId ? (getClientById(a.clientId)?.name ?? a.clientId) : "Plataforma",
      action: a.action,
      actionLabel: actionLabel(a.action),
      category: categoryOf(a.action, a.clientId),
      entity: a.entity,
      entityLabel: ENTITY_LABEL[a.entity] ?? a.entity,
      entityName: a.entityName,
      details: a.details ?? "",
    }
  })

  const oldest = rows.length > 0 ? rows[rows.length - 1]!.at : MOCK_NOW
  return {
    rows,
    clients: getClients().map((c) => ({ id: c.id, name: c.name })),
    since: date(oldest),
  }
}
