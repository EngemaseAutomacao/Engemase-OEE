/**
 * Fechamento de turno e recálculo dos turnos sujos (W7; docs/07, "Algoritmo" e "Dados atrasados";
 * docs/06, `oee_shift`). Roda dentro de `withTenant` (um cliente por vez, sob RLS), chamado pela tarefa
 * agendada `turnos` (lib/server/cron/shifts.ts).
 *
 * 1. **Fechamento:** cada turno que terminou (há mais de `SHIFT_CLOSE_GRACE_MS`, folga para os últimos
 *    minutos chegarem) nos últimos `SHIFT_CLOSE_LOOKBACK_DAYS` dias ganha uma linha em `oee_shift` por
 *    máquina ativa da unidade, calculada pelo `@engemase/oee-core` (`calculateMachineOee`), com
 *    `dirty = false`. Feriado da unidade não tem turno (L2). Máquina cadastrada depois do fim do turno
 *    fica de fora (não inventa turnos sem dado). Idempotente: turno já fechado não é refeito.
 * 2. **Recálculo:** linhas com `dirty = true` (dado atrasado do /sync, refugo lançado depois,
 *    reclassificação) são recalculadas com o horário do próprio turno (mudança de turno vale dali para a
 *    frente, L2). A linha é travada (`FOR UPDATE SKIP LOCKED`) durante o cálculo; o /sync, que marca
 *    `dirty` com UPDATE, espera ou é pulado, e o turno volta a ficar sujo se chegar dado depois.
 *
 * Entradas do cálculo: eventos de estado (com o motivo e a categoria), minutos, lançamentos de
 * qualidade, paradas planejadas da unidade/linha/máquina, ciclo ideal por produto (`product_machine`) e
 * o padrão da máquina, limite de micro-parada da máquina. Paradas planejadas recorrentes (`recurrence`)
 * entram só pela ocorrência cadastrada (a expansão da RRULE ainda não existe).
 */
import {
  downtimeReason,
  machine,
  machineStateEvent,
  oeeShift,
  plannedDowntime,
  product,
  productionMinute,
  productionRun,
  productMachine,
  qualityEntry,
  shift,
  unit,
  unitHoliday,
} from "@engemase/db"
import { addDays, calculateMachineOee, type Interval, plantDateOf, type ShiftWindow } from "@engemase/oee-core"
import { and, asc, eq, gt, gte, isNull, lt, or, sql } from "drizzle-orm"
import { type GatewayTx, queryRows } from "../gateway/types"
import { type ShiftRow, shiftWindowOn, unitShiftWindows } from "./calendar"
import { fillMinuteProducts } from "./runs"

/** Quantos dias para trás o fechamento procura turnos sem linha (cobre uma semana sem a tarefa). */
export const SHIFT_CLOSE_LOOKBACK_DAYS = 7
/** Folga depois do fim do turno antes de fechar (os últimos minutos chegam no /sync seguinte). */
export const SHIFT_CLOSE_GRACE_MS = 5 * 60_000
/** Cálculos (máquina × turno) por cliente em cada execução; o resto fica para a próxima. */
export const MAX_SHIFT_CALCULATIONS = 300

export interface ShiftRunOptions {
  /** Cliente da transação (o mesmo do `withTenant`). */
  readonly organizationId: string
  readonly now: Date
  readonly maxCalculations?: number
  /** Para quando devolver `false` (tempo da função acabando). */
  readonly hasTime?: () => boolean
  readonly log?: (message: string, error?: unknown) => void
}

export interface ShiftRunStats {
  /** Turnos fechados agora (linhas novas em `oee_shift`). */
  readonly closed: number
  /** Turnos sujos recalculados. */
  readonly recomputed: number
  /** Cálculos que ficaram para a próxima execução (limite ou tempo). */
  readonly pending: number
  /** Cálculos que falharam (cadastro incoerente, fuso inválido...); ficam no log. */
  readonly errors: number
}

interface MachineInfo {
  readonly id: string
  readonly unitId: string
  readonly lineId: string
  readonly idealCycleS: number | null
  readonly microStopThresholdS: number
  readonly createdAt: Date
}

interface ShiftCalculation {
  readonly machine: MachineInfo
  readonly window: ShiftWindow
}

/** Valores gravados em `oee_shift` (mesmos nomes do Drizzle). */
export interface OeeShiftValues {
  readonly plannedS: number
  readonly runS: number
  readonly downtimeS: number
  readonly total: number
  readonly good: number
  readonly reject: number
  readonly idealTimeS: number | null
  readonly availability: number | null
  readonly performance: number | null
  readonly quality: number | null
  readonly oee: number | null
}

