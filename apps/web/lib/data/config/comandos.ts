/**
 * Tradução de um comando da fila (`gateway_command`) para a tela: estado e texto do resultado.
 * Função pura, usada pela página do gateway e pela Server Action que acompanha o comando.
 */
import type { CommandStatus as StatusDaTela } from "@/components/access/labels"

export interface ComandoDoBanco {
  readonly status: string
  readonly result: Record<string, unknown> | null
  readonly errorCode: string | null
}

export interface ResumoDoComando {
  readonly status: StatusDaTela
  readonly ok: boolean | null
  readonly result: string
  readonly durationMs: number | null
}

function fmtValor(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })
  if (typeof v === "boolean") return v ? "1 (ligado)" : "0 (desligado)"
  return "—"
}

export function resumoDoComando(c: ComandoDoBanco): ResumoDoComando {
  const res = c.result ?? {}
  const duration = typeof res.duration_ms === "number" ? res.duration_ms : null
  if (c.status === "pending") return { status: "queued", ok: null, result: "Na fila: entregue no próximo sincronismo do gateway", durationMs: null }
  if (c.status === "sent") return { status: "sent", ok: null, result: "Entregue ao gateway; aguardando a resposta", durationMs: null }
  if (c.status === "ok") {
    const r = (res.result ?? {}) as Record<string, unknown>
    let text = "Concluído"
    if (r.state === "downloaded" && typeof r.version === "string") text = `Versão ${r.version} baixada e conferida; o agente instala e reinicia (volta à anterior se não sincronizar em 5 min)`
    else if (r.state === "current" && typeof r.version === "string") text = `Já estava na versão ${r.version}`
    else if ("value" in r) text = `Valor ${fmtValor(r.value)}${r.quality && r.quality !== "good" ? ` (qualidade ${String(r.quality)})` : ""}`
    else if (typeof r.latency_ms === "number") text = `Conexão OK em ${r.latency_ms} ms`
    else if (typeof r.version === "number") text = r.outcome === "unchanged" ? `Configuração v${r.version} já estava aplicada` : `Configuração v${r.version} aplicada`
    else if (typeof r.restart_at === "string") text = "Agente reiniciando"
    return { status: "done", ok: true, result: text, durationMs: duration }
  }
  if (c.status === "expired") return { status: "expired", ok: false, result: "Expirou sem resposta do gateway", durationMs: null }
  if (c.status === "cancelled") return { status: "expired", ok: false, result: "Cancelado", durationMs: null }
  const err = (res.error ?? {}) as { message?: unknown; code?: unknown }
  const msg = typeof err.message === "string" ? err.message : (c.errorCode ?? "Falhou")
  return { status: "failed", ok: false, result: c.status === "rejected" ? `Recusado pelo gateway: ${msg}` : msg, durationMs: duration }
}
