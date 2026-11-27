/**
 * Dados da tela "Produtos" (cadastro do cliente, W8). Com banco: máquinas, linhas e unidades do repositório do
 * cliente (`exigirCliente`, que confere sessão, cliente e `config.read`) e produtos, ciclos ideais e o produto
 * em produção agora lidos sob a RLS do cliente. Sem banco: os dados simulados.
 */
import { machineLive, product, productMachine, withTenant } from "@engemase/db"
import { asc, isNull } from "drizzle-orm"
import type { ProductMachine, ProductRow } from "@/components/config/products-manager"
import { getMachineLive, getProducts } from "@/lib/mock"
import { bancoObrigatorio } from "../admin/acesso"
import { exigirCliente } from "./cliente"

export async function dadosProdutos(slug: string) {
  const { r, client, ctx } = await exigirCliente(slug)
  const units = r.getUnits(client.id).map((u) => ({ id: u.id, name: u.name }))
  const lines = r.getLines(client.id)
  const rawMachines = r.getMachines(client.id)
  const machines: ProductMachine[] = rawMachines.map((m) => ({
    id: m.id,
    name: m.name,
    code: m.code,
    type: m.type,
    lineName: lines.find((l) => l.id === m.lineId)?.name ?? "—",
    unitId: m.unitId,
    unitName: units.find((u) => u.id === m.unitId)?.name ?? "—",
    defaultCycleS: m.idealCycleS,
  }))
  const canEdit = r.getConfigAccess(client.id).canConfigure

  if (ctx === null) {
    const runningCode = new Map(rawMachines.map((m) => [m.id, getMachineLive(m.id)?.productCode]))
    const products: ProductRow[] = getProducts(client.id).map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      cycles: Object.fromEntries(p.idealCycles.map((c) => [c.machineId, c.idealCycleS])),
      runningOn: rawMachines.filter((m) => runningCode.get(m.id) === p.code).map((m) => m.code),
    }))
    return { client, banco: false, canEdit, units, machines, products }
  }

  const { rows, cycles, live } = await withTenant(bancoObrigatorio(), ctx.organizationId, async (tx) => ({
    rows: await tx.select({ id: product.id, code: product.code, name: product.name }).from(product).where(isNull(product.deletedAt)).orderBy(asc(product.code)),
    cycles: await tx.select({ productId: productMachine.productId, machineId: productMachine.machineId, idealCycleS: productMachine.idealCycleS }).from(productMachine),
    live: await tx.select({ machineId: machineLive.machineId, productCode: machineLive.productCode }).from(machineLive),
  }))
  const visible = new Set(rawMachines.map((m) => m.id))
  const runningCode = new Map(live.map((l) => [l.machineId, l.productCode]))
  const products: ProductRow[] = rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    cycles: Object.fromEntries(cycles.filter((c) => c.productId === p.id && visible.has(c.machineId)).map((c) => [c.machineId, Number(c.idealCycleS)])),
    runningOn: rawMachines.filter((m) => runningCode.get(m.id) === p.code).map((m) => m.code),
  }))
  return { client, banco: true, canEdit, units, machines, products }
}
