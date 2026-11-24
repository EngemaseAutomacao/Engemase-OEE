/**
 * Lançamento manual de refugo e estorno (L3 do docs/17; docs/07, "Refugo lançado depois"), com as regras
 * que ficam na aplicação:
 *
 * - **Prazo do lançamento atrasado:** quem lança (operador, engenheiro, terminal) pode registrar refugo de
 *   um instante até o FIM DO TURNO SEGUINTE ao turno daquele instante (instante fora de turno: até o fim do
 *   primeiro turno que começa depois dele). Depois disso, só o supervisor (ou o admin do cliente). Sem
 *   nenhum turno cadastrado nos próximos dias, o prazo é de 24 h.
 * - **Estorno** com motivo, um por lançamento, sempre com registro na auditoria; segue o mesmo prazo do
 *   lançamento original.
 * - Motivo de refugo cadastrado e ativo; operador ativo da MESMA unidade da máquina (L19).
 * - O turno consolidado que cobre o instante fica sujo (`oee_shift.dirty`) para a tarefa `turnos` recalcular.
 *
 * Quem pode lançar (floor.act) e o escopo da máquina (D11) são conferidos na rota.
 */
import { auditLog, machine, qualityEntry, rejectReason, shift, unit, unitHoliday, unitOperator, withTenant } from "@engemase/db"
import { addDays, plantDateOf, type ShiftWindow } from "@engemase/oee-core"
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm"
import { z } from "zod"
import type { GatewayDb, GatewayTx } from "../gateway/types"
import { type ShiftRow, unitShiftWindows } from "./calendar"
import { type ProductionActor, ProductionRuleError } from "./errors"

/** Prazo sem nenhum turno cadastrado depois do instante. */
export const LATE_ENTRY_FALLBACK_MS = 24 * 3_600_000
/** Relógio do tablet adiantado: aceita lançamento até 2 min no futuro. */
export const FUTURE_TOLERANCE_MS = 2 * 60_000
/** Papéis que lançam depois do prazo (L3: "depois disso, só o supervisor"). */
export const LATE_ENTRY_ROLES: ReadonlySet<string> = new Set(["supervisor", "client_admin"])

/**
 * Prazo (ms UTC) para lançar refugo do instante `at`: fim do turno seguinte ao turno de `at`.
 * Função pura; `windows` são as janelas de turno da unidade (ordenadas), cobrindo `at` e os dias seguintes.
 */
export function lateEntryDeadline(at: number, windows: readonly ShiftWindow[]): number {
  const current = windows.find((w) => w.start <= at && at < w.end)
  const after = current?.end ?? at
  const next = windows.find((w) => w.start >= after && w !== current)
  if (next !== undefined) return next.end
  return (current?.end ?? at) + LATE_ENTRY_FALLBACK_MS
}

/** Janelas da unidade de 2 dias antes a 9 dias depois de `at` (cobre turno noturno e fim de semana). */
async function unitWindowsAround(tx: GatewayTx, unitId: string, at: Date): Promise<ShiftWindow[]> {
  const [u] = await tx.select({ timezone: unit.timezone }).from(unit).where(eq(unit.id, unitId))
  if (u === undefined) return []
  const day = plantDateOf(at.getTime(), u.timezone)
  const from = addDays(day, -2)
  const to = addDays(day, 9)
  const shifts: ShiftRow[] = await tx
    .select({
      id: shift.id,
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      daysOfWeek: shift.daysOfWeek,
      breaks: shift.breaks,
      validFrom: shift.validFrom,
      validTo: shift.validTo,
    })
    .from(shift)
    .where(and(eq(shift.unitId, unitId), isNull(shift.deletedAt)))
  const holidays = await tx
    .select({ day: unitHoliday.holidayDate })
    .from(unitHoliday)
    .where(and(eq(unitHoliday.unitId, unitId), isNull(unitHoliday.deletedAt), gte(unitHoliday.holidayDate, from), lte(unitHoliday.holidayDate, to)))
  return unitShiftWindows({ shifts, timeZone: u.timezone, from, to, holidays: new Set(holidays.map((h) => h.day)) })
}

function formatDeadline(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ms)
}

