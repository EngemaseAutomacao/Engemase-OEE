"use server"

/**
 * Server Actions da tela do operador (D18, L3, L19): classificar parada, lançar e desfazer refugo, trocar
 * produto. Cada uma confere de novo, no servidor, a sessão, o cliente da URL e a permissão `floor.act`
 * (`requirePermission`; sem acesso → 404), e a máquina precisa estar no escopo da pessoa. As regras (RLS,
 * prazo do lançamento atrasado, auditoria, turno sujo) ficam em `lib/server/production`.
 *
 * Erros esperados (`ProductionRuleError`) voltam como mensagem em português; o resto é registrado no log e a
 * tela mostra uma mensagem genérica.
 */
import { qualityEntry } from "@engemase/db"
import { eq } from "drizzle-orm"
import { z } from "zod"
import type { TenantContext } from "@/lib/server/access/context"
import { getMachine } from "@/lib/server/access/data"
import { withContext } from "@/lib/server/access/load"
import { requirePermission } from "@/lib/server/access/require-tenant"
import { machineInScope } from "@/lib/server/access/scope"
import { getDb } from "@/lib/server/db"
import type { GatewayDb } from "@/lib/server/gateway/types"
import { type ProductionActor, ProductionRuleError } from "@/lib/server/production/errors"
import { changeProduct, classifyStop } from "@/lib/server/production/floor"
import { recordQualityEntry, reverseQualityEntry } from "@/lib/server/production/quality"

export type FloorResult<T = undefined> = { readonly status: "ok"; readonly data: T } | { readonly status: "error"; readonly message: string }

const Slug = z.string().min(1).max(63)
const GENERIC = "Não foi possível gravar agora. Tente de novo; se continuar, avise o supervisor."

function actorOf(ctx: TenantContext): ProductionActor {
  return ctx.access.kind === "member"
    ? { type: "user", id: ctx.user.id, label: ctx.user.name, clientRole: ctx.access.role }
    : { type: "engemase", id: ctx.user.id, label: `${ctx.user.name} (Engemase)`, clientRole: null }
}

async function run<T>(slug: unknown, label: string, fn: (db: GatewayDb, ctx: TenantContext) => Promise<T>): Promise<FloorResult<T>> {
  const parsed = Slug.safeParse(slug)
  const ctx = await requirePermission(parsed.success ? parsed.data : "-", "floor.act")
  const db = getDb()
  if (db === null) return { status: "error", message: GENERIC }
  try {
    return { status: "ok", data: await fn(db, ctx) }
  } catch (error) {
    if (error instanceof ProductionRuleError) return { status: "error", message: error.message }
    console.error(`[operador] falha em ${label}`, error)
    return { status: "error", message: GENERIC }
  }
}

/** Máquina pelo id, dentro do cliente e do escopo da pessoa; senão, "não encontrada". */
async function machineOf(db: GatewayDb, ctx: TenantContext, machineId: unknown): Promise<{ id: string; unitId: string }> {
  const m = typeof machineId === "string" ? await getMachine(db, ctx, machineId) : null
  if (m === null) throw new ProductionRuleError("not_found", "Máquina não encontrada.")
  return m
}

const ClassifyInput = z.object({ eventId: z.string(), reasonId: z.string().nullable() })

/** Classifica a parada (ou tira o motivo, com `reasonId: null`, para desfazer). */
export async function classifyStopAction(slug: unknown, input: unknown): Promise<FloorResult<{ late: boolean }>> {
  return run(slug, "classificar parada", async (db, ctx) => {
    const parsed = ClassifyInput.safeParse(input)
    if (!parsed.success) throw new ProductionRuleError("invalid_input", "Parada ou motivo inválido.")
    return classifyStop(db, {
      organizationId: ctx.organizationId,
      eventId: parsed.data.eventId,
      reasonId: parsed.data.reasonId,
      actor: actorOf(ctx),
      allowMachine: (m) => machineInScope(ctx.scope, m),
    })
  })
}

const RejectInput = z.object({
  machineId: z.string(),
  quantity: z.number(),
  rejectReasonId: z.string().nullable(),
  productCode: z.string().nullable(),
})

/** Lança refugo manual agora (soma ao do CLP). Devolve o id, para o "Desfazer". */
export async function launchRejectAction(slug: unknown, input: unknown): Promise<FloorResult<{ id: string; late: boolean }>> {
  return run(slug, "lançar refugo", async (db, ctx) => {
    const parsed = RejectInput.safeParse(input)
    if (!parsed.success) throw new ProductionRuleError("invalid_input", "Dados do refugo inválidos.")
    const m = await machineOf(db, ctx, parsed.data.machineId)
    return recordQualityEntry(db, {
      organizationId: ctx.organizationId,
      entry: {
        machineId: m.id,
        at: new Date(),
        quantity: parsed.data.quantity,
        rejectReasonId: parsed.data.rejectReasonId,
        productCode: parsed.data.productCode,
      },
      actor: actorOf(ctx),
    })
  })
}

/** Desfaz um lançamento de refugo (estorno com motivo, auditado). Só de máquina no escopo da pessoa. */
export async function undoRejectAction(slug: unknown, entryId: unknown): Promise<FloorResult<{ id: string }>> {
  return run(slug, "desfazer refugo", async (db, ctx) => {
    if (typeof entryId !== "string" || !z.uuid().safeParse(entryId).success) throw new ProductionRuleError("not_found", "Lançamento não encontrado.")
    const [entry] = await withContext(db, ctx, (tx) =>
      tx.select({ machineId: qualityEntry.machineId }).from(qualityEntry).where(eq(qualityEntry.id, entryId)).limit(1),
    )
    if (entry === undefined) throw new ProductionRuleError("not_found", "Lançamento não encontrado.")
    await machineOf(db, ctx, entry.machineId)
    const r = await reverseQualityEntry(db, { organizationId: ctx.organizationId, entryId, reason: "Desfeito na tela do operador", actor: actorOf(ctx) })
    return { id: r.id }
  })
}

const ProductInput = z.object({ machineId: z.string(), productId: z.string() })

/** Troca o produto em produção. Devolve o produto anterior apontado pelo operador (para o "Desfazer"). */
export async function changeProductAction(slug: unknown, input: unknown): Promise<FloorResult<{ previousProductId: string | null }>> {
  return run(slug, "trocar produto", async (db, ctx) => {
    const parsed = ProductInput.safeParse(input)
    if (!parsed.success) throw new ProductionRuleError("invalid_input", "Máquina ou produto inválido.")
    return changeProduct(db, {
      organizationId: ctx.organizationId,
      machineId: parsed.data.machineId,
      productId: parsed.data.productId,
      actor: actorOf(ctx),
      allowMachine: (m) => machineInScope(ctx.scope, m),
    })
  })
}
