import { notFound } from "next/navigation"

import { faultTexts, getClientBySlug, getDowntimeReasons, getMachines, getPareto } from "@/lib/mock"
import { REASON_PALETTE } from "@/components/config/labels"
import type { FaultMapRow } from "@/components/config/fault-map"
import type { ReasonNode } from "@/components/config/reason-dialogs"
import { ReasonsManager } from "@/components/config/reasons-manager"

/** Motivo sugerido para cada alarme simulado (pelo nome do motivo; os códigos sem sugestão perguntam ao operador). */
const FAULT_SUGGESTION: Record<number, string> = {
  27: "Ajuste de parâmetros",
  31: "Vazamento hidráulico",
  47: "Falta de material",
  58: "Sobrecarga de motor",
}

export default async function Page({ params }: PageProps<"/[cliente]/config/motivos">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const machines = getMachines(client.id)
  const raw = getDowntimeReasons(client.id)
  const pareto = new Map(getPareto(machines.map((m) => m.id)).map((p) => [p.reasonId, p]))

  // Cores dos grupos: paleta na ordem; planejadas em cinza-azulado (não competem com perdas).
  const groupColor = new Map(
    raw
      .filter((r) => !r.parentId)
      .map((g, i) => [g.id, g.category === "planned" ? REASON_PALETTE[REASON_PALETTE.length - 1] : REASON_PALETTE[i % (REASON_PALETTE.length - 1)]]),
  )

  const reasons: ReasonNode[] = raw.map((r) => {
    const p = pareto.get(r.id)
    return {
      id: r.id,
      parentId: r.parentId,
      name: r.name,
      category: r.category,
      color: groupColor.get(r.parentId ?? r.id) ?? REASON_PALETTE[0],
      active: true,
      minutes: p?.minutes ?? 0,
      occurrences: p?.occurrences ?? 0,
    }
  })

  const faultMap: FaultMapRow[] = Object.entries(faultTexts)
    .map(([code, text]) => {
      const suggestion = FAULT_SUGGESTION[Number(code)]
      const reason = suggestion ? raw.find((r) => r.parentId && r.name === suggestion) : undefined
      return { code: Number(code), text, reasonId: reason?.id ?? null, machineType: "all" }
    })
    .sort((a, b) => a.code - b.code)

  const machineTypes = [...new Set(machines.map((m) => m.type))]

  return <ReasonsManager initialReasons={reasons} initialFaultMap={faultMap} machineTypes={machineTypes} />
}
