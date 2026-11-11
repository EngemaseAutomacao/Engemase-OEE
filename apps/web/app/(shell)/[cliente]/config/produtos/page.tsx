import { notFound } from "next/navigation"

import { getClientBySlug, getLines, getMachineLive, getMachines, getProducts, getUnits } from "@/lib/mock"
import { ProductsManager, type ProductMachine, type ProductRow } from "@/components/config/products-manager"

export default async function Page({ params }: PageProps<"/[cliente]/config/produtos">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const units = getUnits(client.id).map((u) => ({ id: u.id, name: u.name }))
  const lines = getLines(client.id)
  const rawMachines = getMachines(client.id)

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

  // Produto em produção agora em cada máquina (dado ao vivo do protótipo).
  const runningCode = new Map(rawMachines.map((m) => [m.id, getMachineLive(m.id)?.productCode]))

  const products: ProductRow[] = getProducts(client.id).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    cycles: Object.fromEntries(p.idealCycles.map((c) => [c.machineId, c.idealCycleS])),
    runningOn: rawMachines.filter((m) => runningCode.get(m.id) === p.code).map((m) => m.code),
  }))

  return <ProductsManager initialProducts={products} machines={machines} units={units} />
}
