/** Rótulos e formatação do acesso remoto (visão do cliente). */
import type { RemoteAccessStatus } from "@/lib/mock"
import { dateTime, time } from "@/lib/format"
import type { PolicyMode, PolicyWindow } from "./remote-types"

export const STATUS_META: Record<RemoteAccessStatus, { label: string; className: string }> = {
  requested: { label: "Aguardando aprovação", className: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped" },
  approved: { label: "Aprovada · ativando", className: "bg-[#257bb4]/12 text-[#257bb4] dark:text-[#4a9fd6]" },
  active: { label: "Ativa", className: "bg-state-running/12 text-state-running" },
  ended: { label: "Encerrada", className: "bg-muted text-muted-foreground" },
  rejected: { label: "Recusada", className: "bg-state-fault/12 text-state-fault" },
  expired_unapproved: { label: "Expirou sem aprovação", className: "bg-muted text-muted-foreground" },
  revoked: { label: "Revogada", className: "bg-[#e96549]/14 text-[#cf5539]" },
}

export const MODE_META: Record<PolicyMode, { label: string; short: string; description: string }> = {
  disabled: { label: "Desativado", short: "Desativado", description: "A Engemase não consegue pedir acesso remoto aos seus gateways." },
  approval_required: { label: "Com aprovação", short: "Com aprovação", description: "Cada pedido precisa do “aprovar” de um admin do cliente, com MFA." },
  preapproved_window: {
    label: "Janela pré-aprovada",
    short: "Pré-aprovada",
    description: "Pedidos dentro da janela combinada são liberados sozinhos; fora dela, pedem aprovação.",
  },
}

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]

export const DURATION_STEPS = [15, 30, 60, 120, 240, 480]

/** 90 → "1h30", 60 → "1 h", 30 → "30 min" */
export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h} h`
}

/** Contagem regressiva "1:04:59" / "12:05". */
export function countdown(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`
}

export function bytesLabel(bytes: number | null): string {
  if (bytes === null) return "—"
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`
  return `${(bytes / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
}

export const timeOf = (ms: number) => time(new Date(ms).toISOString())
export const dateTimeOf = (ms: number) => dateTime(new Date(ms).toISOString())

/** "há 22 min" a partir de dois instantes em ms. */
export function agoLabel(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000))
  if (s < 60) return "agora"
  const min = Math.floor(s / 60)
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h${String(min % 60).padStart(2, "0")}`
  return `há ${Math.floor(h / 24)} d`
}

export function windowLabel(w: PolicyWindow): string {
  return `${WEEKDAYS[w.day] ?? "?"}, ${w.start}–${w.end}`
}

export const CONNECTION_LABEL = { direct: "Direta (ponto a ponto)", relay: "Relay HTTPS 443" } as const