const SHIFT_COLUMNS = {
  id: shift.id,
  unitId: shift.unitId,
  name: shift.name,
  startTime: shift.startTime,
  endTime: shift.endTime,
  daysOfWeek: shift.daysOfWeek,
  breaks: shift.breaks,
  validFrom: shift.validFrom,
  validTo: shift.validTo,
}

const MACHINE_COLUMNS = {
  id: machine.id,
  unitId: machine.unitId,
  lineId: machine.lineId,
  idealCycleS: machine.idealCycleS,
  microStopThresholdS: machine.microStopThresholdS,
  createdAt: machine.createdAt,
}

const ms = (d: Date): number => d.getTime()

/** Ciclo ideal por produto da máquina (cache por execução). */
async function idealCycles(tx: GatewayTx, m: MachineInfo, cache: Map<string, Record<string, number>>): Promise<Record<string, number>> {
  const cached = cache.get(m.id)
  if (cached !== undefined) return cached
  const rows = await tx
    .select({ code: product.code, cycle: productMachine.idealCycleS })
    .from(productMachine)
    .innerJoin(product, eq(product.id, productMachine.productId))
    .where(and(eq(productMachine.machineId, m.id), isNull(product.deletedAt)))
  const byProduct = Object.fromEntries(rows.map((r) => [r.code, Number(r.cycle)]))
  cache.set(m.id, byProduct)
  return byProduct
}

/** Lê os dados da máquina na janela do turno e calcula (docs/07, "Algoritmo"). */
export async function calculateShift(
  tx: GatewayTx,
  calc: ShiftCalculation,
  cycleCache: Map<string, Record<string, number>> = new Map(),
): Promise<OeeShiftValues> {
  const { machine: m, window } = calc
  const start = new Date(window.start)
  const end = new Date(window.end)
  // Folga do limite de micro-parada: a duração da parada inteira decide se é micro-parada.
  const margin = m.microStopThresholdS * 1000
  const eventsFrom = new Date(window.start - margin)
  const eventsTo = new Date(window.end + margin)

  const events = await tx
    .select({
      state: machineStateEvent.state,
      startedAt: machineStateEvent.startedAt,
      endedAt: machineStateEvent.endedAt,
      category: downtimeReason.category,
    })
    .from(machineStateEvent)
    .leftJoin(downtimeReason, eq(downtimeReason.id, machineStateEvent.reasonId))
    .where(
      and(
        eq(machineStateEvent.machineId, m.id),
        lt(machineStateEvent.startedAt, eventsTo),
        or(isNull(machineStateEvent.endedAt), gt(machineStateEvent.endedAt, eventsFrom)),
      ),
    )
    .orderBy(asc(machineStateEvent.startedAt))
  const minutes = await tx
    .select({ start: productionMinute.bucketStart, total: productionMinute.total, reject: productionMinute.reject, productCode: productionMinute.productCode })
    .from(productionMinute)
    .where(and(eq(productionMinute.machineId, m.id), gte(productionMinute.bucketStart, start), lt(productionMinute.bucketStart, end)))
  // Trocas de produto (CLP e operador) que valem no turno: preenchem os minutos sem produto do CLP.
  const runs = await tx
    .select({ start: productionRun.startedAt, end: productionRun.endedAt, productCode: productionRun.productCode })
    .from(productionRun)
    .where(and(eq(productionRun.machineId, m.id), lt(productionRun.startedAt, end), or(isNull(productionRun.endedAt), gt(productionRun.endedAt, start))))
  const quality = await tx
    .select({ at: qualityEntry.at, quantity: qualityEntry.quantity, productCode: qualityEntry.productCode })
    .from(qualityEntry)
    .where(and(eq(qualityEntry.machineId, m.id), gte(qualityEntry.at, start), lt(qualityEntry.at, end)))
  const downtimes = await tx
    .select({ startsAt: plannedDowntime.startsAt, endsAt: plannedDowntime.endsAt })
    .from(plannedDowntime)
    .where(
      and(
        eq(plannedDowntime.unitId, m.unitId),
        isNull(plannedDowntime.deletedAt),
        or(isNull(plannedDowntime.lineId), eq(plannedDowntime.lineId, m.lineId)),
        or(isNull(plannedDowntime.machineId), eq(plannedDowntime.machineId, m.id)),
        lt(plannedDowntime.startsAt, end),
        gt(plannedDowntime.endsAt, start),
      ),
    )

  const result = calculateMachineOee({
    window: { start: window.start, end: window.end },
    schedule: [window],
    plannedDowntimes: downtimes.map((d): Interval => ({ start: ms(d.startsAt), end: ms(d.endsAt) })),
    stateEvents: events.map((e) => ({
      start: ms(e.startedAt),
      end: e.endedAt === null ? null : ms(e.endedAt),
      state: e.state,
      reasonCategory: e.category ?? null,
    })),
    minutes: fillMinuteProducts(
      minutes.map((r) => ({ start: ms(r.start), total: r.total, reject: r.reject, productCode: r.productCode })),
      runs.map((r) => ({ start: ms(r.start), end: r.end === null ? null : ms(r.end), productCode: r.productCode })),
    ),
    qualityAdjustments: quality.map((q) => ({ at: ms(q.at), quantity: q.quantity, productCode: q.productCode })),
    idealCycles: { byProduct: await idealCycles(tx, m, cycleCache), defaultS: m.idealCycleS === null ? null : Number(m.idealCycleS) },
    options: { microStopThresholdS: m.microStopThresholdS },
  })
  const { totals, indicators, times } = result
  return {
    plannedS: times.plannedS,
    runS: times.runS,
    downtimeS: Math.max(0, times.downtimeS),
    total: totals.total,
    good: totals.good,
    // Estorno sem o lançamento original na janela pode deixar o refugo negativo; o banco exige >= 0.
    reject: Math.max(0, totals.reject),
    idealTimeS: totals.idealTimeS,
    availability: indicators.availability,
    performance: indicators.performance,
    quality: indicators.quality,
    oee: indicators.oee,
  }
}

