/**
 * Dados da tela "Turnos" (cadastro do cliente, W8). Com banco: unidades (com o relógio real no fuso de cada
 * uma), turnos, paradas planejadas que ainda não terminaram (há 1 dia de folga) e os motivos de parada
 * planejada, lidos sob a RLS do cliente; `exigirCliente` confere sessão, cliente e `config.read`. Sem banco:
 * os dados simulados, como no protótipo.
 */
import { downtimeReason, plannedDowntime, shift, withTenant } from "@engemase/db"
import { and, asc, eq, gt, isNull } from "drizzle-orm"
import { timezoneShort } from "@/components/config/labels"
import { addDays, type PlannedStop, type ShiftRow, weekdayOf } from "@/components/config/shift-utils"
import type { ShiftMachine, ShiftUnit, StopReason } from "@/components/config/shifts-manager"
import { getDowntimeReasons, getShifts, MOCK_NOW } from "@/lib/mock"
import { bancoObrigatorio } from "../admin/acesso"
import { exigirCliente } from "./cliente"

const DAY = 86_400_000

/** Data e hora locais (`YYYY-MM-DD`, `HH:MM`) de um instante no fuso dado. */
function local(instant: Date | number, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant))
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "00"
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` }
}

/** Data civil, minuto do dia e segunda-feira da semana no fuso da unidade. */
function clockFor(timeZone: string, now: Date | number) {
  const { date, time } = local(now, timeZone)
  return {
    today: date,
    nowMin: Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)),
    weekStart: addDays(date, -((weekdayOf(date) + 6) % 7)),
  }
}

export async function dadosTurnos(slug: string) {
  const { r, client, ctx } = await exigirCliente(slug)
  const now = ctx === null ? Date.parse(MOCK_NOW) : Date.now()
  const rawUnits = r.getUnits(client.id)
  const units: ShiftUnit[] = rawUnits.map((u) => ({ id: u.id, name: u.name, tzLabel: timezoneShort(u.timezone), ...clockFor(u.timezone, now) }))
  const machines: ShiftMachine[] = r.getMachines(client.id).map((m) => ({ id: m.id, name: m.name, code: m.code, unitId: m.unitId }))
  const canEdit = r.getConfigAccess(client.id).canConfigure

  if (ctx === null) {
    const shifts: ShiftRow[] = getShifts(client.id).map((s) => ({ id: s.id, unitId: s.unitId, name: s.name, start: s.start, end: s.end, days: s.days, breaks: s.breaks }))
    const allReasons = getDowntimeReasons(client.id)
    const reasons: StopReason[] = allReasons
      .filter((x) => x.category === "planned" && x.parentId)
      .map((x) => ({ id: x.id, name: x.name, group: allReasons.find((p) => p.id === x.parentId)?.name ?? "" }))
    return { client, banco: false, canEdit, units, machines, shifts, stops: exemplos(units, machines, reasons), reasons }
  }

  const tzOf = new Map(rawUnits.map((u) => [u.id, u.timezone]))
  const { shiftRows, stopRows, reasonRows } = await withTenant(bancoObrigatorio(), ctx.organizationId, async (tx) => ({
    shiftRows: await tx
      .select({ id: shift.id, unitId: shift.unitId, name: shift.name, start: shift.startTime, end: shift.endTime, days: shift.daysOfWeek, breaks: shift.breaks })
      .from(shift)
      .where(isNull(shift.deletedAt))
      .orderBy(asc(shift.startTime)),
    stopRows: await tx
      .select({
        id: plannedDowntime.id,
        unitId: plannedDowntime.unitId,
        machineId: plannedDowntime.machineId,
        reasonId: plannedDowntime.reasonId,
        name: plannedDowntime.name,
        startsAt: plannedDowntime.startsAt,
        endsAt: plannedDowntime.endsAt,
        recurrence: plannedDowntime.recurrence,
      })
      .from(plannedDowntime)
      .where(and(isNull(plannedDowntime.deletedAt), gt(plannedDowntime.endsAt, new Date(now - DAY))))
      .orderBy(asc(plannedDowntime.startsAt)),
    reasonRows: await tx
      .select({ id: downtimeReason.id, parentId: downtimeReason.parentId, name: downtimeReason.name, category: downtimeReason.category, active: downtimeReason.active })
      .from(downtimeReason)
      .where(and(isNull(downtimeReason.deletedAt), eq(downtimeReason.active, true))),
  }))
  const hm = (t: string) => t.slice(0, 5)
  const shifts: ShiftRow[] = shiftRows
    .filter((s) => tzOf.has(s.unitId))
    .map((s) => ({
      id: s.id,
      unitId: s.unitId,
      name: s.name,
      start: hm(s.start),
      end: hm(s.end),
      // Banco em ISO (1 = segunda … 7 = domingo); a tela usa 0 = domingo.
      days: [...new Set(s.days.map((d) => d % 7))].sort(),
      breaks: (s.breaks ?? []).map((b) => ({ name: b.name ?? "Pausa", start: hm(b.start), end: hm(b.end) })),
    }))
  const stops: PlannedStop[] = stopRows
    .filter((p) => tzOf.has(p.unitId))
    .map((p) => {
      const tz = tzOf.get(p.unitId) ?? "America/Sao_Paulo"
      const start = local(p.startsAt, tz)
      const end = local(p.endsAt, tz)
      return {
        id: p.id,
        unitId: p.unitId,
        title: p.name,
        reasonId: p.reasonId ?? "",
        scope: p.machineId === null ? ("unit" as const) : [p.machineId],
        startDate: start.date,
        startTime: start.time,
        endDate: end.date,
        endTime: end.time,
        // Série gravada como "weekly:<id>" / "monthly:<id>" (cada ocorrência é uma parada).
        recurrence: p.recurrence?.startsWith("weekly:") ? ("weekly" as const) : p.recurrence?.startsWith("monthly:") ? ("monthly" as const) : ("none" as const),
      }
    })
  const reasons: StopReason[] = reasonRows
    .filter((x) => x.category === "planned" && x.parentId !== null)
    .map((x) => ({ id: x.id, name: x.name, group: reasonRows.find((p) => p.id === x.parentId)?.name ?? "" }))
  return { client, banco: true, canEdit, units, machines, shifts, stops, reasons }
}

/** Paradas planejadas de exemplo da demonstração: preventiva no sábado, feriado e recesso. */
function exemplos(units: ShiftUnit[], machines: ShiftMachine[], reasons: StopReason[]): PlannedStop[] {
  const preventive = reasons.find((x) => /preventiva/i.test(x.name)) ?? reasons[0]
  const noSchedule = reasons.find((x) => /sem programa/i.test(x.name)) ?? reasons[0]
  if (!preventive || !noSchedule) return []
  return units.flatMap((u) => {
    const year = Number(u.today.slice(0, 4))
    const unitMachines = machines.filter((m) => m.unitId === u.id)
    return [
      {
        id: `pst_${u.id}_prev`,
        unitId: u.id,
        title: "Manutenção preventiva mensal",
        reasonId: preventive.id,
        scope: unitMachines.length ? unitMachines.slice(0, 2).map((m) => m.id) : ("unit" as const),
        startDate: addDays(u.weekStart, 5),
        startTime: "06:00",
        endDate: addDays(u.weekStart, 5),
        endTime: "12:00",
        recurrence: "monthly" as const,
      },
      {
        id: `pst_${u.id}_cn`,
        unitId: u.id,
        title: "Feriado · Dia da Consciência Negra",
        reasonId: noSchedule.id,
        scope: "unit" as const,
        startDate: `${year}-11-20`,
        startTime: "00:00",
        endDate: `${year}-11-21`,
        endTime: "00:00",
        recurrence: "none" as const,
      },
      {
        id: `pst_${u.id}_recesso`,
        unitId: u.id,
        title: "Recesso coletivo de fim de ano",
        reasonId: noSchedule.id,
        scope: "unit" as const,
        startDate: `${year}-12-24`,
        startTime: "00:00",
        endDate: `${year + 1}-01-05`,
        endTime: "00:00",
        recurrence: "none" as const,
      },
    ]
  })
}
