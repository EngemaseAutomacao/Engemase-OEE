"use server"

/**
 * Server Actions do APARELHO (TV Andon e tablet pareados; docs/15, riscos 11 e 12). Ficam sob `/terminal`,
 * onde vale o cookie do aparelho; nunca usam a sessão de uma pessoa.
 *
 * - `parearAction`: troca o código de pareamento (uso único, 10 min, limite por IP) pelo token do aparelho e
 *   grava o cookie próprio (`lib/server/terminal/cookie.ts`).
 * - Ações do chão do tablet: o contexto vem do token do aparelho (escopo = as máquinas do terminal; TV não tem
 *   `floor.act` e é recusada). As regras são as mesmas da pessoa (`lib/server/production/floor-actions.ts`),
 *   com o ator "terminal" na auditoria.
 */
import { headers } from "next/headers"
import { requestIp } from "@/lib/server/auth/request-ip"
import { getDb } from "@/lib/server/db"
import { changeProduct, classifyStop, type FloorResult, launchReject, undoReject } from "@/lib/server/production/floor-actions"
import { currentTerminal, setDeviceCookie } from "@/lib/server/terminal/cookie"
import { parearAparelho } from "@/lib/server/terminal/terminals"

export type ParearResult = { readonly ok: true } | { readonly ok: false; readonly mensagem: string }

/** Pareia este aparelho com o código gerado em Configurações › Terminais. */
export async function parearAction(code: unknown): Promise<ParearResult> {
  const db = getDb()
  if (db === null) return { ok: false, mensagem: "Pareamento indisponível no momento. Avise a Engemase." }
  const r = await parearAparelho(db, code, { ip: requestIp(await headers()) })
  if (!r.ok) return { ok: false, mensagem: r.mensagem }
  await setDeviceCookie(r.token, r.expiresAt)
  return { ok: true }
}

const NAO_PAREADO = {
  status: "error",
  message: "Este aparelho não está mais pareado. Atualize a tela; se continuar, peça um código novo ao supervisor.",
} as const

/** Contexto do tablet pareado; sem aparelho válido, a resposta de "não pareado". */
async function tablet() {
  return currentTerminal()
}

export async function classifyStopTerminalAction(input: unknown): Promise<FloorResult<{ late: boolean }>> {
  const t = await tablet()
  return t === null ? NAO_PAREADO : classifyStop(getDb(), t.ctx, input)
}

export async function launchRejectTerminalAction(input: unknown): Promise<FloorResult<{ id: string; late: boolean }>> {
  const t = await tablet()
  return t === null ? NAO_PAREADO : launchReject(getDb(), t.ctx, input)
}

export async function undoRejectTerminalAction(entryId: unknown): Promise<FloorResult<{ id: string }>> {
  const t = await tablet()
  return t === null ? NAO_PAREADO : undoReject(getDb(), t.ctx, entryId)
}

export async function changeProductTerminalAction(input: unknown): Promise<FloorResult<{ previousProductId: string | null }>> {
  const t = await tablet()
  return t === null ? NAO_PAREADO : changeProduct(getDb(), t.ctx, input)
}
