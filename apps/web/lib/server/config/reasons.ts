/**
 * Cadastro dos motivos de parada do cliente (árvore de dois níveis: grupo › motivo). A categoria decide o
 * efeito no OEE (docs/07: não planejada, planejada, setup). Só a equipe Engemase grava (`config.write`, D12).
 *
 * - tudo sob a RLS do cliente: grupo ou motivo de outro cliente não existe aqui;
 * - os motivos herdam categoria e cor do grupo (mudar o grupo muda os motivos dele);
 * - nome único entre os irmãos (sem diferenciar maiúsculas);
 * - ativar/ocultar o grupo vale para os motivos dele; motivo oculto sai da tela do operador, o histórico fica;
 * - excluir motivo já usado em alguma parada só o oculta (o histórico e os relatórios continuam com ele);
 *   sem uso, a exclusão é lógica e tira o motivo do mapa de códigos de falha;
 * - motivos de sistema (`system_key`, ex.: "Sem comunicação", D21) não são ocultados nem excluídos;
 * - tudo auditado.
 */
import { REASON_CATEGORIES, auditLog, downtimeReason, faultCodeMap, machineStateEvent, withTenant } from "@engemase/db"
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm"
import { z } from "zod"
import { assertPermission, type TenantContext } from "@/lib/server/access/context"
import type { GatewayDb, GatewayTx } from "@/lib/server/gateway/types"
import { auditActor } from "@/lib/server/users/audit"
import type { ConfigResult } from "./products"

const Nome = z.string().trim().min(2, "Informe o nome (mínimo 2 caracteres).").max(80, "Nome muito longo.")
const Cor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Cor inválida.")

export const GrupoInput = z.object({ id: z.uuid().optional(), name: Nome, category: z.enum(REASON_CATEGORIES, "Categoria inválida."), color: Cor })
export const MotivoInput = z.object({ id: z.uuid().optional(), parentId: z.uuid("Grupo inválido."), name: Nome })
const AtivoInput = z.object({ id: z.uuid(), active: z.boolean() })
const CorInput = z.object({ id: z.uuid(), color: Cor })

const NAO_ENCONTRADO = { ok: false, mensagem: "Motivo não encontrado. Atualize a página." } as const
const SISTEMA = { ok: false, mensagem: "Este motivo é do sistema (ex.: Sem comunicação) e não pode ser ocultado nem excluído." } as const

