/**
 * Ações do chão (tela do operador, D18/L19): classificar uma parada e trocar o produto em produção.
 * O refugo manual e o estorno ficam em `quality.ts`.
 *
 * Regras comuns:
 * - tudo sob a RLS do cliente (`withTenant`): evento, máquina, motivo ou produto de outro cliente não existe;
 * - a máquina precisa estar no escopo de quem age (`allowMachine`, conferido com o escopo do contexto);
 * - prazo do lançamento atrasado (L3), o mesmo do refugo: até o fim do turno seguinte; depois, só supervisor
 *   ou admin do cliente;
 * - auditoria com antes e depois, e o turno consolidado do horário afetado fica "sujo" para o recálculo.
 *
 * Classificar (L19): vale a última classificação, e todas ficam na auditoria. `reasonId = null` tira o
 * motivo (o "Desfazer" da tela). Só paradas e falhas (STOPPED/FAULT) recebem motivo por aqui.
 *
 * Trocar produto (docs/05: "quando não vier do CLP"): fecha a corrida aberta da máquina e abre outra
 * (`production_run`, origem `operator`). Os minutos sem produto do CLP passam a usar o produto apontado
 * (`fillMinuteProducts`, em `runs.ts`), então o ciclo ideal do cálculo acompanha a troca.
 */
import { auditLog, downtimeReason, machineStateEvent, product, productionRun, unitOperator, withTenant } from "@engemase/db"
import type { GatewayTx } from "@/lib/server/gateway/types"
import { and, desc, eq, isNull, lte } from "drizzle-orm"
import { z } from "zod"
import type { GatewayDb } from "@/lib/server/gateway/types"
import { type ProductionActor, ProductionRuleError } from "./errors"
import { checkDeadline, loadMachine, markShiftDirtyAt } from "./quality"

const UUID = z.uuid({ error: "Identificador inválido." })

/** A máquina (id + unidade) está no escopo de quem age? */
export type MachineGuard = (m: { readonly id: string; readonly unitId: string }) => boolean

const NOT_IN_SCOPE = () => new ProductionRuleError("not_found", "Máquina não encontrada.")

function actorUserId(actor: ProductionActor): string | null {
  return actor.type === "user" || actor.type === "engemase" ? actor.id : null
}

/** Operador do chão escolhido no tablet: precisa estar ativo e ser da unidade da máquina. */
async function checkOperator(tx: GatewayTx, operatorId: string | null | undefined, unitId: string): Promise<string | null> {
  if (operatorId === null || operatorId === undefined) return null
  if (!UUID.safeParse(operatorId).success) throw new ProductionRuleError("not_found", "Operador não encontrado.")
  const [op] = await tx
    .select({ id: unitOperator.id })
    .from(unitOperator)
    .where(and(eq(unitOperator.id, operatorId), eq(unitOperator.unitId, unitId), eq(unitOperator.active, true), isNull(unitOperator.deletedAt)))
    .limit(1)
  if (op === undefined) throw new ProductionRuleError("not_found", "Operador não encontrado ou desativado. Escolha de novo quem está operando.")
  return op.id
}

export interface ClassifyStopInput {
  readonly organizationId: string
  readonly eventId: string
  /** Motivo escolhido; `null` tira o motivo (desfazer). */
  readonly reasonId: string | null
  /** Operador do chão escolhido no tablet (D18), quando houver. */
  readonly operatorId?: string | null
  readonly actor: ProductionActor
  readonly allowMachine: MachineGuard
  readonly now?: Date
}

