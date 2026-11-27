/**
 * Cadastro de turnos e paradas planejadas do cliente (tela "Turnos"; docs/07: definem o tempo planejado do
 * OEE). Só a equipe Engemase grava (`config.write`, D12).
 *
 * Turnos: as regras da L2 ficam em `lib/server/production/shifts.ts` (`saveShift`: sem sobreposição na
 * unidade, horário de turno já consolidado não muda, pausas dentro do turno). Aqui só a tradução da tela
 * (dias 0 = domingo → ISO 1..7) e a exclusão (lógica: os turnos já fechados continuam no histórico).
 *
 * Paradas planejadas (`planned_downtime`): data e hora locais da unidade → instantes UTC; da unidade inteira
 * ou de máquinas da unidade (uma linha por máquina, como o banco guarda); motivo planejado e ativo do
 * cliente. A repetição (RRULE) ainda não entra no cálculo, então aqui só se grava a ocorrência informada.
 * Mudar ou cancelar uma parada marca como "sujo" o turno consolidado que ela cruza, para o recálculo.
 *
 * Tudo sob a RLS do cliente e auditado.
 */
import { auditLog, downtimeReason, machine, plannedDowntime, shift, unit, withTenant } from "@engemase/db"
import { zonedDateTimeToInstant } from "@engemase/oee-core"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { assertPermission, type TenantContext } from "@/lib/server/access/context"
import type { GatewayDb, GatewayTx } from "@/lib/server/gateway/types"
import { type ProductionActor, ProductionRuleError } from "@/lib/server/production/errors"
import { saveShift } from "@/lib/server/production/shifts"
import { auditActor } from "@/lib/server/users/audit"
import type { ConfigResult } from "./products"

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM).")
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")

export const TurnoInput = z.object({
  unitId: z.uuid("Unidade inválida."),
  id: z.uuid().nullable().optional(),
  name: z.string(),
  start: z.string(),
  end: z.string(),
  /** 0 = domingo … 6 = sábado (como a tela). */
  days: z.array(z.number().int().min(0).max(6)),
  breaks: z.array(z.object({ name: z.string(), start: z.string(), end: z.string() })),
})

export const ParadaInput = z.object({
  unitId: z.uuid("Unidade inválida."),
  id: z.uuid().nullable().optional(),
  title: z.string().trim().min(3, "Descreva a parada (ex.: Manutenção preventiva mensal).").max(120, "Descrição muito longa."),
  reasonId: z.uuid("Escolha o motivo."),
  scope: z.union([z.literal("unit"), z.array(z.uuid()).min(1, "Escolha ao menos uma máquina.").max(200)]),
  startDate: DATA,
  startTime: HHMM,
  endDate: DATA,
  endTime: HHMM,
})

