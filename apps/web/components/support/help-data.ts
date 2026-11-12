/**
 * Monta os dados da central de ajuda a partir de `@/lib/mock`. Usado SÓ pela página (servidor).
 * Devolve objetos serializáveis.
 */
import {
  getCurrentUser,
  getGateways,
  getHelpArticles,
  getLine,
  getMachines,
  getRemoteAccessSessions,
  helpCategories,
  helpFaq,
  type Client,
  type RemoteAccessSession,
} from "@/lib/mock"
import { dateTime } from "@/lib/format"
import { ARTICLE_BODY, POPULAR_ORDER } from "./help-articles"
import { normalize, type ArticleBlock, type CategoryVM, type HelpCategoryId, type HelpData, type TicketVM } from "./help-types"

function blockText(b: ArticleBlock): string {
  switch (b.kind) {
    case "p":
    case "h":
    case "code":
      return b.text
    case "callout":
      return `${b.title ?? ""} ${b.text}`
    case "list":
      return b.items.join(" ")
    case "table":
      return [...b.head, ...b.rows.flat(), b.caption ?? ""].join(" ")
    case "steps":
      return `${b.title ?? ""} ${b.items.map((i) => `${i.title} ${i.text}`).join(" ")}`
    case "meters":
      return b.items.map((i) => `${i.label} ${i.note}`).join(" ")
  }
}

const TICKET_STATUS: Record<RemoteAccessSession["status"], TicketVM["status"]> = {
  requested: "in_progress",
  approved: "in_progress",
  active: "in_progress",
  ended: "resolved",
  rejected: "waiting",
  expired_unapproved: "waiting",
  revoked: "waiting",
}

export function buildHelp(client: Client): HelpData {
  const me = getCurrentUser()

  const articles = getHelpArticles().map((a) => {
    const body: ArticleBlock[] = ARTICLE_BODY[a.slug] ?? [{ kind: "p", text: a.summary }]
    const categoryLabel = helpCategories[a.category]
    const rank = POPULAR_ORDER.indexOf(a.slug)
    return {
      ...a,
      categoryLabel,
      rank: rank === -1 ? 99 : rank + 1,
      body,
      searchText: normalize([a.title, a.summary, categoryLabel, a.audience, ...body.map(blockText)].join(" ")),
    }
  })

  const categories: CategoryVM[] = (Object.keys(helpCategories) as HelpCategoryId[]).map((id) => ({
    id,
    label: helpCategories[id],
    count: articles.filter((a) => a.category === id).length,
  }))

  const faq = helpFaq.map((f, i) => ({ id: `faq-${i + 1}`, q: f.q, a: f.a, searchText: normalize(`${f.q} ${f.a}`) }))

  const gateways = getGateways(client.id)
  const targets = [
    ...gateways.map((g) => ({ id: g.id, label: g.name, hint: g.hostname === "—" ? "aguardando ativação" : g.hostname, group: "gateway" as const })),
    ...getMachines(client.id).map((m) => ({ id: m.id, label: m.name, hint: `${m.code} · ${getLine(m.lineId)?.name ?? ""}`, group: "machine" as const })),
  ]

  // Chamados recentes do cliente = chamados que motivaram pedidos de acesso remoto (únicos dados de chamado no protótipo).
  const sessions = getRemoteAccessSessions({ clientId: client.id })
  const tickets: TicketVM[] = sessions.map((s) => ({
    id: s.id,
    number: s.ticket,
    subject: s.reason,
    target: gateways.find((g) => g.id === s.gatewayId)?.name ?? null,
    priority: "normal",
    status: TICKET_STATUS[s.status],
    owner: s.requestedBy,
    openedLabel: dateTime(s.requestedAt),
  }))

  const allTickets = getRemoteAccessSessions().map((s) => Number(s.ticket.replace(/\D/g, "")) || 0)
  const nextTicket = Math.max(1000, ...allTickets) + 1

  return {
    clientName: client.name,
    clientSlug: client.slug,
    firstName: me.name.split(" ")[0] ?? me.name,
    articles: articles.sort((a, b) => a.rank - b.rank),
    categories,
    faq,
    targets,
    tickets,
    nextTicket,
    pendingRemote: sessions.filter((s) => s.status === "requested").length,
  }
}

/** Situação dos serviços e dos gateways do cliente, para o cartão "Status da plataforma". */
export function buildPlatformStatus(client: Client) {
  const gateways = getGateways(client.id).filter((g) => g.status !== "pending")
  const online = gateways.filter((g) => g.status === "online" || g.status === "degraded").length
  const offline = gateways.filter((g) => g.status === "offline").map((g) => g.name)
  const agentVersions = [...new Set(gateways.map((g) => g.agentVersion).filter((v): v is string => Boolean(v)))].sort().reverse()
  return {
    gatewaysOnline: online,
    gatewaysTotal: gateways.length,
    offlineNames: offline,
    agentVersion: agentVersions[0] ?? null,
    outdatedAgents: agentVersions.length > 1,
  }
}
