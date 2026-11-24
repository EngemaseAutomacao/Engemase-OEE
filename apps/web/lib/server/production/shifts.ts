/**
 * Gravação de turnos (L2 do docs/17) com as regras que o banco não garante:
 *
 * - **Sem sobreposição na mesma unidade:** dois turnos da unidade não podem ter ocorrências que se cruzem,
 *   considerando dias da semana, vigência (`valid_from`/`valid_to`) e turno que atravessa a meia-noite
 *   (que pertence ao dia em que começa). A conferência é no horário local (como o cadastro é feito).
 * - **Mudança de turno vale dali para a frente:** turno que já tem turnos consolidados (`oee_shift`) não
 *   muda de horário, dias nem pausas; encerre a vigência dele (`valid_to`) e cadastre um novo a partir do
 *   dia seguinte. Nome e vigência podem mudar.
 * - Pausas dentro do turno e horários válidos (mesma validação do `@engemase/oee-core`).
 *
 * Toda gravação vai para a auditoria. Quem pode (config.write, só a Engemase, D12/D13) é conferido na rota.
 */
import { auditLog, oeeShift, shift, unit, withTenant } from "@engemase/db"
import { generateShiftWindows, isoWeekday, OeeInputError, type ShiftWindow } from "@engemase/oee-core"
import { and, eq, isNull, ne } from "drizzle-orm"
import { z } from "zod"
import type { GatewayDb } from "../gateway/types"
import { hhmm, type ShiftRow, toShiftDefinition } from "./calendar"
import { type ProductionActor, ProductionRuleError } from "./errors"

const ON_WEEKDAY = ["", "na segunda", "na terça", "na quarta", "na quinta", "na sexta", "no sábado", "no domingo"]
/** Segunda-feira de referência para turnos sem vigência (a regra se repete toda semana). */
const REFERENCE_MONDAY = "2026-01-05"

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** Sobreposição encontrada: o outro turno e a ocorrência do candidato que cruza com ele. */
export interface ShiftOverlap {
  readonly other: ShiftRow
  readonly shiftDate: string
  readonly message: string
}

/**
 * Primeira sobreposição entre `candidate` e os `others` da mesma unidade, ou `null`.
 * Função pura: gera as ocorrências em UTC "como se fosse o horário local" (sem horário de verão), nos 9
 * dias a partir do início da vigência em comum, o que cobre todos os dias da semana e a virada da noite.
 */
export function findShiftOverlap(candidate: ShiftRow, others: readonly ShiftRow[]): ShiftOverlap | null {
  for (const other of others) {
    const to = [candidate.validTo, other.validTo].filter((d): d is string => d !== null).sort()[0] ?? null
    const from =
      [candidate.validFrom, other.validFrom].filter((d): d is string => d !== null).sort().at(-1) ??
      (to !== null ? addDays(to, -8) : REFERENCE_MONDAY)
    if (to !== null && to < from) continue
    const range = { timeZone: "UTC", from: addDays(from, -1), to: addDays(from, 8) }
    const mine: ShiftWindow[] = generateShiftWindows({ ...range, shifts: [toShiftDefinition(candidate)] })
    const theirs: ShiftWindow[] = generateShiftWindows({ ...range, shifts: [toShiftDefinition(other)] })
    for (const a of mine) {
      const b = theirs.find((w) => a.start < w.end && w.start < a.end)
      if (b === undefined) continue
      return {
        other,
        shiftDate: a.shiftDate,
        message:
          `O turno "${candidate.name}" (${hhmm(candidate.startTime)}–${hhmm(candidate.endTime)}) se sobrepõe ao turno ` +
          `"${other.name}" (${hhmm(other.startTime)}–${hhmm(other.endTime)}) ${ON_WEEKDAY[isoWeekday(a.shiftDate)]}. ` +
          `Turnos da mesma unidade não podem se sobrepor.`,
      }
    }
  }
  return null
}

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, "Use o horário no formato HH:MM.")
const DATE = z.iso.date({ error: "Use a data no formato AAAA-MM-DD." })

export const ShiftInputSchema = z
  .object({
    name: z.string().trim().min(1, "Informe o nome do turno.").max(60, "Nome do turno com até 60 caracteres."),
    startTime: TIME,
    endTime: TIME,
    daysOfWeek: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Escolha pelo menos um dia da semana.")
      .max(7)
      .refine((d) => new Set(d).size === d.length, "Dia da semana repetido."),
    breaks: z
      .array(z.object({ start: TIME, end: TIME, name: z.string().trim().max(60).optional() }))
      .max(10, "No máximo 10 pausas por turno.")
      .default([]),
    validFrom: DATE.nullable().default(null),
    validTo: DATE.nullable().default(null),
  })
  .refine((s) => s.validFrom === null || s.validTo === null || s.validFrom <= s.validTo, {
    message: "O fim da vigência não pode ser antes do início.",
    path: ["validTo"],
  })
export type ShiftInput = z.input<typeof ShiftInputSchema>