function toMachineInfo(row: { id: string; unitId: string; lineId: string; idealCycleS: number | null; microStopThresholdS: number; createdAt: Date }): MachineInfo {
  return { ...row, idealCycleS: row.idealCycleS === null ? null : Number(row.idealCycleS) }
}

/** Turnos que terminaram e ainda não têm linha em `oee_shift`, do mais antigo para o mais novo. */
async function closableShifts(tx: GatewayTx, now: Date, log: (m: string, e?: unknown) => void): Promise<{ list: ShiftCalculation[]; errors: number }> {
  const units = await tx.select({ id: unit.id, timezone: unit.timezone }).from(unit).where(isNull(unit.deletedAt))
  if (units.length === 0) return { list: [], errors: 0 }
  const shifts = await tx.select(SHIFT_COLUMNS).from(shift).where(isNull(shift.deletedAt))
  if (shifts.length === 0) return { list: [], errors: 0 }
  const machines = (
    await tx
      .select(MACHINE_COLUMNS)
      .from(machine)
      .where(and(eq(machine.active, true), isNull(machine.deletedAt)))
  ).map(toMachineInfo)
  if (machines.length === 0) return { list: [], errors: 0 }

  // Datas de turno candidatas: da data local mais antiga (lookback) até hoje, em cada fuso.
  const fromOf = (tz: string) => addDays(plantDateOf(ms(now), tz), -SHIFT_CLOSE_LOOKBACK_DAYS)
  const earliest = units.map((u) => {
    try {
      return fromOf(u.timezone)
    } catch {
      return addDays(now.toISOString().slice(0, 10), -SHIFT_CLOSE_LOOKBACK_DAYS - 1)
    }
  }).sort()[0]!
  const holidays = await tx
    .select({ unitId: unitHoliday.unitId, day: unitHoliday.holidayDate })
    .from(unitHoliday)
    .where(and(isNull(unitHoliday.deletedAt), gte(unitHoliday.holidayDate, earliest)))
  const existing = await tx
    .select({ machineId: oeeShift.machineId, shiftDate: oeeShift.shiftDate, shiftId: oeeShift.shiftId })
    .from(oeeShift)
    .where(gte(oeeShift.shiftDate, earliest))
  const done = new Set(existing.map((e) => `${e.machineId}|${e.shiftDate}|${e.shiftId}`))

  const list: ShiftCalculation[] = []
  let errors = 0
  const closedBefore = ms(now) - SHIFT_CLOSE_GRACE_MS
  for (const u of units) {
    const unitShifts: ShiftRow[] = shifts.filter((s) => s.unitId === u.id)
    const unitMachines = machines.filter((m) => m.unitId === u.id)
    if (unitShifts.length === 0 || unitMachines.length === 0) continue
    let windows: ShiftWindow[]
    try {
      windows = unitShiftWindows({
        shifts: unitShifts,
        timeZone: u.timezone,
        from: fromOf(u.timezone),
        to: plantDateOf(ms(now), u.timezone),
        holidays: new Set(holidays.filter((h) => h.unitId === u.id).map((h) => h.day)),
      })
    } catch (error) {
      errors++
      log(`turnos da unidade ${u.id} não puderam ser gerados (cadastro ou fuso inválido)`, error)
      continue
    }
    for (const w of windows) {
      if (w.end > closedBefore) continue
      for (const m of unitMachines) {
        if (ms(m.createdAt) >= w.end) continue
        if (done.has(`${m.id}|${w.shiftDate}|${w.shiftId}`)) continue
        list.push({ machine: m, window: w })
      }
    }
  }
  list.sort((a, b) => a.window.end - b.window.end || a.machine.id.localeCompare(b.machine.id))
  return { list, errors }
}

