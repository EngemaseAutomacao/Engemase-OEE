/**
 * Monta a auditoria do cliente (servidor). Junta o `audit_log` simulado com os eventos que, na
 * implementação real, também são gravados nele: pedidos/aprovações/sessões de acesso remoto (docs/12)
 * e pareamento de terminais (docs/15). Tudo derivado de `@/lib/mock`.
 */
import {
  DEFAULT_TZ,
  MOCK_NOW,
  getAuditLog,
  getClientUsers,
  getGateway,
  getPlatformUsers,
  getRemoteAccessSessions,
  getTerminals,
  getUnit,
  nowMs,
  type Client,
} from "@/lib/mock"
import { date, dateTime, time } from "@/lib/format"
import { CLIENT_ROLE_LABEL, PLATFORM_ROLE_LABEL } from "@/lib/roles"
import type { AuditActorKind, AuditCategory, AuditRow } from "@/components/settings/types"

const ACTION_META: Record<string, { label: string; category: AuditCategory }> = {
  "config.publish": { label: "Publicou a configuração do gateway", category: "config" },
  "tag.test_read": { label: "Testou a leitura de uma tag", category: "config" },
  "gateway.create": { label: "Provisionou um gateway", category: "config" },
  "shift.update": { label: "Alterou um turno", category: "config" },
  "user.invite": { label: "Adicionou um usuário", category: "users" },
  "stop.classify": { label: "Classificou uma parada", category: "production" },
  "support.impersonate": { label: "Entrou como suporte Engemase", category: "support" },
  "client.create": { label: "Criou o cliente na plataforma", category: "lifecycle" },
  "client.suspend": { label: "Suspendeu o cliente", category: "lifecycle" },
  "remote.request": { label: "Pediu acesso remoto ao gateway", category: "remote" },
  "remote.approve": { label: "Aprovou o acesso remoto", category: "remote" },
  "remote.reject": { label: "Recusou o acesso remoto", category: "remote" },
  "remote.start": { label: "Iniciou a sessão de acesso remoto", category: "remote" },
  "remote.end": { label: "Encerrou a sessão de acesso remoto", category: "remote" },
  "terminal.pair": { label: "Pareou um terminal", category: "terminals" },
}

interface RawEvent {
  id: string
  at: string
  actor: string
  impersonatedBy: string | null
  action: string
  entity: string
  entityName: string
  details: string | null
  ticket: string | null
}

const DAY = 86_400_000

function dayLabel(iso: string) {
  const d = date(iso)
  if (d === date(MOCK_NOW)) return `Hoje · ${d}`
  if (d === date(new Date(nowMs() - DAY).toISOString())) return `Ontem · ${d}`
  const long = new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: DEFAULT_TZ })
  return long.charAt(0).toUpperCase() + long.slice(1)
}

const mb = (bytes: number) => `${(bytes / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB trafegados`

export function buildAudit(client: Client): AuditRow[] {
  const platform = new Map(getPlatformUsers().map((u) => [u.name, u.platformRole!]))
  const members = new Map(
    getClientUsers(client.id).map((u) => [u.name, u.memberships.find((m) => m.clientId === client.id)?.role]),
  )

  const raw: RawEvent[] = getAuditLog(client.id).map((a) => ({
    id: a.id,
    at: a.at,
    actor: a.actorName,
    impersonatedBy: a.impersonatedBy,
    action: a.action,
    entity: a.entity,
    entityName: a.entityName,
    details: a.details ?? null,
    ticket: a.details?.match(/#\d+/)?.[0] ?? null,
  }))

  for (const s of getRemoteAccessSessions({ clientId: client.id })) {
    const gw = getGateway(s.gatewayId)?.name ?? s.gatewayId
    const base = { entity: "gateway", entityName: gw, impersonatedBy: null, ticket: s.ticket }
    raw.push({
      ...base,
      id: `${s.id}_req`,
      at: s.requestedAt,
      actor: s.requestedBy,
      action: "remote.request",
      details: `${s.reason} · ${s.durationMin} min${s.scope.plcForward ? ` · inclui acesso ao CLP (porta ${s.scope.plcForward.port})` : ""}`,
    })
    if (s.approvedBy && s.approvedAt) {
      const rejected = s.status === "rejected"
      raw.push({
        ...base,
        id: `${s.id}_dec`,
        at: s.approvedAt,
        actor: s.approvedBy,
        action: rejected ? "remote.reject" : "remote.approve",
        details: rejected ? (s.endedReason ?? null) : `Prazo de ${s.durationMin} min para ${s.requestedBy}`,
      })
    }
    if (s.startedAt) {
      raw.push({
        ...base,
        id: `${s.id}_start`,
        at: s.startedAt,
        actor: s.requestedBy,
        action: "remote.start",
        details: `Conexão ${s.connection === "direct" ? "direta" : "via relay"}${s.expiresAt ? ` · encerra até ${time(s.expiresAt)}` : ""}`,
      })
    }
    if (s.endedAt && s.startedAt) {
      const bySystem = /prazo/i.test(s.endedReason ?? "")
      raw.push({
        ...base,
        id: `${s.id}_end`,
        at: s.endedAt,
        actor: bySystem ? "Sistema" : s.requestedBy,
        action: "remote.end",
        details: [s.endedReason, s.bytes ? mb(s.bytes) : null].filter(Boolean).join(" · ") || null,
      })
    }
  }

  for (const t of getTerminals(client.id)) {
    if (!t.pairedBy || !t.pairedAt) continue
    raw.push({
      id: `${t.id}_pair`,
      at: t.pairedAt,
      actor: t.pairedBy,
      impersonatedBy: null,
      action: "terminal.pair",
      entity: "terminal",
      entityName: t.name,
      details: `${t.kind === "andon_tv" ? "TV Andon" : "Tablet do operador"} · ${getUnit(t.unitId)?.name ?? ""} · tema ${t.theme === "dark" ? "escuro" : t.theme === "light" ? "claro" : "automático"}`,
      ticket: null,
    })
  }

  const now = nowMs()
  return raw
    .filter((e) => Date.parse(e.at) <= now)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e) => {
      const pRole = platform.get(e.actor)
      const meta = ACTION_META[e.action] ?? { label: e.action, category: "config" as const }
      let actorKind: AuditActorKind = "client"
      let actorRole: string | null = null
      if (e.actor === "Sistema") {
        actorKind = "system"
        actorRole = "Automático"
      } else if (pRole) {
        actorKind = pRole === "support" || e.action.startsWith("support.") ? "support" : "engemase"
        actorRole = `Engemase · ${PLATFORM_ROLE_LABEL[pRole]}`
      } else {
        const r = members.get(e.actor)
        actorRole = r ? CLIENT_ROLE_LABEL[r] : null
      }
      return {
        id: e.id,
        at: e.at,
        dayKey: date(e.at),
        dayLabel: dayLabel(e.at),
        time: time(e.at),
        dateTime: dateTime(e.at),
        actor: e.actor,
        actorKind,
        actorRole,
        impersonatedBy: e.impersonatedBy,
        action: e.action,
        actionLabel: meta.label,
        category: meta.category,
        entity: e.entity,
        entityName: e.entityName,
        details: e.details,
        ticket: e.ticket,
        daysAgo: Math.floor((now - Date.parse(e.at)) / DAY),
      }
    })
}