export interface SaveShiftInput {
  readonly organizationId: string
  readonly unitId: string
  /** Turno existente (editar) ou ausente (criar). */
  readonly shiftId?: string
  readonly shift: ShiftInput
  readonly actor: ProductionActor
  readonly now?: Date
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados do turno inválidos."
}

/** Cria ou altera um turno da unidade com as regras da L2. Devolve o id. */
export async function saveShift(db: GatewayDb, input: SaveShiftInput): Promise<{ id: string }> {
  const parsed = ShiftInputSchema.safeParse(input.shift)
  if (!parsed.success) throw new ProductionRuleError("invalid_input", firstIssue(parsed.error))
  const data = parsed.data
  const now = input.now ?? new Date()
  const candidate: ShiftRow = {
    id: input.shiftId ?? "novo",
    name: data.name,
    startTime: hhmm(data.startTime),
    endTime: hhmm(data.endTime),
    daysOfWeek: [...data.daysOfWeek].sort(),
    breaks: data.breaks.map((b) => ({ start: hhmm(b.start), end: hhmm(b.end), ...(b.name ? { name: b.name } : {}) })),
    validFrom: data.validFrom,
    validTo: data.validTo,
  }
  // Pausas fora do turno e horários: a mesma validação do cálculo.
  try {
    generateShiftWindows({ shifts: [toShiftDefinition(candidate)], timeZone: "UTC", from: REFERENCE_MONDAY, to: REFERENCE_MONDAY })
  } catch (error) {
    if (error instanceof OeeInputError) throw new ProductionRuleError("invalid_input", error.message)
    throw error
  }

  return withTenant(db, input.organizationId, async (tx) => {
    // Trava a unidade: duas gravações ao mesmo tempo não criam turnos sobrepostos.
    const [u] = await tx.select({ id: unit.id }).from(unit).where(and(eq(unit.id, input.unitId), isNull(unit.deletedAt))).for("update")
    if (u === undefined) throw new ProductionRuleError("not_found", "Unidade não encontrada.")

    let before: (ShiftRow & { unitId: string }) | undefined
    if (input.shiftId !== undefined) {
      ;[before] = await tx
        .select({
          id: shift.id,
          unitId: shift.unitId,
          name: shift.name,
          startTime: shift.startTime,
          endTime: shift.endTime,
          daysOfWeek: shift.daysOfWeek,
          breaks: shift.breaks,
          validFrom: shift.validFrom,
          validTo: shift.validTo,
        })
        .from(shift)
        .where(and(eq(shift.id, input.shiftId), eq(shift.unitId, input.unitId), isNull(shift.deletedAt)))
        .for("update")
      if (before === undefined) throw new ProductionRuleError("not_found", "Turno não encontrado nesta unidade.")
      const timesChanged =
        hhmm(before.startTime) !== candidate.startTime ||
        hhmm(before.endTime) !== candidate.endTime ||
        [...before.daysOfWeek].sort().join() !== candidate.daysOfWeek.join() ||
        JSON.stringify((before.breaks ?? []).map((b) => [hhmm(b.start), hhmm(b.end)])) !==
          JSON.stringify((candidate.breaks ?? []).map((b) => [b.start, b.end]))
      if (timesChanged) {
        const [used] = await tx.select({ id: oeeShift.shiftId }).from(oeeShift).where(eq(oeeShift.shiftId, before.id)).limit(1)
        if (used !== undefined) {
          throw new ProductionRuleError(
            "shift_already_consolidated",
            `O turno "${before.name}" já tem turnos fechados e o horário não pode mudar para trás. ` +
              "Encerre a vigência dele e cadastre um turno novo valendo a partir do dia seguinte.",
          )
        }
      }
    }

    const others = await tx
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
      .where(
        and(
          eq(shift.unitId, input.unitId),
          isNull(shift.deletedAt),
          ...(input.shiftId !== undefined ? [ne(shift.id, input.shiftId)] : []),
        ),
      )
    const overlap = findShiftOverlap(candidate, others)
    if (overlap !== null) throw new ProductionRuleError("shift_overlap", overlap.message)

    const values = {
      name: candidate.name,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      daysOfWeek: [...candidate.daysOfWeek],
      breaks: [...(candidate.breaks ?? [])],
      validFrom: candidate.validFrom,
      validTo: candidate.validTo,
    }
    let id: string
    if (before === undefined) {
      const [row] = await tx
        .insert(shift)
        .values({ organizationId: input.organizationId, unitId: input.unitId, ...values })
        .returning({ id: shift.id })
      if (row === undefined) throw new Error("insert de shift sem retorno")
      id = row.id
    } else {
      await tx.update(shift).set({ ...values, updatedAt: now }).where(eq(shift.id, before.id))
      id = before.id
    }
    await tx.insert(auditLog).values({
      organizationId: input.organizationId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      actorLabel: input.actor.label ?? null,
      action: before === undefined ? "shift.created" : "shift.updated",
      entityType: "shift",
      entityId: id,
      unitId: input.unitId,
      before: before === undefined ? null : { ...before, unitId: undefined },
      after: values,
      at: now,
    })
    return { id }
  })
}