function entrada<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> | { ok: false; mensagem: string } {
  const parsed = schema.safeParse(input)
  return parsed.success ? parsed.data : { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Confira os dados." }
}
const invalida = (v: unknown): v is { ok: false; mensagem: string } => typeof v === "object" && v !== null && (v as { ok?: unknown }).ok === false

function actorOf(ctx: TenantContext): ProductionActor {
  const a = auditActor(ctx)
  return { type: a.actorType === "engemase" ? "engemase" : "user", id: a.actorId, label: a.actorLabel, clientRole: null }
}

async function auditar(tx: GatewayTx, ctx: TenantContext, action: string, entityType: string, entityId: string, unitId: string | null, after: unknown): Promise<void> {
  await tx.insert(auditLog).values({ organizationId: ctx.organizationId, ...auditActor(ctx), action, entityType, entityId, unitId, after })
}

/** Cria ou altera um turno (regras da L2 em `saveShift`). */
export async function salvarTurno(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  const v = entrada(TurnoInput, input)
  if (invalida(v)) return v
  try {
    const r = await saveShift(db, {
      organizationId: ctx.organizationId,
      unitId: v.unitId,
      ...(v.id ? { shiftId: v.id } : {}),
      shift: {
        name: v.name,
        startTime: v.start,
        endTime: v.end,
        // A tela usa 0 = domingo; o banco, ISO (1 = segunda … 7 = domingo).
        daysOfWeek: [...new Set(v.days.map((d) => (d === 0 ? 7 : d)))].sort(),
        breaks: v.breaks.map((b) => ({ start: b.start, end: b.end, ...(b.name.trim() ? { name: b.name.trim() } : {}) })),
      },
      actor: actorOf(ctx),
    })
    return { ok: true, dados: r }
  } catch (error) {
    if (error instanceof ProductionRuleError) return { ok: false, mensagem: error.message }
    throw error
  }
}

/** Exclui o turno (lógico): os turnos já fechados continuam no histórico; dali para a frente o horário deixa de ser planejado. */
export async function excluirTurno(db: GatewayDb, ctx: TenantContext, id: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return { ok: false, mensagem: "Turno não encontrado. Atualize a página." }
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
    const [row] = await tx
      .update(shift)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(shift.id, id), isNull(shift.deletedAt)))
      .returning({ id: shift.id, unitId: shift.unitId, name: shift.name })
    if (row === undefined) return { ok: false, mensagem: "Turno não encontrado. Atualize a página." }
    await auditar(tx, ctx, "shift.deleted", "shift", row.id, row.unitId, { name: row.name })
    return { ok: true, dados: { id: row.id } }
  })
}

/** Turnos consolidados das máquinas que cruzam [from, to) ficam "sujos" para o recálculo. */
async function sujarTurnos(tx: GatewayTx, machineIds: readonly string[], from: Date, to: Date): Promise<void> {
  if (machineIds.length === 0) return
  const now = new Date().toISOString()
  await tx.execute(sql`
    UPDATE oee_shift AS o SET dirty = true, dirty_since = CASE WHEN o.dirty THEN o.dirty_since ELSE ${now}::timestamptz END
    FROM shift AS s, unit AS u
    WHERE o.machine_id IN (${sql.join(
      machineIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      AND s.id = o.shift_id
      AND u.id = s.unit_id
      AND ((o.shift_date + s.start_time) AT TIME ZONE u.timezone) < ${to.toISOString()}::timestamptz
      AND ((o.shift_date + s.end_time
            + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0 days' END)
           AT TIME ZONE u.timezone) > ${from.toISOString()}::timestamptz`)
}

/** Máquinas afetadas por uma parada (a máquina dela ou todas da unidade). */
async function maquinasAfetadas(tx: GatewayTx, unitId: string, machineId: string | null): Promise<string[]> {
  if (machineId !== null) return [machineId]
  const rows = await tx.select({ id: machine.id }).from(machine).where(and(eq(machine.unitId, unitId), isNull(machine.deletedAt)))
  return rows.map((r) => r.id)
}

/**
 * Agenda (sem `id`) ou altera uma parada planejada. Com várias máquinas, grava uma parada por máquina;
 * alterar troca a parada pela nova versão (com as máquinas informadas). Devolve os ids gravados.
 */
