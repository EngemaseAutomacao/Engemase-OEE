"use client"

import { useState } from "react"
import {
  Building2Icon,
  CalendarClockIcon,
  CalendarOffIcon,
  CalendarPlusIcon,
  ClockIcon,
  CoffeeIcon,
  CopyIcon,
  MoonIcon,
  PencilIcon,
  PlusIcon,
  RepeatIcon,
  SunIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { pct } from "@/lib/format"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { SHIFT_COLORS, WEEKDAYS, daysSummary, hmToMin, hoursLabel, plural } from "@/components/config/labels"
import { PlannedStopDialog, RECURRENCE_LABEL, ShiftDialog } from "@/components/config/shift-dialogs"
import { ShiftRuler } from "@/components/config/shift-ruler"
import {
  addDays,
  coverageMinutes,
  dateParts,
  diffDays,
  dm,
  shiftMinutes,
  shiftOverlaps,
  weekdayOf,
  type PlannedStop,
  type ShiftRow,
} from "@/components/config/shift-utils"
import { ConfirmDialog, IconAction, PageTitle } from "@/components/config/ui-bits"
import { EngemaseOnlyChip, useCanEdit } from "@/components/config/engemase-managed"

export interface ShiftUnit {
  id: string
  name: string
  tzLabel: string
  /** Data civil de hoje no fuso da unidade ("2026-11-11") */
  today: string
  /** Segunda-feira da semana atual */
  weekStart: string
  /** Minuto do dia agora, no fuso da unidade */
  nowMin: number
}

export interface StopReason {
  id: string
  name: string
  group: string
}

export interface ShiftMachine {
  id: string
  name: string
  code: string
  unitId: string
}

export function ShiftsManager({
  units,
  initialShifts,
  initialStops,
  reasons,
  machines,
}: {
  units: ShiftUnit[]
  initialShifts: ShiftRow[]
  initialStops: PlannedStop[]
  reasons: StopReason[]
  machines: ShiftMachine[]
}) {
  const [unitId, setUnitId] = useState(units[0]?.id ?? "")
  const [shifts, setShifts] = useState(initialShifts)
  const [stops, setStops] = useState(initialStops)
  const [editingShift, setEditingShift] = useState<ShiftRow | "new" | null>(null)
  const [editingStop, setEditingStop] = useState<PlannedStop | "new" | null>(null)
  const [deleting, setDeleting] = useState<{ kind: "shift"; item: ShiftRow } | { kind: "stop"; item: PlannedStop } | null>(null)
  const canEdit = useCanEdit()

  const unit = units.find((u) => u.id === unitId) ?? units[0]
  if (!unit) {
    return (
      <div className="p-4 md:p-6">
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClockIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma unidade cadastrada</EmptyTitle>
            <EmptyDescription>
              {canEdit
                ? "Os turnos são definidos por unidade. Cadastre uma unidade primeiro."
                : "Os turnos são definidos por unidade. A equipe Engemase cadastra as unidades e os turnos."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  const unitShifts = shifts.filter((s) => s.unitId === unit.id).sort((a, b) => hmToMin(a.start) - hmToMin(b.start))
  const colors = Object.fromEntries(unitShifts.map((s, i) => [s.id, SHIFT_COLORS[i % SHIFT_COLORS.length]]))
  const unitMachines = machines.filter((m) => m.unitId === unit.id)
  const machineCode = new Map(machines.map((m) => [m.id, m.code]))
  const reasonById = new Map(reasons.map((r) => [r.id, r]))
  const upcoming = stops
    .filter((p) => p.unitId === unit.id && diffDays(p.endDate, unit.today) >= 0)
    .sort((a, b) => (a.startDate + a.startTime).localeCompare(b.startDate + b.startTime))
  const weekEnd = addDays(unit.weekStart, 7)
  const weekStops = upcoming.filter((p) => p.startDate < weekEnd)

  // Indicadores
  const weeklyPlanned = unitShifts.reduce((acc, s) => acc + shiftMinutes(s).planned * s.days.length, 0)
  const todayDow = weekdayOf(unit.today)
  const coverage = coverageMinutes(unitShifts, todayDow)
  const allDays = [...new Set(unitShifts.flatMap((s) => s.days))]
  const overlaps = shiftOverlaps(unitShifts)

  /** Turno em andamento agora (considera o que veio da véspera). */
  const isCurrent = (s: ShiftRow) => {
    const start = hmToMin(s.start)
    const span = shiftMinutes(s).total
    const yesterday = (todayDow + 6) % 7
    if (s.days.includes(todayDow) && unit.nowMin >= start && unit.nowMin < start + span) return true
    return s.days.includes(yesterday) && start + span > 1440 && unit.nowMin < start + span - 1440
  }

  const saveShift = (d: Omit<ShiftRow, "id" | "unitId"> & { id: string | null }) => {
    if (d.id) {
      setShifts((list) => list.map((s) => (s.id === d.id ? { ...s, ...d, id: s.id } : s)))
      toast.success(`${d.name} atualizado`, { description: "Vale a partir do próximo turno. Turnos já encerrados não são recalculados." })
    } else {
      const id = `sft_new_${unit.id}_${shifts.length + 1}`
      setShifts((list) => [...list, { ...d, id, unitId: unit.id }])
      toast.success(`${d.name} criado`, { description: `${d.start}–${d.end} · ${daysSummary(d.days)} · ${unit.name}` })
    }
    setEditingShift(null)
  }

  const saveStop = (d: Omit<PlannedStop, "id" | "unitId"> & { id: string | null }) => {
    if (d.id) {
      setStops((list) => list.map((p) => (p.id === d.id ? { ...p, ...d, id: p.id } : p)))
      toast.success("Parada planejada atualizada", { description: d.title })
    } else {
      const id = `pst_new_${stops.length + 1}`
      setStops((list) => [...list, { ...d, id, unitId: unit.id }])
      toast.success("Parada planejada agendada", { description: `${d.title} · ${dm(d.startDate)}. O intervalo sai do tempo planejado do OEE.` })
    }
    setEditingStop(null)
  }

  const duplicate = (s: ShiftRow) => {
    const copy = { ...s, id: `sft_copy_${s.id}_${shifts.length + 1}`, name: `${s.name} (cópia)` }
    setShifts((list) => [...list, copy])
    toast.success("Turno duplicado", { description: "Ajuste os dias ou o horário para não sobrepor o original." })
  }

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageTitle
        title="Turnos"
        description="Calendário de turnos, pausas e paradas planejadas por unidade. É o que define o tempo planejado do OEE."
        actions={
          <>
            {units.length > 1 && (
              <Select value={unit.id} onValueChange={setUnitId}>
                <SelectTrigger className="w-full bg-card sm:w-52" aria-label="Unidade">
                  <Building2Icon className="size-4 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {canEdit && (
              <>
                <EngemaseOnlyChip />
                <Button variant="outline" onClick={() => setEditingStop("new")}>
                  <CalendarPlusIcon />
                  Parada planejada
                </Button>
                <Button onClick={() => setEditingShift("new")}>
                  <PlusIcon />
                  Novo turno
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CalendarClockIcon} tone="blue" label="Turnos" value={unitShifts.length} hint={unitShifts.length ? daysSummary(allDays) : "Nenhum turno"} />
        <StatCard icon={ClockIcon} tone="navy" label="Horas por semana" value={hoursLabel(weeklyPlanned)} hint="planejadas, sem as pausas" />
        <StatCard
          icon={SunIcon}
          tone="teal"
          label="Cobertura hoje"
          value={hoursLabel(coverage)}
          hint={`${pct(coverage / 1440, 0)} do dia (${WEEKDAYS.find((w) => w.d === todayDow)?.label})`}
        />
        <StatCard
          icon={CalendarOffIcon}
          tone="orange"
          label="Paradas planejadas"
          value={upcoming.length}
          hint={upcoming[0] ? `próxima em ${dm(upcoming[0].startDate)}` : "nenhuma agendada"}
        />
      </div>

      <SectionCard
        title="Régua de 24 h"
        description={`Semana de ${dm(unit.weekStart)} a ${dm(addDays(unit.weekStart, 6))} · ${unit.tzLabel}`}
        action={
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
            <span className="size-2 rounded-full bg-state-fault" />
            agora
          </span>
        }
      >
        {unitShifts.length === 0 && weekStops.length === 0 ? (
          <p className="rounded-xl bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">Sem turnos nesta unidade: nenhum tempo é planejado e o OEE fica “sem produção planejada”.</p>
        ) : (
          <ShiftRuler shifts={unitShifts} colors={colors} stops={weekStops} weekStart={unit.weekStart} today={unit.today} nowMin={unit.nowMin} />
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {unitShifts.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-sm", colors[s.id])} />
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {s.start}–{s.end}
              </span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2.5 rounded-sm bg-sky-500 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.7)_0_2px,transparent_2px_4px)]" />
            pausa
          </span>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2.5 rounded-sm bg-state-planned bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.7)_0_2px,transparent_2px_4px)]" />
            parada planejada
          </span>
        </div>
        {overlaps.length > 0 && (
          <Alert className="mt-4 border-state-stopped/40 bg-state-stopped/5">
            <TriangleAlertIcon className="text-amber-600 dark:text-state-stopped" />
            <AlertDescription>
              {overlaps.map(([a, b]) => `${a.name} e ${b.name}`).join("; ")} se sobrepõem. O tempo sobreposto contaria duas vezes no planejado: ajuste o horário ou os dias.
            </AlertDescription>
          </Alert>
        )}
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-12">
        <SectionCard title="Turnos" description={`${unit.name} · ${plural(unitShifts.length, "turno", "turnos")}`} className="xl:col-span-7">
          {unitShifts.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarClockIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhum turno nesta unidade</EmptyTitle>
                <EmptyDescription>
                  {canEdit
                    ? "Cadastre os turnos com horário, dias e pausas. Sem turno não há tempo planejado."
                    : "Sem turno não há tempo planejado. A equipe Engemase cadastra os turnos; para pedir, abra um chamado."}
                </EmptyDescription>
              </EmptyHeader>
              {canEdit && (
                <EmptyContent>
                  <Button onClick={() => setEditingShift("new")}>
                    <PlusIcon />
                    Novo turno
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {unitShifts.map((s) => {
                const m = shiftMinutes(s)
                const night = hmToMin(s.end) <= hmToMin(s.start)
                const current = isCurrent(s)
                return (
                  <article key={s.id} className={cn("flex flex-col gap-3 rounded-xl border p-4", current && "border-primary/40 bg-primary/[0.03]")}>
                    <header className="flex items-start gap-2.5">
                      <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", colors[s.id])} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-h-8 flex-wrap items-center gap-1.5">
                          <h3 className="truncate text-sm font-semibold">{s.name}</h3>
                          {current && <span className="rounded-full bg-state-running/12 px-1.5 py-0.5 text-[10px] font-semibold text-state-running">em andamento</span>}
                          {night && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-[#2c4e73]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#2c4e73] dark:bg-white/10 dark:text-[#9cc3e6]">
                              <MoonIcon className="size-2.5" />
                              vira o dia
                            </span>
                          )}
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex gap-1">
                          <IconAction icon={PencilIcon} label={`Editar ${s.name}`} onClick={() => setEditingShift(s)} />
                          <IconAction icon={CopyIcon} label="Duplicar" tone="slate" onClick={() => duplicate(s)} />
                          <IconAction icon={Trash2Icon} label={`Excluir ${s.name}`} tone="red" onClick={() => setDeleting({ kind: "shift", item: s })} />
                        </div>
                      )}
                    </header>
                    <div className="-mt-1 text-xl leading-tight font-bold whitespace-nowrap tabular-nums">
                      {s.start} – {s.end}
                    </div>

                    <div className="flex gap-1" aria-label={`Dias: ${daysSummary(s.days)}`}>
                      {WEEKDAYS.map((w) => {
                        const on = s.days.includes(w.d)
                        return (
                          <span
                            key={w.d}
                            title={w.label}
                            className={cn(
                              "flex size-7 items-center justify-center rounded-full text-[11px] font-semibold",
                              on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground/60",
                            )}
                          >
                            {w.short}
                          </span>
                        )
                      })}
                    </div>

                    <ul className="flex flex-col gap-1 text-xs">
                      {s.breaks.map((b) => (
                        <li key={`${b.name}-${b.start}`} className="flex items-center gap-2 text-muted-foreground">
                          <CoffeeIcon className="size-3.5 shrink-0" />
                          <span className="flex-1 truncate">{b.name}</span>
                          <span className="tabular-nums">
                            {b.start}–{b.end}
                          </span>
                        </li>
                      ))}
                      {s.breaks.length === 0 && <li className="text-muted-foreground">Sem pausas fixas</li>}
                    </ul>

                    <dl className="mt-auto grid grid-cols-3 gap-2 rounded-lg bg-muted/60 px-3 py-2">
                      {[
                        { k: "Duração", v: hoursLabel(m.total) },
                        { k: "Planejado", v: hoursLabel(m.planned) },
                        { k: "Na semana", v: hoursLabel(m.planned * s.days.length) },
                      ].map((x) => (
                        <div key={x.k} className="min-w-0">
                          <dt className="truncate text-[10px] text-muted-foreground">{x.k}</dt>
                          <dd className="truncate text-xs font-semibold tabular-nums">{x.v}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                )
              })}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditingShift("new")}
                  className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                >
                  <PlusIcon className="size-5" />
                  Adicionar turno
                </button>
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Paradas planejadas"
          description="Preventivas, feriados e falta de programação"
          className="xl:col-span-5"
          action={
            canEdit && (
              <Button size="sm" variant="ghost" className="h-auto px-0 text-xs font-semibold text-primary hover:bg-transparent hover:underline" onClick={() => setEditingStop("new")}>
                Agendar
              </Button>
            )
          }
        >
          {upcoming.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarOffIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhuma parada agendada</EmptyTitle>
                <EmptyDescription>
                  {canEdit
                    ? "Agende preventivas e feriados para que não penalizem o OEE."
                    : "Preventivas e feriados agendados não penalizam o OEE. Para agendar, abra um chamado com a equipe Engemase."}
                </EmptyDescription>
              </EmptyHeader>
              {canEdit && (
                <EmptyContent>
                  <Button variant="outline" onClick={() => setEditingStop("new")}>
                    <CalendarPlusIcon />
                    Nova parada planejada
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <ul className="divide-y">
              {upcoming.map((p) => {
                const d = dateParts(p.startDate)
                const allDay = p.startTime === "00:00" && p.endTime === "00:00"
                const lastDay = allDay ? addDays(p.endDate, -1) : p.endDate
                const multiDay = lastDay !== p.startDate
                const period = allDay
                  ? multiDay
                    ? `${dm(p.startDate)} a ${dm(lastDay)} · dias inteiros`
                    : "Dia inteiro"
                  : multiDay
                    ? `${dm(p.startDate)} ${p.startTime} → ${dm(p.endDate)} ${p.endTime}`
                    : `${p.startTime}–${p.endTime}`
                const reason = reasonById.get(p.reasonId)
                const ongoing = p.startDate <= unit.today && unit.today <= lastDay
                return (
                  <li key={p.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <div
                      className={cn(
                        "flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5 leading-none",
                        ongoing ? "bg-state-planned text-white" : "bg-state-planned/12 text-state-planned",
                      )}
                    >
                      <span className="text-[10px] font-medium uppercase">{d.month}</span>
                      <span className="text-lg font-bold">{d.day}</span>
                      <span className="text-[10px]">{d.weekday}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm leading-snug font-medium">{p.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{period}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {reason && <span className="rounded-full bg-state-planned/12 px-2 py-0.5 text-[10px] font-medium text-state-planned">{reason.name}</span>}
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {p.scope === "unit" ? "Unidade inteira" : p.scope.map((id) => machineCode.get(id) ?? id).join(", ")}
                        </span>
                        {p.recurrence !== "none" && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            <RepeatIcon className="size-2.5" />
                            {RECURRENCE_LABEL[p.recurrence]}
                          </span>
                        )}
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1">
                        <IconAction icon={PencilIcon} label="Editar parada" onClick={() => setEditingStop(p)} />
                        <IconAction icon={Trash2Icon} label="Cancelar parada" tone="red" onClick={() => setDeleting({ kind: "stop", item: p })} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <ShiftDialog
        open={editingShift !== null}
        onOpenChange={(o) => !o && setEditingShift(null)}
        shift={editingShift === "new" ? null : editingShift}
        unitName={unit.name}
        onSave={saveShift}
      />
      <PlannedStopDialog
        open={editingStop !== null}
        onOpenChange={(o) => !o && setEditingStop(null)}
        stop={editingStop === "new" ? null : editingStop}
        unitName={unit.name}
        today={unit.today}
        reasons={reasons}
        machines={unitMachines}
        onSave={saveStop}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting?.kind === "shift" ? `Excluir ${deleting.item.name}?` : "Cancelar parada planejada?"}
        confirmLabel={deleting?.kind === "shift" ? "Excluir turno" : "Cancelar parada"}
        description={
          deleting?.kind === "shift"
            ? "Os turnos já encerrados continuam no histórico. A partir de agora esse horário deixa de contar como tempo planejado."
            : `“${deleting?.item.title ?? ""}” volta a contar como tempo planejado. Se a máquina parar nesse período, a parada pedirá motivo.`
        }
        onConfirm={() => {
          if (!deleting) return
          if (deleting.kind === "shift") {
            setShifts((list) => list.filter((s) => s.id !== deleting.item.id))
            toast.success(`${deleting.item.name} excluído`)
          } else {
            setStops((list) => list.filter((p) => p.id !== deleting.item.id))
            toast.success("Parada planejada cancelada", { description: deleting.item.title })
          }
          setDeleting(null)
        }}
      />
    </div>
  )
}
