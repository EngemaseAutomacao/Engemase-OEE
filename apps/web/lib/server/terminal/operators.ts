/**
 * Operadores do chão por unidade (D18, L19): pessoas sem conta de login, escolhidas numa lista no tablet
 * pareado. Cadastro pela equipe Engemase (`config.write`); nome e matrícula opcional (única na unidade).
 * Desativar tira da lista do tablet e mantém os apontamentos antigos com o nome.
 *
 * Tudo sob a RLS do cliente e auditado.
 */
import { auditLog, unit, unitOperator, withTenant } from "@engemase/db"
import { and, asc, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { assertPermission, type TenantContext } from "@/lib/server/access/context"
import type { ConfigResult } from "@/lib/server/config/products"
import type { GatewayDb, GatewayTx } from "@/lib/server/gateway/types"
import { auditActor } from "@/lib/server/users/audit"

export interface UnitOperatorRow {
  readonly id: string
  readonly unitId: string
  readonly name: string
  readonly employeeCode: string | null
  readonly active: boolean
}

export const OperadorInput = z.object({
  id: z.uuid().optional(),
  unitId: z.uuid("Unidade inválida."),
  name: z.string().trim().min(2, "Informe o nome do operador.").max(80, "Nome muito longo."),
  employeeCode: z
    .string()
    .trim()
    .max(30, "Matrícula muito longa.")
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v)),
})

const AtivoInput = z.object({ id: z.uuid(), active: z.boolean() })
const NAO_ENCONTRADO = { ok: false, mensagem: "Operador não encontrado. Atualize a página." } as const

function entrada<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> | { ok: false; mensagem: string } {
  const parsed = schema.safeParse(input)
  return parsed.success ? parsed.data : { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Confira os dados." }
}
const invalida = (v: unknown): v is { ok: false; mensagem: string } => typeof v === "object" && v !== null && (v as { ok?: unknown }).ok === false

async function auditar(tx: GatewayTx, ctx: TenantContext, action: string, entityId: string, unitId: string, after: unknown): Promise<void> {
  await tx.insert(auditLog).values({ organizationId: ctx.organizationId, ...auditActor(ctx), action, entityType: "unit_operator", entityId, unitId, after })
}

function duplicado(error: unknown): boolean {
  let current: unknown = error
  while (typeof current === "object" && current !== null) {
    if ((current as { code?: unknown }).code === "23505") return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** Todos os operadores do cliente (cadastro), ativos e desativados. */
export async function listarOperadores(db: GatewayDb, ctx: TenantContext): Promise<UnitOperatorRow[]> {
  assertPermission(ctx, "config.read")
  return withTenant(db, ctx.organizationId, (tx) =>
    tx
      .select({ id: unitOperator.id, unitId: unitOperator.unitId, name: unitOperator.name, employeeCode: unitOperator.employeeCode, active: unitOperator.active })
      .from(unitOperator)
      .where(isNull(unitOperator.deletedAt))
      .orderBy(asc(unitOperator.name)),
  )
}

/** Operadores ATIVOS de uma unidade (lista do tablet). */
export async function operadoresDaUnidade(db: GatewayDb, ctx: TenantContext, unitId: string): Promise<UnitOperatorRow[]> {
  assertPermission(ctx, "data.read")
  if (!z.uuid().safeParse(unitId).success) return []
  return withTenant(db, ctx.organizationId, (tx) =>
    tx
      .select({ id: unitOperator.id, unitId: unitOperator.unitId, name: unitOperator.name, employeeCode: unitOperator.employeeCode, active: unitOperator.active })
      .from(unitOperator)
      .where(and(eq(unitOperator.unitId, unitId), eq(unitOperator.active, true), isNull(unitOperator.deletedAt)))
      .orderBy(asc(unitOperator.name)),
  )
}

/** Cadastra (sem `id`) ou altera um operador. A unidade não muda (cadastre outro na unidade nova). */
export async function salvarOperador(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  const v = entrada(OperadorInput, input)
  if (invalida(v)) return v
  try {
    return await withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
      const [u] = await tx.select({ id: unit.id }).from(unit).where(and(eq(unit.id, v.unitId), isNull(unit.deletedAt))).limit(1)
      if (u === undefined) return { ok: false, mensagem: "Unidade não encontrada. Atualize a página." }
      if (v.id === undefined) {
        const [row] = await tx
          .insert(unitOperator)
          .values({ organizationId: ctx.organizationId, unitId: u.id, name: v.name, employeeCode: v.employeeCode })
          .returning({ id: unitOperator.id })
        if (row === undefined) throw new Error("operador não gravado")
        await auditar(tx, ctx, "unit_operator.created", row.id, u.id, { name: v.name, employee_code: v.employeeCode })
        return { ok: true, dados: { id: row.id } }
      }
      const [row] = await tx
        .update(unitOperator)
        .set({ name: v.name, employeeCode: v.employeeCode, updatedAt: new Date() })
        .where(and(eq(unitOperator.id, v.id), eq(unitOperator.unitId, u.id), isNull(unitOperator.deletedAt)))
        .returning({ id: unitOperator.id })
      if (row === undefined) return NAO_ENCONTRADO
      await auditar(tx, ctx, "unit_operator.updated", row.id, u.id, { name: v.name, employee_code: v.employeeCode })
      return { ok: true, dados: { id: row.id } }
    })
  } catch (error) {
    if (duplicado(error)) return { ok: false, mensagem: `Já existe um operador com a matrícula "${v.employeeCode}" nesta unidade.` }
    throw error
  }
}

/** Ativa ou desativa (sai da lista do tablet; os apontamentos antigos continuam com o nome). */
export async function definirOperadorAtivo(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  const v = entrada(AtivoInput, input)
  if (invalida(v)) return NAO_ENCONTRADO
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
    const [row] = await tx
      .update(unitOperator)
      .set({ active: v.active, updatedAt: new Date() })
      .where(and(eq(unitOperator.id, v.id), isNull(unitOperator.deletedAt)))
      .returning({ id: unitOperator.id, unitId: unitOperator.unitId })
    if (row === undefined) return NAO_ENCONTRADO
    await auditar(tx, ctx, v.active ? "unit_operator.enabled" : "unit_operator.disabled", row.id, row.unitId, {})
    return { ok: true, dados: { id: row.id } }
  })
}