/** Confere o prazo do lançamento atrasado (L3). Devolve se o lançamento é atrasado (fora do prazo, por supervisor). */
async function checkDeadline(tx: GatewayTx, m: { unitId: string; timezone: string }, at: Date, now: Date, actor: ProductionActor): Promise<boolean> {
  const deadline = lateEntryDeadline(at.getTime(), await unitWindowsAround(tx, m.unitId, at))
  if (now.getTime() <= deadline) return false
  if (actor.clientRole !== null && LATE_ENTRY_ROLES.has(actor.clientRole)) return true
  throw new ProductionRuleError(
    "late_entry_deadline",
    `O prazo para lançar refugo desse horário terminou em ${formatDeadline(deadline, m.timezone)} (fim do turno seguinte). ` +
      "Peça a um supervisor para fazer o lançamento.",
  )
}

/** Marca como sujo o turno consolidado que cobre `at` na máquina (mesma regra do /sync). */
export async function markShiftDirtyAt(tx: GatewayTx, machineId: string, at: Date, now: Date): Promise<void> {
  const iso = at.toISOString()
  await tx.execute(sql`
    UPDATE oee_shift AS o SET dirty = true, dirty_since = CASE WHEN o.dirty THEN o.dirty_since ELSE ${now.toISOString()}::timestamptz END
    FROM shift AS s, unit AS u
    WHERE o.machine_id = ${machineId}
      AND s.id = o.shift_id
      AND u.id = s.unit_id
      AND o.shift_date BETWEEN (${iso}::timestamptz AT TIME ZONE 'UTC')::date - 2 AND (${iso}::timestamptz AT TIME ZONE 'UTC')::date + 1
      AND ((o.shift_date + s.start_time) AT TIME ZONE u.timezone) <= ${iso}::timestamptz
      AND ((o.shift_date + s.end_time
            + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0 days' END)
           AT TIME ZONE u.timezone) > ${iso}::timestamptz`)
}

async function loadMachine(tx: GatewayTx, machineId: string): Promise<{ id: string; unitId: string; timezone: string }> {
  const [m] = await tx
    .select({ id: machine.id, unitId: machine.unitId, timezone: unit.timezone })
    .from(machine)
    .innerJoin(unit, eq(unit.id, machine.unitId))
    .where(and(eq(machine.id, machineId), isNull(machine.deletedAt)))
  if (m === undefined) throw new ProductionRuleError("not_found", "Máquina não encontrada.")
  return m
}

const UUID = z.uuid({ error: "Identificador inválido." })

export const QualityEntryInputSchema = z.object({
  machineId: UUID,
  at: z.date({ error: "Informe a data e a hora do refugo." }),
  quantity: z
    .number({ error: "Informe a quantidade." })
    .int("A quantidade é um número inteiro de peças.")
    .min(1, "A quantidade precisa ser maior que zero.")
    .max(1_000_000, "Quantidade grande demais para um lançamento."),
  rejectReasonId: UUID.nullable().default(null),
  operatorId: UUID.nullable().default(null),
  productCode: z.string().trim().min(1).max(64).nullable().default(null),
  note: z.string().trim().max(500, "Observação com até 500 caracteres.").nullable().default(null),
})
export type QualityEntryInput = z.input<typeof QualityEntryInputSchema>

export interface RecordQualityEntryInput {
  readonly organizationId: string
  readonly entry: QualityEntryInput
  readonly actor: ProductionActor
  readonly now?: Date
}

function issue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados do lançamento inválidos."
}

