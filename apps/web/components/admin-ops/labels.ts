/**
 * Rótulos, tons e utilitários puros do console de operação.
 * Módulo neutro (sem "use client" e sem `@/lib/mock`): seguro para servidor e navegador.
 */
import type { RemoteAccessPolicy, RemoteAccessStatus } from "@/lib/mock"
import type { Tone } from "./bits"

// ---------------------------------------------------------------------------
// Frota / agente
// ---------------------------------------------------------------------------
export const GATEWAY_TONE = { online: "green", degraded: "amber", offline: "red", pending: "slate" } as const

/** Compara versões semânticas simples ("1.2.0", "1.3.0-beta.2"). */
export function compareVersions(a: string, b: string): number {
  const [ca, pa] = a.split("-")
  const [cb, pb] = b.split("-")
  const na = ca!.split(".").map(Number)
  const nb = cb!.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0)
    if (d !== 0) return d
  }
  if (pa && !pb) return -1
  if (!pa && pb) return 1
  return (pa ?? "").localeCompare(pb ?? "")
}

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------
/** Prazo máximo de uma concessão de suporte (docs/15 §3). */
export const SUPPORT_MAX_HOURS = 4

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------
export type AuditCategory = "platform" | "support" | "config" | "access" | "production"

export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  platform: "Plataforma",
  support: "Suporte Engemase",
  config: "Configuração",
  access: "Usuários e acessos",
  production: "Produção",
}

// ---------------------------------------------------------------------------
// Acesso remoto (docs/12)
// ---------------------------------------------------------------------------
/** Estados da sessão no protótipo (inclui "cancelada", prevista em docs/12). */
export type SessionStatus = RemoteAccessStatus | "cancelled"

export const STATUS_META: Record<SessionStatus, { label: string; tone: Tone }> = {
  requested: { label: "Aguardando aprovação", tone: "amber" },
  approved: { label: "Aprovada · ativando", tone: "blue" },
  active: { label: "Ativa", tone: "green" },
  ended: { label: "Encerrada", tone: "slate" },
  rejected: { label: "Recusada", tone: "red" },
  expired_unapproved: { label: "Expirou sem aprovação", tone: "slate" },
  revoked: { label: "Revogada", tone: "red" },
  cancelled: { label: "Cancelada", tone: "slate" },
}

export const MODE_LABEL: Record<RemoteAccessPolicy["mode"], string> = {
  disabled: "Desativado",
  approval_required: "Com aprovação",
  preapproved_window: "Janela pré-aprovada",
}

/** Portas permitidas para encaminhamento a CLP (docs/12). */
export const PLC_PORTS = [
  { port: 502, label: "502 · Modbus TCP" },
  { port: 102, label: "102 · Siemens S7" },
  { port: 44818, label: "44818 · EtherNet/IP" },
]

export function bytesLabel(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
  if (b >= 1_000) return `${Math.round(b / 1_000)} kB`
  return `${b} B`
}