export async function salvarParada(db: GatewayDb, ctx: TenantContext, input: unknown): Promise<ConfigResult<{ ids: string[] }>> {
  assertPermission(ctx, "config.write")
  const v = entrada(ParadaInput, input)
  if (invalida(v)) return v
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ ids: string[] }>> => {
    const [u] = await tx.select({ id: unit.id, timezone: unit.timezone }).from(unit).where(and(eq(unit.id, v.unitId), isNull(unit.deletedAt))).limit(1)
    if (u === undefined) return { ok: false, mensagem: "Unidade não encontrada. Atualize a página." }
    const startsAt = new Date(zonedDateTimeToInstant(v.startDate, v.startTime, u.timezone))
    const endsAt = new Date(zonedDateTimeToInstant(v.endDate, v.endTime, u.timezone))
    if (!(endsAt > startsAt)) return { ok: false, mensagem: "O fim da parada precisa ser depois do início." }
    if (endsAt.getTime() - startsAt.getTime() > 120 * 86_400_000) return { ok: false, mensagem: "Parada planejada de no máximo 120 dias." }

    const [reason] = await tx
      .select({ id: downtimeReason.id })
      .from(downtimeReason)
      .where(and(eq(downtimeReason.id, v.reasonId), eq(downtimeReason.category, "planned"), eq(downtimeReason.active, true), isNull(downtimeReason.deletedAt)))
      .limit(1)
    if (reason === undefined) return { ok: false, mensagem: "Motivo de parada planejada não encontrado ou desativado." }

    const machineIds = v.scope === "unit" ? [] : [...new Set(v.scope)]
    if (machineIds.length > 0) {
      const ok = await tx.select({ id: machine.id }).from(machine).where(and(inArray(machine.id, machineIds), eq(machine.unitId, u.id), isNull(machine.deletedAt)))
      if (ok.length !== machineIds.length) return { ok: false, mensagem: "Máquina não encontrada nesta unidade. Atualize a página." }
    }

    const now = new Date()
    if (v.id) {
      const [old] = await tx
        .update(plannedDowntime)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(plannedDowntime.id, v.id), eq(plannedDowntime.unitId, u.id), isNull(plannedDowntime.deletedAt)))
        .returning({ machineId: plannedDowntime.machineId, startsAt: plannedDowntime.startsAt, endsAt: plannedDowntime.endsAt })
      if (old === undefined) return { ok: false, mensagem: "Parada planejada não encontrada. Atualize a página." }
      await sujarTurnos(tx, await maquinasAfetadas(tx, u.id, old.machineId), old.startsAt, old.endsAt)
    }
    const rows = await tx
      .insert(plannedDowntime)
      .values(
        (machineIds.length === 0 ? [null] : machineIds).map((machineId) => ({
          organizationId: ctx.organizationId,
          unitId: u.id,
          machineId,
          reasonId: reason.id,
          name: v.title,
          startsAt,
          endsAt,
          createdBy: ctx.user.id,
        })),
      )
      .returning({ id: plannedDowntime.id })
    const ids = rows.map((r) => r.id)
    await sujarTurnos(tx, machineIds.length === 0 ? await maquinasAfetadas(tx, u.id, null) : machineIds, startsAt, endsAt)
    await auditar(tx, ctx, v.id ? "planned_downtime.updated" : "planned_downtime.created", "planned_downtime", ids[0] ?? u.id, u.id, {
      ids,
      replaced: v.id ?? null,
      name: v.title,
      reason_id: reason.id,
      machine_ids: machineIds,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    return { ok: true, dados: { ids } }
  })
}

/** Cancela uma parada planejada (lógico): o intervalo volta a contar como tempo planejado. */
export async function cancelarParada(db: GatewayDb, ctx: TenantContext, id: unknown): Promise<ConfigResult<{ id: string }>> {
  assertPermission(ctx, "config.write")
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return { ok: false, mensagem: "Parada planejada não encontrada. Atualize a página." }
  return withTenant(db, ctx.organizationId, async (tx): Promise<ConfigResult<{ id: string }>> => {
    const now = new Date()
    const [row] = await tx
      .update(plannedDowntime)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(plannedDowntime.id, id), isNull(plannedDowntime.deletedAt)))
      .returning({ id: plannedDowntime.id, unitId: plannedDowntime.unitId, machineId: plannedDowntime.machineId, startsAt: plannedDowntime.startsAt, endsAt: plannedDowntime.endsAt, name: plannedDowntime.name })
    if (row === undefined) return { ok: false, mensagem: "Parada planejada não encontrada. Atualize a página." }
    await sujarTurnos(tx, await maquinasAfetadas(tx, row.unitId, row.machineId), row.startsAt, row.endsAt)
    await auditar(tx, ctx, "planned_downtime.cancelled", "planned_downtime", row.id, row.unitId, { name: row.name })
    return { ok: true, dados: { id: row.id } }
  })
}