/** Classifica (ou desfaz a classificação de) uma parada. Devolve se foi fora do prazo (por supervisor). */
export async function classifyStop(db: GatewayDb, input: ClassifyStopInput): Promise<{ late: boolean }> {
  if (!UUID.safeParse(input.eventId).success) throw new ProductionRuleError("not_found", "Parada não encontrada.")
  if (input.reasonId !== null && !UUID.safeParse(input.reasonId).success) throw new ProductionRuleError("not_found", "Motivo não encontrado.")
  const now = input.now ?? new Date()

  return withTenant(db, input.organizationId, async (tx) => {
    const [ev] = await tx
      .select({ id: machineStateEvent.id, machineId: machineStateEvent.machineId, state: machineStateEvent.state, startedAt: machineStateEvent.startedAt, reasonId: machineStateEvent.reasonId })
      .from(machineStateEvent)
      .where(eq(machineStateEvent.id, input.eventId))
      .for("update")
      .limit(1)
    if (ev === undefined) throw new ProductionRuleError("not_found", "Parada não encontrada.")
    const m = await loadMachine(tx, ev.machineId)
    if (!input.allowMachine(m)) throw NOT_IN_SCOPE()
    if (ev.state !== "STOPPED" && ev.state !== "FAULT") {
      throw new ProductionRuleError("invalid_input", "Só paradas e falhas recebem motivo por aqui.")
    }
    if (input.reasonId !== null) {
      const [reason] = await tx
        .select({ id: downtimeReason.id })
        .from(downtimeReason)
        .where(and(eq(downtimeReason.id, input.reasonId), eq(downtimeReason.active, true), isNull(downtimeReason.deletedAt)))
        .limit(1)
      if (reason === undefined) throw new ProductionRuleError("not_found", "Motivo não encontrado ou desativado.")
    }
    const late = await checkDeadline(tx, m, ev.startedAt, now, input.actor, "classificar a parada")
    const operatorId = input.reasonId === null ? null : await checkOperator(tx, input.operatorId, m.unitId)
    if (ev.reasonId === input.reasonId) return { late }

    await tx
      .update(machineStateEvent)
      .set(
        input.reasonId === null
          ? { reasonId: null, classifiedBy: null, classifiedAt: null, classifiedOperatorId: null }
          : { reasonId: input.reasonId, classifiedBy: actorUserId(input.actor), classifiedAt: now, classifiedOperatorId: operatorId },
      )
      .where(eq(machineStateEvent.id, ev.id))
    await tx.insert(auditLog).values({
      organizationId: input.organizationId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      actorLabel: input.actor.label ?? null,
      action: input.reasonId === null ? "downtime.unclassified" : "downtime.classified",
      entityType: "machine_state_event",
      entityId: ev.id,
      unitId: m.unitId,
      before: { reason_id: ev.reasonId },
      after: { reason_id: input.reasonId, operator_id: operatorId, machine_id: m.id, started_at: ev.startedAt.toISOString(), late },
      at: now,
    })
    await markShiftDirtyAt(tx, m.id, ev.startedAt, now)
    return { late }
  })
}

export interface ChangeProductInput {
  readonly organizationId: string
  readonly machineId: string
  readonly productId: string
  /** Operador do chão escolhido no tablet (D18), quando houver. */
  readonly operatorId?: string | null
  readonly actor: ProductionActor
  readonly allowMachine: MachineGuard
  readonly now?: Date
}

/** Troca o produto em produção na máquina. Devolve o produto anterior (apontado pelo operador), para desfazer. */
export async function changeProduct(db: GatewayDb, input: ChangeProductInput): Promise<{ previousProductId: string | null }> {
  if (!UUID.safeParse(input.machineId).success) throw NOT_IN_SCOPE()
  if (!UUID.safeParse(input.productId).success) throw new ProductionRuleError("not_found", "Produto não encontrado.")
  const now = input.now ?? new Date()

  return withTenant(db, input.organizationId, async (tx) => {
    const m = await loadMachine(tx, input.machineId)
    if (!input.allowMachine(m)) throw NOT_IN_SCOPE()
    const [p] = await tx
      .select({ id: product.id, code: product.code })
      .from(product)
      .where(and(eq(product.id, input.productId), isNull(product.deletedAt)))
      .limit(1)
    if (p === undefined) throw new ProductionRuleError("not_found", "Produto não encontrado.")
    const operatorId = await checkOperator(tx, input.operatorId, m.unitId)

    const [open] = await tx
      .select({ id: productionRun.id, productId: productionRun.productId, productCode: productionRun.productCode })
      .from(productionRun)
      .where(and(eq(productionRun.machineId, m.id), isNull(productionRun.endedAt), lte(productionRun.startedAt, now)))
      .orderBy(desc(productionRun.startedAt))
      .for("update")
      .limit(1)
    if (open?.productId === p.id) return { previousProductId: open.productId }

    await tx
      .update(productionRun)
      .set({ endedAt: now })
      .where(and(eq(productionRun.machineId, m.id), isNull(productionRun.endedAt), lte(productionRun.startedAt, now)))
    const [run] = await tx
      .insert(productionRun)
      .values({
        organizationId: input.organizationId,
        machineId: m.id,
        productId: p.id,
        productCode: p.code,
        startedAt: now,
        source: "operator",
        createdBy: actorUserId(input.actor),
        operatorId,
      })
      .returning({ id: productionRun.id })
    await tx.insert(auditLog).values({
      organizationId: input.organizationId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      actorLabel: input.actor.label ?? null,
      action: "production_run.operator_change",
      entityType: "production_run",
      entityId: run?.id ?? null,
      unitId: m.unitId,
      before: { product_code: open?.productCode ?? null },
      after: { product_code: p.code, machine_id: m.id, operator_id: operatorId },
      at: now,
    })
    await markShiftDirtyAt(tx, m.id, now, now)
    return { previousProductId: open?.productId ?? null }
  })
}
