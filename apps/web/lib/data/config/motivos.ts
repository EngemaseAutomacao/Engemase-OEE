/**
 * Dados da tela "Motivos de parada" (cadastro do cliente, W8). Com banco: a árvore real (grupos e motivos,
 * com categoria, cor e se aparece para o operador) e o uso de cada motivo nos últimos 7 dias, lidos sob a
 * RLS do cliente; `exigirCliente` confere sessão, cliente e `config.read`. Sem banco: os dados simulados.
 */
import { downtimeReason, machineStateEvent, withTenant } from "@engemase/db"
import { and, asc, gt, isNotNull, isNull, sql } from "drizzle-orm"
import type { FaultMapRow } from "@/components/config/fault-map"
import { REASON_PALETTE } from "@/components/config/labels"
import type { ReasonNode } from "@/components/config/reason-dialogs"
import { faultTexts, getDowntimeReasons, getPareto } from "@/lib/mock"
import { bancoObrigatorio } from "../admin/acesso"
import { exigirCliente } from "./cliente"

const DAY = 86_400_000

/** Motivo sugerido para cada alarme simulado (pelo nome do motivo; os códigos sem sugestão perguntam ao operador). */
const FAULT_SUGGESTION: Record<number, string> = {
  27: "Ajuste de parâmetros",
  31: "Vazamento hidráulico",
  47: "Falta de material",
  58: "Sobrecarga de motor",
}

/** Cor padrão do grupo: paleta na ordem; planejadas em cinza-azulado (não competem com perdas). */
function corPadrao(category: string, index: number): string {
  return category === "planned" ? REASON_PALETTE[REASON_PALETTE.length - 1]! : REASON_PALETTE[index % (REASON_PALETTE.length - 1)]!
}

export async function dadosMotivos(slug: string) {
  const { r, client, ctx } = await exigirCliente(slug)
  const machines = r.getMachines(client.id)
  const machineTypes = [...new Set(machines.map((m) => m.type))]
  const canEdit = r.getConfigAccess(client.id).canConfigure

  if (ctx === null) {
    const raw = getDowntimeReasons(client.id)
    const pareto = new Map(getPareto(machines.map((m) => m.id)).map((p) => [p.reasonId, p]))
    const groupColor = new Map(raw.filter((x) => !x.parentId).map((g, i) => [g.id, corPadrao(g.category, i)]))
    const reasons: ReasonNode[] = raw.map((x) => {
      const p = pareto.get(x.id)
      return {
        id: x.id,
        parentId: x.parentId,
        name: x.name,
        category: x.category,
        color: groupColor.get(x.parentId ?? x.id) ?? REASON_PALETTE[0]!,
        active: true,
        minutes: p?.minutes ?? 0,
        occurrences: p?.occurrences ?? 0,
      }
    })
    const faultMap: FaultMapRow[] = Object.entries(faultTexts)
      .map(([code, text]) => {
        const suggestion = FAULT_SUGGESTION[Number(code)]
        const reason = suggestion ? raw.find((x) => x.parentId && x.name === suggestion) : undefined
        return { code: Number(code), text, reasonId: reason?.id ?? null, machineType: "all" }
      })
      .sort((a, b) => a.code - b.code)
    return { client, banco: false, canEdit, reasons, faultMap, machineTypes }
  }

  const since = new Date(Date.now() - 7 * DAY)
  const { rows, usage } = await withTenant(bancoObrigatorio(), ctx.organizationId, async (tx) => ({
    rows: await tx
      .select({
        id: downtimeReason.id,
        parentId: downtimeReason.parentId,
        name: downtimeReason.name,
        category: downtimeReason.category,
        color: downtimeReason.color,
        active: downtimeReason.active,
      })
      .from(downtimeReason)
      .where(isNull(downtimeReason.deletedAt))
      .orderBy(asc(downtimeReason.sortOrder), asc(downtimeReason.name)),
    usage: await tx
      .select({
        reasonId: machineStateEvent.reasonId,
        occurrences: sql<number>`count(*)::int`,
        minutes: sql<number>`coalesce(sum(extract(epoch from (coalesce(${machineStateEvent.endedAt}, now()) - ${machineStateEvent.startedAt}))) / 60, 0)::float8`,
      })
      .from(machineStateEvent)
      .where(and(isNotNull(machineStateEvent.reasonId), gt(machineStateEvent.startedAt, since)))
      .groupBy(machineStateEvent.reasonId),
  }))
  const used = new Map(usage.map((u) => [u.reasonId, u]))
  const groups = rows.filter((x) => x.parentId === null)
  const groupColor = new Map(groups.map((g, i) => [g.id, g.color ?? corPadrao(g.category, i)]))
  const reasons: ReasonNode[] = rows.map((x) => ({
    id: x.id,
    parentId: x.parentId,
    name: x.name,
    category: x.category,
    color: groupColor.get(x.parentId ?? x.id) ?? x.color ?? REASON_PALETTE[0]!,
    active: x.active,
    minutes: Math.round(Number(used.get(x.id)?.minutes ?? 0)),
    occurrences: Number(used.get(x.id)?.occurrences ?? 0),
  }))
  // O mapa de códigos de falha do sistema real (por máquina ou modelo, F2) ainda não tem tela.
  return { client, banco: true, canEdit, reasons, faultMap: [] as FaultMapRow[], machineTypes }
}
