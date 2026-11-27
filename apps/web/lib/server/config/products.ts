/**
 * Cadastro de produtos e ciclos ideais do cliente (W8; docs/07: o ciclo ideal por produto e máquina é a base
 * da performance). Só a equipe Engemase grava (`config.write`, D12); quem chama confere a permissão, e estas
 * funções conferem de novo (`assertPermission`).
 *
 * - tudo sob a RLS do cliente: produto ou máquina de outro cliente não existe aqui;
 * - código único entre os produtos não excluídos do cliente (índice do banco; o erro vira mensagem);
 * - excluir é lógico (`deleted_at`): o histórico de produção continua com o código, e o código fica livre;
 * - cada máquina sem ciclo do produto usa o ciclo padrão da máquina;
 * - tudo auditado.
 */
import { auditLog, machine, product, productMachine, withTenant } from "@engemase/db"
import { and, count, eq, inArray, isNull } from "drizzle-orm"
import { z } from "zod"
import { assertPermission, type TenantContext } from "@/lib/server/access/context"
import type { GatewayDb, GatewayTx } from "@/lib/server/gateway/types"
import { auditActor } from "@/lib/server/users/audit"

export type ConfigResult<T> = { readonly ok: true; readonly dados: T } | { readonly ok: false; readonly mensagem: string }

/** Ciclo ideal em segundos por peça (numeric(12,4) no banco). */
const Ciclo = z.number().positive("Ciclo ideal precisa ser maior que zero.").max(86_400, "Ciclo ideal acima de 24 h: confira a unidade (segundos).")
const Ciclos = z.record(z.uuid(), Ciclo).refine((v) => Object.keys(v).length <= 2000, "Máquinas demais.")

export const ProdutoInput = z.object({
  id: z.uuid().optional(),
  code: z.string().trim().min(1, "Informe o código do produto.").max(64, "Código muito longo."),
  name: z.string().trim().min(2, "Informe o nome (mínimo 2 caracteres).").max(120, "Nome muito longo."),
  cycles: Ciclos,
})

export const MatrizInput = z.object({
  products: z.record(z.uuid(), Ciclos).refine((v) => Object.keys(v).length <= 1000, "Produtos demais."),
})

const NAO_ENCONTRADO = { ok: false, mensagem: "Produto não encontrado. Atualize a página." } as const
const MAQUINA = { ok: false, mensagem: "Máquina não encontrada. Atualize a página." } as const

function entrada<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> | { ok: false; mensagem: string } {
  const parsed = schema.safeParse(input)
  return parsed.success ? parsed.data : { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Confira os dados." }
}
const invalida = (v: unknown): v is { ok: false; mensagem: string } => typeof v === "object" && v !== null && (v as { ok?: unknown }).ok === false

function duplicado(error: unknown): boolean {
  let current: unknown = error
  while (typeof current === "object" && current !== null) {
    if ((current as { code?: unknown }).code === "23505") return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** As máquinas existem neste cliente (RLS) e não foram excluídas? */
async function maquinasExistem(tx: GatewayTx, ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) return true
  const [row] = await tx.select({ n: count() }).from(machine).where(and(inArray(machine.id, [...ids]), isNull(machine.deletedAt)))
  return Number(row?.n ?? 0) === new Set(ids).size
}

/** Troca os ciclos do produto pelos informados (máquina sem ciclo usa o padrão da máquina). */
async function gravarCiclos(tx: GatewayTx, organizationId: string, productId: string, cycles: Record<string, number>): Promise<void> {
  await tx.delete(productMachine).where(eq(productMachine.productId, productId))
  const rows = Object.entries(cycles).map(([machineId, idealCycleS]) => ({ organizationId, productId, machineId, idealCycleS }))
  if (rows.length > 0) await tx.insert(productMachine).values(rows)
}

async function auditar(tx: GatewayTx, ctx: TenantContext, action: string, entityId: string, after: unknown): Promise<void> {
  await tx.insert(auditLog).values({ organizationId: ctx.organizationId, ...auditActor(ctx), action, entityType: "product", entityId, after })
}

/** Cadastra (sem `id`) ou altera um produto, com os ciclos por máquina. */
export async function salvarProduto(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  const v = entrada(ProdutoInput, input)
  if (invalida(v)) return v
  try {
    return await withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
      if (!(await maquinasExistem(tx, Object.keys(v.cycles)))) return MAQUINA
      let id = v.id
      if (id === undefined) {
        const [row] = await tx.insert(product).values({ organizationId: ctx.organizationId, code: v.code, name: v.name }).returning({ id: product.id })
        id = row?.id
      } else {
        const [row] = await tx
          .update(product)
          .set({ code: v.code, name: v.name, updatedAt: new Date() })
          .where(and(eq(product.id, id), isNull(product.deletedAt)))
          .returning({ id: product.id })
        if (row === undefined) return NAO_ENCONTRADO
      }
      if (id === undefined) throw new Error("produto não gravado")
      await gravarCiclos(tx, ctx.organizationId, id, v.cycles)
      await auditar(tx, ctx, v.id === undefined ? "product.created" : "product.updated", id, { code: v.code, name: v.name, cycles: v.cycles })
      return { ok: true, dados: { id } }
    })
  } catch (error) {
    if (duplicado(error)) return { ok: false, mensagem: `Já existe um produto com o código "${v.code}".` }
    throw error
  }
}

/** Salva a matriz de ciclos (produto × máquina) de uma vez: cada produto listado fica com os ciclos informados. */
export async function salvarMatrizCiclos(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ produtos: number }>> {
  assertPermission(ctx, "config.write")
  const v = entrada(MatrizInput, input)
  if (invalida(v)) return v
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ produtos: number }>> => {
    const ids = Object.keys(v.products)
    if (ids.length === 0) return { ok: true, dados: { produtos: 0 } }
    const found = await tx.select({ id: product.id }).from(product).where(and(inArray(product.id, ids), isNull(product.deletedAt)))
    if (found.length !== ids.length) return NAO_ENCONTRADO
    if (!(await maquinasExistem(tx, [...new Set(Object.values(v.products).flatMap((c) => Object.keys(c)))]))) return MAQUINA
    for (const [productId, cycles] of Object.entries(v.products)) await gravarCiclos(tx, ctx.organizationId, productId, cycles)
    for (const productId of ids) await auditar(tx, ctx, "product.cycles_updated", productId, { cycles: v.products[productId] })
    return { ok: true, dados: { produtos: ids.length } }
  })
}

/** Exclui o produto (lógico: o histórico de produção continua com o código). */
export async function excluirProduto(db: GatewayDb, ctx: TenantContext, id: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return NAO_ENCONTRADO
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
    const [row] = await tx
      .update(product)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(product.id, id), isNull(product.deletedAt)))
      .returning({ id: product.id, code: product.code })
    if (row === undefined) return NAO_ENCONTRADO
    await auditar(tx, ctx, "product.deleted", row.id, { code: row.code })
    return { ok: true, dados: { id: row.id } }
  })
}
