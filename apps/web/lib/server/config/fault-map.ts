/**
 * Mapa de códigos de falha do CLP (docs/05, F2): código do alarme → texto (como no CLP/IHM) e, se quiser,
 * motivo automático. Vale para uma máquina ou para todas as máquinas do cliente (o da máquina ganha).
 * A parada em falha que chega do gateway com um código mapeado já nasce classificada (`gateway/sync.ts`);
 * sem motivo, o operador vê o texto do alarme e escolhe.
 *
 * Cadastro pela equipe Engemase (`config.write`, D12), sob a RLS do cliente. Salvar troca o mapa inteiro
 * (o que a tela mostra) numa transação, com um registro na auditoria. Modelos de máquina (template) ainda
 * não têm tela: as linhas por modelo ficam como estão.
 */
import { FAULT_CODE_MAX, auditLog, downtimeReason, faultCodeMap, machine, withTenant } from "@engemase/db"
import { and, inArray, isNotNull, isNull } from "drizzle-orm"
import { z } from "zod"
import { assertPermission, type TenantContext } from "@/lib/server/access/context"
import type { GatewayDb, GatewayTx } from "@/lib/server/gateway/types"
import { auditActor } from "@/lib/server/users/audit"
import type { ConfigResult } from "./products"

export const MAX_FAULT_ROWS = 2000

const Linha = z.object({
  code: z
    .number({ error: "Código inválido." })
    .int("O código é um número inteiro.")
    .min(1, "Código a partir de 1.")
    .max(FAULT_CODE_MAX, "Código grande demais."),
  text: z.string().trim().min(3, "Descreva cada alarme (pelo menos 3 letras).").max(200, "Texto do alarme muito longo."),
  reasonId: z.uuid("Motivo inválido.").nullable(),
  /** `null` = todas as máquinas do cliente. */
  machineId: z.uuid("Máquina inválida.").nullable(),
})
const MapaInput = z.object({ rows: z.array(Linha).max(MAX_FAULT_ROWS, `No máximo ${MAX_FAULT_ROWS} códigos.`) })

export interface FaultMapEntry {
  readonly code: number
  readonly text: string
  readonly reasonId: string | null
  readonly machineId: string | null
}

/** Mapa do cliente (por máquina e geral), sem as linhas por modelo. */
export async function lerMapaFalhas(db: GatewayDb, ctx: TenantContext): Promise<FaultMapEntry[]> {
  assertPermission(ctx, "config.read")
  const rows = await withTenant(db, ctx.organizationId, (tx) =>
    tx
      .select({ code: faultCodeMap.faultCode, text: faultCodeMap.faultText, reasonId: faultCodeMap.reasonId, machineId: faultCodeMap.machineId })
      .from(faultCodeMap)
      .where(isNull(faultCodeMap.templateId)),
  )
  return rows
    .map((r) => ({ code: Number(r.code), text: r.text, reasonId: r.reasonId, machineId: r.machineId }))
    .sort((a, b) => a.code - b.code || (a.machineId ?? "").localeCompare(b.machineId ?? ""))
}

async function conferir(tx: GatewayTx, rows: readonly FaultMapEntry[]): Promise<string | null> {
  const seen = new Set<string>()
  for (const r of rows) {
    const k = `${r.code}:${r.machineId ?? "all"}`
    if (seen.has(k)) return `O código ${r.code} aparece duas vezes para as mesmas máquinas.`
    seen.add(k)
  }
  const reasonIds = [...new Set(rows.map((r) => r.reasonId).filter((id): id is string => id !== null))]
  if (reasonIds.length > 0) {
    // Motivo automático: motivo (não grupo) ativo e não excluído, do próprio cliente (RLS).
    const ok = await tx
      .select({ id: downtimeReason.id })
      .from(downtimeReason)
      .where(and(inArray(downtimeReason.id, reasonIds), isNotNull(downtimeReason.parentId), isNull(downtimeReason.deletedAt)))
    const valid = new Set(ok.map((x) => x.id))
    const bad = rows.find((r) => r.reasonId !== null && !valid.has(r.reasonId))
    if (bad) return `O motivo do código ${bad.code} não existe mais. Atualize a página e escolha de novo.`
  }
  const machineIds = [...new Set(rows.map((r) => r.machineId).filter((id): id is string => id !== null))]
  if (machineIds.length > 0) {
    const ok = await tx.select({ id: machine.id }).from(machine).where(and(inArray(machine.id, machineIds), isNull(machine.deletedAt)))
    const valid = new Set(ok.map((x) => x.id))
    const bad = rows.find((r) => r.machineId !== null && !valid.has(r.machineId))
    if (bad) return `A máquina do código ${bad.code} não foi encontrada. Atualize a página.`
  }
  return null
}

/** Troca o mapa do cliente pelo enviado (por máquina e geral). */
export async function salvarMapaFalhas(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ codigos: number; comMotivo: number }>> {
  assertPermission(ctx, "config.write")
  const parsed = MapaInput.safeParse(input)
  if (!parsed.success) return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Confira o mapa." }
  const rows = parsed.data.rows

  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ codigos: number; comMotivo: number }>> => {
    const erro = await conferir(tx, rows)
    if (erro !== null) return { ok: false, mensagem: erro }
    const before = await tx.select({ id: faultCodeMap.id }).from(faultCodeMap).where(isNull(faultCodeMap.templateId))
    await tx.delete(faultCodeMap).where(isNull(faultCodeMap.templateId))
    if (rows.length > 0) {
      await tx.insert(faultCodeMap).values(
        rows.map((r) => ({
          organizationId: ctx.organizationId,
          machineId: r.machineId,
          faultCode: r.code,
          faultText: r.text,
          reasonId: r.reasonId,
        })),
      )
    }
    const comMotivo = rows.filter((r) => r.reasonId !== null).length
    await tx.insert(auditLog).values({
      organizationId: ctx.organizationId,
      ...auditActor(ctx),
      action: "fault_code_map.updated",
      entityType: "fault_code_map",
      before: { codes: before.length },
      after: { codes: rows.length, with_reason: comMotivo, rows: rows.slice(0, 200) },
    })
    return { ok: true, dados: { codigos: rows.length, comMotivo } }
  })
}