/** Lança refugo manual (soma ao refugo do CLP). Devolve o id e se foi lançado fora do prazo (por supervisor). */
export async function recordQualityEntry(db: GatewayDb, input: RecordQualityEntryInput): Promise<{ id: string; late: boolean }> {
  const parsed = QualityEntryInputSchema.safeParse(input.entry)
  if (!parsed.success) throw new ProductionRuleError("invalid_input", issue(parsed.error))
  const e = parsed.data
  const now = input.now ?? new Date()
  if (Number.isNaN(e.at.getTime()) || e.at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new ProductionRuleError("invalid_input", "O horário do refugo não pode estar no futuro.")
  }

  return withTenant(db, input.organizationId, async (tx) => {
    const m = await loadMachine(tx, e.machineId)
    if (e.rejectReasonId !== null) {
      const [reason] = await tx
        .select({ id: rejectReason.id })
        .from(rejectReason)
        .where(and(eq(rejectReason.id, e.rejectReasonId), eq(rejectReason.active, true), isNull(rejectReason.deletedAt)))
      if (reason === undefined) throw new ProductionRuleError("not_found", "Motivo de refugo não encontrado ou desativado.")
    }
    if (e.operatorId !== null) {
      const [op] = await tx
        .select({ id: unitOperator.id })
        .from(unitOperator)
        .where(
          and(
            eq(unitOperator.id, e.operatorId),
            eq(unitOperator.unitId, m.unitId),
            eq(unitOperator.active, true),
            isNull(unitOperator.deletedAt),
          ),
        )
      if (op === undefined) throw new ProductionRuleError("not_found", "Operador não encontrado nesta unidade.")
    }
    const late = await checkDeadline(tx, m, e.at, now, input.actor)

    const [row] = await tx
      .insert(qualityEntry)
      .values({
        organizationId: input.organizationId,
        machineId: m.id,
        at: e.at,
        quantity: e.quantity,
        productCode: e.productCode,
        reason: e.note,
        rejectReasonId: e.rejectReasonId,
        operatorId: e.operatorId,
        createdBy: input.actor.type === "user" || input.actor.type === "engemase" ? input.actor.id : null,
        createdAt: now,
      })
      .returning({ id: qualityEntry.id })
    if (row === undefined) throw new Error("insert de quality_entry sem retorno")
    await tx.insert(auditLog).values({
      organizationId: input.organizationId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      actorLabel: input.actor.label ?? null,
      action: "quality_entry.created",
      entityType: "quality_entry",
      entityId: row.id,
      unitId: m.unitId,
      after: { machine_id: m.id, at: e.at.toISOString(), quantity: e.quantity, reject_reason_id: e.rejectReasonId, operator_id: e.operatorId, late },
      at: now,
    })
    await markShiftDirtyAt(tx, m.id, e.at, now)
    return { id: row.id, late }
  })
}

export interface ReverseQualityEntryInput {
  readonly organizationId: string
  readonly entryId: string
  readonly reason: string
  readonly actor: ProductionActor
  readonly now?: Date
}

/** Estorna um lançamento (quantidade oposta, motivo obrigatório, auditoria). Devolve o id do estorno. */
export async function reverseQualityEntry(db: GatewayDb, input: ReverseQualityEntryInput): Promise<{ id: string; late: boolean }> {
  if (!UUID.safeParse(input.entryId).success) throw new ProductionRuleError("not_found", "Lançamento não encontrado.")
  const reason = input.reason.trim()
  if (reason === "" || reason.length > 500) {
    throw new ProductionRuleError("invalid_input", "Informe o motivo do estorno (até 500 caracteres).")
  }
  const now = input.now ?? new Date()

  return withTenant(db, input.organizationId, async (tx) => {
    // Sem FOR UPDATE (o app_user só tem SELECT/INSERT em quality_entry): dois estornos ao mesmo tempo
    // esbarram no índice único `quality_entry_one_reversal_uq`.
    const [original] = await tx.select().from(qualityEntry).where(eq(qualityEntry.id, input.entryId))
    if (original === undefined) throw new ProductionRuleError("not_found", "Lançamento não encontrado.")
    if (original.reversesId !== null) throw new ProductionRuleError("already_reversed", "Um estorno não pode ser estornado.")
    const [existing] = await tx.select({ id: qualityEntry.id }).from(qualityEntry).where(eq(qualityEntry.reversesId, original.id))
    if (existing !== undefined) throw new ProductionRuleError("already_reversed", "Este lançamento já foi estornado.")
    const m = await loadMachine(tx, original.machineId)
    const late = await checkDeadline(tx, m, original.at, now, input.actor)

    const [row] = await tx
      .insert(qualityEntry)
      .values({
        organizationId: input.organizationId,
        machineId: original.machineId,
        at: original.at,
        quantity: -original.quantity,
        productCode: original.productCode,
        rejectReasonId: original.rejectReasonId,
        reversesId: original.id,
        reversalReason: reason,
        createdBy: input.actor.type === "user" || input.actor.type === "engemase" ? input.actor.id : null,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: qualityEntry.id })
    if (row === undefined) throw new ProductionRuleError("already_reversed", "Este lançamento já foi estornado.")
    await tx.insert(auditLog).values({
      organizationId: input.organizationId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      actorLabel: input.actor.label ?? null,
      action: "quality_entry.reversed",
      entityType: "quality_entry",
      entityId: original.id,
      unitId: m.unitId,
      before: { quantity: original.quantity, at: original.at.toISOString() },
      after: { reversal_id: row.id, quantity: -original.quantity, reason, late },
      at: now,
    })
    await markShiftDirtyAt(tx, original.machineId, original.at, now)
    return { id: row.id, late }
  })
}
