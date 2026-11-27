/**
 * Ações do chão (D18, L3, L19) a partir de um contexto JÁ conferido: o da pessoa logada
 * (`app/(kiosk)/[cliente]/operador/actions.ts`) ou o do terminal pareado (`app/terminal/actions.ts`).
 * Exigem `floor.act`, e a máquina precisa estar no escopo do contexto. As regras (RLS, prazo do lançamento
 * atrasado, auditoria, turno sujo) ficam em `floor.ts` e `quality.ts`.
 *
 * Erros esperados (`ProductionRuleError`) voltam como mensagem em português; o resto é registrado no log e a
 * tela mostra uma mensagem genérica.
 */
import { qualityEntry } from "@engemase/db"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { hasPermission, type TenantContext } from "@/lib/server/access/context"
import { getMachine } from "@/lib/server/access/data"
import { withContext } from "@/lib/server/access/load"
import { machineInScope } from "@/lib/server/access/scope"
import type { GatewayDb } from "@/lib/server/gateway/types"
import { type ProductionActor, ProductionRuleError } from "./errors"
import { changeProduct as changeProductRule, classifyStop as classifyStopRule } from "./floor"
import { recordQualityEntry, reverseQualityEntry } from "./quality"

export type FloorResult<T = undefined> = { readonly status: "ok"; readonly data: T } | { readonly status: "error"; readonly message: string }

const GENERIC = "Não foi possível gravar agora. Tente de novo; se continuar, avise o supervisor."

export function actorOf(ctx: TenantContext): ProductionActor {
  if (ctx.access.kind === "member") return { type: "user", id: ctx.user.id, label: ctx.user.name, clientRole: ctx.access.role }
  if (ctx.access.kind === "terminal") return { type: "terminal", id: ctx.access.terminalId, label: `Terminal ${ctx.user.name}`, clientRole: null }
  return { type: "engemase", id: ctx.user.id, label: `${ctx.user.name} (Engemase)`, clientRole: null }
}

/** Roda a ação com `floor.act` conferido; traduz os erros esperados. */
export async function runFloor<T>(db: GatewayDb | null, ctx: TenantContext, label: string, fn: (db: GatewayDb) => Promise<T>): Promise<FloorResult<T>> {
  // TV Andon (só leitura) ou papel sem ações do chão: recusa com mensagem, sem tocar no banco.
  if (!hasPermission(ctx, "floor.act")) return { status: "error", message: "Este acesso não faz apontamentos (só consulta)." }
  if (db === null) return { status: "error", message: GENERIC }
  try {
    return { status: "ok", data: await fn(db) }
  } catch (error) {
    if (error instanceof ProductionRuleError) return { status: "error", message: error.message }
    console.error(`[chão] falha em ${label}`, error)
    return { status: "error", message: GENERIC }
  }
}

/** Máquina pelo id, dentro do cliente e do escopo do contexto; senão, "não encontrada". */
async function machineOf(db: GatewayDb, ctx: TenantContext, machineId: unknown): Promise<{ id: string; unitId: string }> {
  const m = typeof machineId === "string" ? await getMachine(db, ctx, machineId) : null
  if (m === null) throw new ProductionRuleError("not_found", "Máquina não encontrada.")
  return m
}

const ClassifyInput = z.object({ eventId: z.string(), reasonId: z.string().nullable() })

/** Classifica a parada (ou tira o motivo, com `reasonId: null`, para desfazer). */
export async function classifyStop(db: GatewayDb | null, ctx: TenantContext, input: unknown): Promise<FloorResult<{ late: boolean }>> {
  return runFloor(db, ctx, "classificar parada", async (db) => {
    const parsed = ClassifyInput.safeParse(input)
    if (!parsed.success) throw new ProductionRuleError("invalid_input", "Parada ou motivo inválido.")
    return classifyStopRule(db, {
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
export async function launchReject(db: GatewayDb | null, ctx: TenantContext, input: unknown): Promise<FloorResult<{ id: string; late: boolean }>> {
  return runFloor(db, ctx, "lançar refugo", async (db) => {
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
export async function undoReject(db: GatewayDb | null, ctx: TenantContext, entryId: unknown): Promise<FloorResult<{ id: string }>> {
  return runFloor(db, ctx, "desfazer refugo", async (db) => {
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
export async function changeProduct(db: GatewayDb | null, ctx: TenantContext, input: unknown): Promise<FloorResult<{ previousProductId: string | null }>> {
  return runFloor(db, ctx, "trocar produto", async (db) => {
    const parsed = ProductInput.safeParse(input)
    if (!parsed.success) throw new ProductionRuleError("invalid_input", "Máquina ou produto inválido.")
    return changeProductRule(db, {
      organizationId: ctx.organizationId,
      machineId: parsed.data.machineId,
      productId: parsed.data.productId,
      actor: actorOf(ctx),
      allowMachine: (m) => machineInScope(ctx.scope, m),
    })
  })
}