function entrada<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> | { ok: false; mensagem: string } {
  const parsed = schema.safeParse(input)
  return parsed.success ? parsed.data : { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Confira os dados." }
}
const invalida = (v: unknown): v is { ok: false; mensagem: string } => typeof v === "object" && v !== null && (v as { ok?: unknown }).ok === false

interface Node {
  readonly id: string
  readonly parentId: string | null
  readonly name: string
  readonly category: string
  readonly systemKey: string | null
  readonly active: boolean
}

async function nodeOf(tx: GatewayTx, id: string): Promise<Node | null> {
  const [n] = await tx
    .select({ id: downtimeReason.id, parentId: downtimeReason.parentId, name: downtimeReason.name, category: downtimeReason.category, systemKey: downtimeReason.systemKey, active: downtimeReason.active })
    .from(downtimeReason)
    .where(and(eq(downtimeReason.id, id), isNull(downtimeReason.deletedAt)))
    .for("update")
    .limit(1)
  return n ?? null
}

/** Já existe outro irmão (mesmo pai) com esse nome? */
async function nomeRepetido(tx: GatewayTx, parentId: string | null, name: string, exceptId: string | undefined): Promise<boolean> {
  const rows = await tx
    .select({ id: downtimeReason.id })
    .from(downtimeReason)
    .where(
      and(
        isNull(downtimeReason.deletedAt),
        parentId === null ? isNull(downtimeReason.parentId) : eq(downtimeReason.parentId, parentId),
        sql`lower(${downtimeReason.name}) = lower(${name})`,
        exceptId === undefined ? undefined : ne(downtimeReason.id, exceptId),
      ),
    )
    .limit(1)
  return rows.length > 0
}

async function auditar(tx: GatewayTx, ctx: TenantContext, action: string, entityId: string, after: unknown): Promise<void> {
  await tx.insert(auditLog).values({ organizationId: ctx.organizationId, ...auditActor(ctx), action, entityType: "downtime_reason", entityId, after })
}

/** Cria (sem `id`) ou altera um grupo; categoria e cor descem para os motivos dele. */
export async function salvarGrupo(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  const v = entrada(GrupoInput, input)
  if (invalida(v)) return v
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
    if (await nomeRepetido(tx, null, v.name, v.id)) return { ok: false, mensagem: `Já existe um grupo "${v.name}".` }
    if (v.id === undefined) {
      const [row] = await tx
        .insert(downtimeReason)
        .values({ organizationId: ctx.organizationId, parentId: null, name: v.name, category: v.category, color: v.color })
        .returning({ id: downtimeReason.id })
      if (row === undefined) throw new Error("grupo não gravado")
      await auditar(tx, ctx, "downtime_reason.created", row.id, { name: v.name, category: v.category, color: v.color })
      return { ok: true, dados: { id: row.id } }
    }
    const node = await nodeOf(tx, v.id)
    if (node === null || node.parentId !== null) return NAO_ENCONTRADO
    const now = new Date()
    await tx.update(downtimeReason).set({ name: v.name, category: v.category, color: v.color, updatedAt: now }).where(eq(downtimeReason.id, v.id))
    await tx
      .update(downtimeReason)
      .set({ category: v.category, color: v.color, updatedAt: now })
      .where(and(eq(downtimeReason.parentId, v.id), isNull(downtimeReason.deletedAt)))
    await auditar(tx, ctx, "downtime_reason.updated", v.id, { before: { name: node.name, category: node.category }, name: v.name, category: v.category, color: v.color })
    return { ok: true, dados: { id: v.id } }
  })
}

/** Cria (sem `id`) um motivo dentro de um grupo, herdando categoria e cor, ou renomeia um motivo. */
export async function salvarMotivo(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  const v = entrada(MotivoInput, input)
  if (invalida(v)) return v
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
    const [group] = await tx
      .select({ id: downtimeReason.id, category: downtimeReason.category, color: downtimeReason.color, active: downtimeReason.active })
      .from(downtimeReason)
      .where(and(eq(downtimeReason.id, v.parentId), isNull(downtimeReason.parentId), isNull(downtimeReason.deletedAt)))
      .limit(1)
    if (group === undefined) return { ok: false, mensagem: "Grupo não encontrado. Atualize a página." }
    if (await nomeRepetido(tx, v.parentId, v.name, v.id)) return { ok: false, mensagem: `Já existe o motivo "${v.name}" neste grupo.` }
    if (v.id === undefined) {
      const [row] = await tx
        .insert(downtimeReason)
        .values({ organizationId: ctx.organizationId, parentId: v.parentId, name: v.name, category: group.category, color: group.color, active: group.active })
        .returning({ id: downtimeReason.id })
      if (row === undefined) throw new Error("motivo não gravado")
      await auditar(tx, ctx, "downtime_reason.created", row.id, { parent_id: v.parentId, name: v.name })
      return { ok: true, dados: { id: row.id } }
    }
    const node = await nodeOf(tx, v.id)
    if (node === null || node.parentId !== v.parentId) return NAO_ENCONTRADO
    await tx.update(downtimeReason).set({ name: v.name, updatedAt: new Date() }).where(eq(downtimeReason.id, v.id))
    await auditar(tx, ctx, "downtime_reason.renamed", v.id, { before: node.name, name: v.name })
    return { ok: true, dados: { id: v.id } }
  })
}