/** Fecha os turnos terminados e recalcula os sujos de UM cliente (dentro de `withTenant`). */
export async function closeAndRecomputeShifts(tx: GatewayTx, options: ShiftRunOptions): Promise<ShiftRunStats> {
  const { now } = options
  const log = options.log ?? (() => undefined)
  const hasTime = options.hasTime ?? (() => true)
  let budget = options.maxCalculations ?? MAX_SHIFT_CALCULATIONS
  const cycleCache = new Map<string, Record<string, number>>()
  let closed = 0
  let recomputed = 0
  let pending = 0
  let errors = 0

  // 1. Fechamento.
  const closable = await closableShifts(tx, now, log)
  errors += closable.errors
  for (const [i, calc] of closable.list.entries()) {
    if (budget <= 0 || !hasTime()) {
      pending += closable.list.length - i
      break
    }
    budget--
    try {
      // Savepoint: um cálculo que falha não derruba a transação do cliente.
      const inserted = await tx.transaction(async (sp) => {
        const values = await calculateShift(sp, calc, cycleCache)
        return sp
          .insert(oeeShift)
          .values({
            organizationId: options.organizationId,
            machineId: calc.machine.id,
            shiftDate: calc.window.shiftDate,
            shiftId: calc.window.shiftId,
            ...values,
            dirty: false,
            dirtySince: null,
            calculatedAt: now,
          })
          .onConflictDoNothing()
          .returning({ machineId: oeeShift.machineId })
      })
      closed += inserted.length
    } catch (error) {
      errors++
      log(`fechamento do turno ${calc.window.shiftId} de ${calc.window.shiftDate} (máquina ${calc.machine.id}) falhou`, error)
    }
  }

  // 2. Recálculo dos sujos (mais antigos primeiro). Linha travada por outra transação fica para a próxima.
  if (budget > 0 && hasTime()) {
    const dirty = await queryRows<{ machine_id: string; shift_date: string; shift_id: string }>(
      tx,
      sql`SELECT machine_id, to_char(shift_date, 'YYYY-MM-DD') AS shift_date, shift_id FROM oee_shift
          WHERE dirty ORDER BY shift_date, machine_id LIMIT ${budget + 1} FOR UPDATE SKIP LOCKED`,
    )
    if (dirty.length > budget) pending += dirty.length - budget
    const shiftCache = new Map<string, { row: ShiftRow; timezone: string } | null>()
    const machineCache = new Map<string, MachineInfo | null>()
    for (const [i, d] of dirty.slice(0, budget).entries()) {
      if (!hasTime()) {
        pending += Math.min(dirty.length, budget) - i
        break
      }
      try {
        if (!shiftCache.has(d.shift_id)) {
          const [found] = await tx
            .select({ ...SHIFT_COLUMNS, timezone: unit.timezone })
            .from(shift)
            .innerJoin(unit, eq(unit.id, shift.unitId))
            .where(eq(shift.id, d.shift_id))
          shiftCache.set(d.shift_id, found === undefined ? null : { row: found, timezone: found.timezone })
        }
        if (!machineCache.has(d.machine_id)) {
          const [found] = await tx.select(MACHINE_COLUMNS).from(machine).where(eq(machine.id, d.machine_id))
          machineCache.set(d.machine_id, found === undefined ? null : toMachineInfo(found))
        }
        const s = shiftCache.get(d.shift_id)
        const m = machineCache.get(d.machine_id)
        const window = s ? shiftWindowOn(s.row, d.shift_date, s.timezone) : null
        if (!s || !m || window === null) {
          errors++
          log(`turno sujo sem turno ou máquina no cadastro: ${d.shift_id} / ${d.machine_id} em ${d.shift_date}`)
          continue
        }
        await tx.transaction(async (sp) => {
          const values = await calculateShift(sp, { machine: m, window }, cycleCache)
          await sp
            .update(oeeShift)
            .set({ ...values, dirty: false, dirtySince: null, calculatedAt: now })
            .where(and(eq(oeeShift.machineId, d.machine_id), eq(oeeShift.shiftDate, d.shift_date), eq(oeeShift.shiftId, d.shift_id)))
        })
        recomputed++
      } catch (error) {
        errors++
        log(`recálculo do turno ${d.shift_id} de ${d.shift_date} (máquina ${d.machine_id}) falhou`, error)
      }
    }
  } else {
    const [row] = await queryRows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM oee_shift WHERE dirty`)
    pending += Number(row?.n ?? 0)
  }

  return { closed, recomputed, pending, errors }
}
