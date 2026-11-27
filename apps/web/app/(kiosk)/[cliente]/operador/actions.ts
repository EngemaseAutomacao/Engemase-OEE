"use server"

/**
 * Server Actions da tela do operador para a PESSOA logada (D18, L3, L19): confere de novo, no servidor, a
 * sessão, o cliente da URL e a permissão `floor.act` (`requirePermission`; sem acesso → 404) e chama as ações
 * de `lib/server/production/floor-actions.ts` (máquina no escopo da pessoa). O tablet pareado usa as mesmas
 * ações por `app/terminal/actions.ts`, com o contexto do aparelho.
 */
import { z } from "zod"
import { requirePermission } from "@/lib/server/access/require-tenant"
import { getDb } from "@/lib/server/db"
import { changeProduct, classifyStop, type FloorResult, launchReject, undoReject } from "@/lib/server/production/floor-actions"

export type { FloorResult }

const Slug = z.string().min(1).max(63)

async function ctxOf(slug: unknown) {
  const parsed = Slug.safeParse(slug)
  return requirePermission(parsed.success ? parsed.data : "-", "floor.act")
}

/** Classifica a parada (ou tira o motivo, com `reasonId: null`, para desfazer). */
export async function classifyStopAction(slug: unknown, input: unknown): Promise<FloorResult<{ late: boolean }>> {
  return classifyStop(getDb(), await ctxOf(slug), input)
}

/** Lança refugo manual agora (soma ao do CLP). Devolve o id, para o "Desfazer". */
export async function launchRejectAction(slug: unknown, input: unknown): Promise<FloorResult<{ id: string; late: boolean }>> {
  return launchReject(getDb(), await ctxOf(slug), input)
}

/** Desfaz um lançamento de refugo (estorno com motivo, auditado). */
export async function undoRejectAction(slug: unknown, entryId: unknown): Promise<FloorResult<{ id: string }>> {
  return undoReject(getDb(), await ctxOf(slug), entryId)
}

/** Troca o produto em produção. Devolve o produto anterior apontado pelo operador (para o "Desfazer"). */
export async function changeProductAction(slug: unknown, input: unknown): Promise<FloorResult<{ previousProductId: string | null }>> {
  return changeProduct(getDb(), await ctxOf(slug), input)
}
