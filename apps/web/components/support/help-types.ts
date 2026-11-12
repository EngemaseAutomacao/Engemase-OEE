/**
 * Tipos da central de ajuda (compartilhados entre o montador de dados do servidor e os componentes de cliente).
 * Tudo serializável: a página (servidor) monta e passa por props.
 */
import type { HelpArticle } from "@/lib/mock"

export type HelpCategoryId = HelpArticle["category"]

/** Bloco de conteúdo de um artigo. Texto aceita **negrito** e `código` inline. */
export type ArticleBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "table"; head: string[]; rows: string[][]; caption?: string; mono?: number[] }
  | { kind: "callout"; tone: "info" | "warn" | "tip"; title?: string; text: string }
  | { kind: "steps"; title?: string; items: { title: string; text: string }[] }
  | { kind: "meters"; items: { label: string; value: number; note: string; color: string }[] }
  | { kind: "code"; text: string }

export interface ArticleVM {
  slug: string
  category: HelpCategoryId
  categoryLabel: string
  title: string
  summary: string
  minutes: number
  audience: string
  /** Ordem de popularidade (1 = mais lido). */
  rank: number
  body: ArticleBlock[]
  /** Texto normalizado (sem acentos, minúsculo) para a busca. */
  searchText: string
}

export interface FaqVM {
  id: string
  q: string
  a: string
  searchText: string
}

export interface CategoryVM {
  id: HelpCategoryId
  label: string
  count: number
}

export interface TicketTarget {
  id: string
  label: string
  hint: string
  group: "gateway" | "machine"
}

export type TicketPriority = "low" | "normal" | "high" | "critical"

export interface TicketVM {
  id: string
  number: string
  subject: string
  target: string | null
  priority: TicketPriority
  status: "open" | "in_progress" | "resolved" | "waiting"
  owner: string
  openedLabel: string
}

export interface PlatformServiceVM {
  id: string
  name: string
  detail: string
  status: "ok" | "degraded" | "down"
}

export interface HelpData {
  clientName: string
  clientSlug: string
  firstName: string
  articles: ArticleVM[]
  categories: CategoryVM[]
  faq: FaqVM[]
  targets: TicketTarget[]
  tickets: TicketVM[]
  nextTicket: number
  pendingRemote: number
}

/** Normaliza para busca: minúsculas e sem acentos. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}