/** Ids do nó e, se for grupo, dos motivos dele (não excluídos). */
async function comFilhos(tx: GatewayTx, node: Node): Promise<{ ids: string[]; system: boolean }> {
  const kids =
    node.parentId === null
      ? await tx
          .select({ id: downtimeReason.id, systemKey: downtimeReason.systemKey })
          .from(downtimeReason)
          .where(and(eq(downtimeReason.parentId, node.id), isNull(downtimeReason.deletedAt)))
      : []
  return { ids: [node.id, ...kids.map((k) => k.id)], system: node.systemKey !== null || kids.some((k) => k.systemKey !== null) }
}

/** Mostra ou oculta o motivo (o grupo leva os motivos dele junto) na tela do operador. */
export async function definirAtivo(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  const v = entrada(AtivoInput, input)
  if (invalida(v)) return NAO_ENCONTRADO
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
    const node = await nodeOf(tx, v.id)
    if (node === null) return NAO_ENCONTRADO
    const { ids, system } = await comFilhos(tx, node)
    if (!v.active && system) return SISTEMA
    await tx.update(downtimeReason).set({ active: v.active, updatedAt: new Date() }).where(inArray(downtimeReason.id, ids))
    await auditar(tx, ctx, v.active ? "downtime_reason.shown" : "downtime_reason.hidden", v.id, { ids })
    return { ok: true, dados: { id: v.id } }
  })
}

/** Troca a cor do grupo (e dos motivos dele): Pareto e tela do operador. */
export async function definirCor(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  const v = entrada(CorInput, input)
  if (invalida(v)) return v
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
    const node = await nodeOf(tx, v.id)
    if (node === null || node.parentId !== null) return NAO_ENCONTRADO
    await tx
      .update(downtimeReason)
      .set({ color: v.color, updatedAt: new Date() })
      .where(and(or(eq(downtimeReason.id, v.id), eq(downtimeReason.parentId, v.id)), isNull(downtimeReason.deletedAt)))
    await auditar(tx, ctx, "downtime_reason.color", v.id, { color: v.color })
    return { ok: true, dados: { id: v.id } }
  })
}

/**
 * Exclui o motivo (o grupo leva os motivos dele). Já usado em alguma parada: só oculta, para manter o
 * histórico (`modo: "ocultado"`). Sem uso: exclusão lógica e saída do mapa de códigos de falha.
 */
export async function excluirMotivo(db: GatewayDb, ctx: TenantContext, id: unknown): Promise<ConfigResult<{ modo: "ocultado" | "excluido" }>> {
  assertPermission(ctx, "config.write")
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return NAO_ENCONTRADO
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ modo: "ocultado" | "excluido" }>> => {
    const node = await nodeOf(tx, id)
    if (node === null) return NAO_ENCONTRADO
    const { ids, system } = await comFilhos(tx, node)
    if (system) return SISTEMA
    const now = new Date()
    const used = await tx.select({ id: machineStateEvent.id }).from(machineStateEvent).where(inArray(machineStateEvent.reasonId, ids)).limit(1)
    if (used.length > 0) {
      await tx.update(downtimeReason).set({ active: false, updatedAt: now }).where(inArray(downtimeReason.id, ids))
      await auditar(tx, ctx, "downtime_reason.hidden", id, { ids, reason: "já usado em paradas" })
      return { ok: true, dados: { modo: "ocultado" } }
    }
    // Os códigos do mapa de falhas continuam (com o texto do alarme), só sem motivo automático.
    await tx.update(faultCodeMap).set({ reasonId: null, updatedAt: now }).where(inArray(faultCodeMap.reasonId, ids))
    await tx.update(downtimeReason).set({ deletedAt: now, active: false, updatedAt: now }).where(inArray(downtimeReason.id, ids))
    await auditar(tx, ctx, "downtime_reason.deleted", id, { ids })
    return { ok: true, dados: { modo: "excluido" } }
  })
}
