import { notFound } from "next/navigation"

import { MOCK_NOW, getClientBySlug, getDowntimeReasons, getMachines, getShifts, getUnits } from "@/lib/mock"
import { timezoneShort } from "@/components/config/labels"
import { addDays, weekdayOf, type PlannedStop, type ShiftRow } from "@/components/config/shift-utils"
import { ShiftsManager, type ShiftMachine, type ShiftUnit, type StopReason } from "@/components/config/shifts-manager"

/** Data civil, minuto do dia e segunda-feira da semana no fuso da unidade, a partir do "agora" do protótipo. */
function clockFor(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(MOCK_NOW))
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "00"
  const today = `${get("year")}-${get("month")}-${get("day")}`
  return {
    today,
    nowMin: Number(get("hour")) * 60 + Number(get("minute")),
    weekStart: addDays(today, -((weekdayOf(today) + 6) % 7)),
  }
}

export default async function Page({ params }: PageProps<"/[cliente]/config/turnos">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const units: ShiftUnit[] = getUnits(client.id).map((u) => ({ id: u.id, name: u.name, tzLabel: timezoneShort(u.timezone), ...clockFor(u.timezone) }))
  const shifts: ShiftRow[] = getShifts(client.id).map((s) => ({ id: s.id, unitId: s.unitId, name: s.name, start: s.start, end: s.end, days: s.days, breaks: s.breaks }))
  const machines: ShiftMachine[] = getMachines(client.id).map((m) => ({ id: m.id, name: m.name, code: m.code, unitId: m.unitId }))

  const allReasons = getDowntimeReasons(client.id)
  const reasons: StopReason[] = allReasons
    .filter((r) => r.category === "planned" && r.parentId)
    .map((r) => ({ id: r.id, name: r.name, group: allReasons.find((p) => p.id === r.parentId)?.name ?? "" }))
  const preventive = reasons.find((r) => /preventiva/i.test(r.name)) ?? reasons[0]
  const noSchedule = reasons.find((r) => /sem programa/i.test(r.name)) ?? reasons[0]

  // Paradas planejadas de exemplo (o cadastro real virá do banco): preventiva no sábado, feriado e recesso.
  const stops: PlannedStop[] = preventive
    ? units.flatMap((u) => {
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
    : []

  return <ShiftsManager units={units} initialShifts={shifts} initialStops={stops} reasons={reasons} machines={machines} />
}
