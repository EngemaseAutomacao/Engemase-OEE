"use client"

import { useState } from "react"
import { CoffeeIcon, MoonIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { WEEKDAYS, hmToMin, hoursLabel, plural } from "@/components/config/labels"
import { addDays, breakInside, shiftMinutes, stopMinutes, type PlannedStop, type Recurrence, type ShiftRow } from "@/components/config/shift-utils"

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// Turno
// ---------------------------------------------------------------------------

export function ShiftDialog({
  open,
  onOpenChange,
  shift,
  unitName,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = novo turno */
  shift: ShiftRow | null
  unitName: string
  onSave: (s: Omit<ShiftRow, "id" | "unitId"> & { id: string | null }) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {open && <ShiftForm key={shift?.id ?? "new"} shift={shift} unitName={unitName} onSave={onSave} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ShiftForm({
  shift,
  unitName,
  onSave,
  onCancel,
}: {
  shift: ShiftRow | null
  unitName: string
  onSave: (s: Omit<ShiftRow, "id" | "unitId"> & { id: string | null }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(shift?.name ?? "")
  const [start, setStart] = useState(shift?.start ?? "06:00")
  const [end, setEnd] = useState(shift?.end ?? "14:00")
  const [days, setDays] = useState<string[]>((shift?.days ?? [1, 2, 3, 4, 5]).map(String))
  const [breaks, setBreaks] = useState(shift?.breaks ?? [{ name: "Refeição", start: "10:00", end: "10:30" }])
  const [show, setShow] = useState(false)

  const timesOk = TIME_RE.test(start) && TIME_RE.test(end) && start !== end
  const crossesMidnight = timesOk && hmToMin(end) <= hmToMin(start)
  const m = timesOk ? shiftMinutes({ start, end, breaks: breaks.filter((b) => TIME_RE.test(b.start) && TIME_RE.test(b.end)) }) : null
  const breakErrors = breaks.map((b) =>
    !b.name.trim()
      ? "Dê um nome à pausa."
      : !TIME_RE.test(b.start) || !TIME_RE.test(b.end) || b.start === b.end
        ? "Horário inválido."
        : timesOk && !breakInside({ start, end }, b)
          ? "A pausa precisa estar dentro do turno."
          : null,
  )
  const errors = {
    name: name.trim().length < 2 ? "Informe o nome do turno." : null,
    times: !timesOk ? "Informe início e fim diferentes (HH:MM)." : null,
    days: days.length === 0 ? "Escolha ao menos um dia." : null,
  }
  const invalid = Object.values(errors).some(Boolean) || breakErrors.some(Boolean)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setShow(true)
        if (invalid) return
        onSave({ id: shift?.id ?? null, name: name.trim(), start, end, days: days.map(Number).sort(), breaks: breaks.map((b) => ({ ...b, name: b.name.trim() })) })
      }}
    >
      <DialogHeader className="border-b px-6 pt-6 pb-4">
        <DialogTitle>{shift ? `Editar ${shift.name}` : "Novo turno"}</DialogTitle>
        <DialogDescription>{unitName} · horários no fuso da unidade. Turnos que passam da meia-noite pertencem à data de início.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-5 px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem]">
          <Field data-invalid={show && !!errors.name}>
            <FieldLabel htmlFor="sh-name">Nome</FieldLabel>
            <Input id="sh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: 1º turno" autoFocus />
            {show && errors.name && <FieldError>{errors.name}</FieldError>}
          </Field>
          <Field data-invalid={show && !!errors.times}>
            <FieldLabel htmlFor="sh-start">Início</FieldLabel>
            <Input id="sh-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="font-mono" />
          </Field>
          <Field data-invalid={show && !!errors.times}>
            <FieldLabel htmlFor="sh-end">Fim</FieldLabel>
            <Input id="sh-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="font-mono" />
          </Field>
        </div>
        {show && errors.times && <p className="-mt-3 text-xs text-destructive">{errors.times}</p>}

        <Field data-invalid={show && !!errors.days}>
          <FieldLabel>Dias da semana</FieldLabel>
          <ToggleGroup type="multiple" variant="outline" value={days} onValueChange={setDays} className="w-full">
            {WEEKDAYS.map((w) => (
              <ToggleGroupItem key={w.d} value={String(w.d)} className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground" aria-label={w.label}>
                {w.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {show && errors.days ? (
            <FieldError>{errors.days}</FieldError>
          ) : (
            <FieldDescription className="text-xs">Nos dias desmarcados o turno não existe: o tempo não entra no planejado.</FieldDescription>
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Pausas</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setBreaks((b) => [...b, { name: "Café", start: start, end: start }])}>
              <PlusIcon />
              Adicionar pausa
            </Button>
          </div>
          {breaks.length === 0 && <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Sem pausas: todo o turno conta como tempo planejado.</p>}
          {breaks.map((b, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_2rem] items-center gap-2">
                <Input
                  value={b.name}
                  onChange={(e) => setBreaks((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  className="h-8"
                  aria-label="Nome da pausa"
                />
                <Input
                  type="time"
                  value={b.start}
                  onChange={(e) => setBreaks((list) => list.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                  className="h-8 font-mono"
                  aria-label="Início da pausa"
                />
                <Input
                  type="time"
                  value={b.end}
                  onChange={(e) => setBreaks((list) => list.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                  className="h-8 font-mono"
                  aria-label="Fim da pausa"
                />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setBreaks((list) => list.filter((_, j) => j !== i))} aria-label={`Remover ${b.name}`}>
                  <Trash2Icon />
                </Button>
              </div>
              {show && breakErrors[i] && <span className="text-xs text-destructive">{breakErrors[i]}</span>}
            </div>
          ))}
        </div>

        {m && (
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/60 p-3 text-center">
            <div>
              <div className="text-[11px] text-muted-foreground">Duração</div>
              <div className="text-sm font-semibold tabular-nums">{hoursLabel(m.total)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Pausas</div>
              <div className="text-sm font-semibold tabular-nums">{hoursLabel(m.breaks)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Tempo planejado</div>
              <div className="text-sm font-semibold text-primary tabular-nums">{hoursLabel(m.planned)}</div>
            </div>
            {crossesMidnight && (
              <div className="col-span-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <MoonIcon className="size-3" />
                Atravessa a meia-noite: termina às {end} do dia seguinte.
              </div>
            )}
          </div>
        )}
      </div>

      <DialogFooter className="border-t px-6 py-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">{shift ? "Salvar turno" : "Criar turno"}</Button>
      </DialogFooter>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Parada planejada
// ---------------------------------------------------------------------------

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: "Não repete",
  weekly: "Toda semana",
  monthly: "Todo mês",
}

export function PlannedStopDialog({
  open,
  onOpenChange,
  stop,
  unitName,
  today,
  reasons,
  machines,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  stop: PlannedStop | null
  unitName: string
  today: string
  reasons: { id: string; name: string; group: string }[]
  machines: { id: string; name: string; code: string }[]
  onSave: (p: Omit<PlannedStop, "id" | "unitId"> & { id: string | null }) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {open && (
          <StopForm
            key={stop?.id ?? "new"}
            stop={stop}
            unitName={unitName}
            today={today}
            reasons={reasons}
            machines={machines}
            onSave={onSave}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function StopForm({
  stop,
  unitName,
  today,
  reasons,
  machines,
  onSave,
  onCancel,
}: {
  stop: PlannedStop | null
  unitName: string
  today: string
  reasons: { id: string; name: string; group: string }[]
  machines: { id: string; name: string; code: string }[]
  onSave: (p: Omit<PlannedStop, "id" | "unitId"> & { id: string | null }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(stop?.title ?? "")
  const [reasonId, setReasonId] = useState(stop?.reasonId ?? reasons.find((r) => /preventiva/i.test(r.name))?.id ?? reasons[0]?.id ?? "")
  const [scopeKind, setScopeKind] = useState<"unit" | "machines">(stop && stop.scope !== "unit" ? "machines" : "unit")
  const [picked, setPicked] = useState<string[]>(stop && stop.scope !== "unit" ? stop.scope : [])
  const [startDate, setStartDate] = useState(stop?.startDate ?? today)
  const [startTime, setStartTime] = useState(stop?.startTime ?? "06:00")
  const wasAllDay = stop ? stop.startTime === "00:00" && stop.endTime === "00:00" : false
  // Em "dia inteiro" o fim guardado é 00:00 do dia seguinte; o formulário mostra o último dia.
  const [endDate, setEndDate] = useState(stop ? (wasAllDay ? addDays(stop.endDate, -1) : stop.endDate) : today)
  const [endTime, setEndTime] = useState(stop?.endTime ?? "10:00")
  const [allDay, setAllDay] = useState(wasAllDay)
  const [recurrence, setRecurrence] = useState<Recurrence>(stop?.recurrence ?? "none")
  const [show, setShow] = useState(false)

  const datesOk = DATE_RE.test(startDate) && DATE_RE.test(endDate)
  const draft = {
    startDate,
    startTime: allDay ? "00:00" : startTime,
    endDate: allDay && datesOk ? addDays(endDate, 1) : endDate,
    endTime: allDay ? "00:00" : endTime,
  }
  const minutes = datesOk && TIME_RE.test(draft.startTime) && TIME_RE.test(draft.endTime) ? stopMinutes(draft) : NaN

  const errors = {
    title: title.trim().length < 3 ? "Descreva a parada (ex.: Manutenção preventiva mensal)." : null,
    reasonId: !reasonId ? "Escolha o motivo." : null,
    scope: scopeKind === "machines" && picked.length === 0 ? "Escolha ao menos uma máquina." : null,
    period: !(minutes > 0) ? "O fim precisa ser depois do início." : null,
  }
  const invalid = Object.values(errors).some(Boolean)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setShow(true)
        if (invalid) return
        onSave({
          id: stop?.id ?? null,
          title: title.trim(),
          reasonId,
          scope: scopeKind === "unit" ? "unit" : picked,
          ...draft,
          recurrence,
        })
      }}
    >
      <DialogHeader className="border-b px-6 pt-6 pb-4">
        <DialogTitle>{stop ? "Editar parada planejada" : "Nova parada planejada"}</DialogTitle>
        <DialogDescription>{unitName} · o intervalo sai do tempo planejado e não penaliza o OEE das máquinas escolhidas.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-5 px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={show && !!errors.title} className="sm:col-span-2">
            <FieldLabel htmlFor="ps-title">Descrição</FieldLabel>
            <Input id="ps-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Manutenção preventiva das injetoras" autoFocus />
            {show && errors.title && <FieldError>{errors.title}</FieldError>}
          </Field>
          <Field data-invalid={show && !!errors.reasonId}>
            <FieldLabel htmlFor="ps-reason">Motivo</FieldLabel>
            <Select value={reasonId} onValueChange={setReasonId}>
              <SelectTrigger id="ps-reason" className="w-full">
                <SelectValue placeholder="Escolha o motivo" />
              </SelectTrigger>
              <SelectContent>
                {reasons.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                    <span className="text-xs text-muted-foreground">{r.group}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {show && errors.reasonId && <FieldError>{errors.reasonId}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="ps-rec">Repetição</FieldLabel>
            <Select value={recurrence} onValueChange={(v) => setRecurrence(v as Recurrence)}>
              <SelectTrigger id="ps-rec" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {RECURRENCE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Período</span>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={allDay} onCheckedChange={setAllDay} />
              Dia inteiro
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="ps-sd" className="text-xs">
                Início
              </FieldLabel>
              <Input id="ps-sd" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field className={cn(allDay && "opacity-50")}>
              <FieldLabel htmlFor="ps-st" className="text-xs">
                Hora
              </FieldLabel>
              <Input id="ps-st" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={allDay} className="font-mono" />
            </Field>
            <Field>
              <FieldLabel htmlFor="ps-ed" className="text-xs">
                {allDay ? "Último dia" : "Fim"}
              </FieldLabel>
              <Input id="ps-ed" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field className={cn(allDay && "opacity-50")}>
              <FieldLabel htmlFor="ps-et" className="text-xs">
                Hora
              </FieldLabel>
              <Input id="ps-et" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={allDay} className="font-mono" />
            </Field>
          </div>
          {show && errors.period ? (
            <p className="text-xs text-destructive">{errors.period}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{minutes > 0 ? `Duração: ${hoursLabel(minutes)}` : "Informe o período."}</p>
          )}
        </div>

        <Field data-invalid={show && !!errors.scope}>
          <FieldLabel>Aplica-se a</FieldLabel>
          <RadioGroup value={scopeKind} onValueChange={(v) => setScopeKind(v as "unit" | "machines")} className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="unit" />
              Unidade inteira
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="machines" />
              Máquinas específicas
            </label>
          </RadioGroup>
          {scopeKind === "machines" && (
            <div className="grid gap-1.5 rounded-xl border p-2 sm:grid-cols-2">
              {machines.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/60">
                  <Checkbox
                    checked={picked.includes(m.id)}
                    onCheckedChange={(c) => setPicked((p) => (c === true ? [...p, m.id] : p.filter((x) => x !== m.id)))}
                  />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{m.code}</span>
                </label>
              ))}
              {machines.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">Nenhuma máquina nesta unidade.</p>}
            </div>
          )}
          {show && errors.scope ? (
            <FieldError>{errors.scope}</FieldError>
          ) : (
            scopeKind === "machines" && <FieldDescription className="text-xs">{plural(picked.length, "máquina selecionada", "máquinas selecionadas")}</FieldDescription>
          )}
        </Field>

        <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <CoffeeIcon className="mt-0.5 size-3.5 shrink-0" />
          Pausas fixas (refeição, café) ficam no cadastro do turno. Use parada planejada para eventos com data: preventivas, feriados, inventário, falta de programação.
        </p>
      </div>

      <DialogFooter className="border-t px-6 py-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">{stop ? "Salvar parada" : "Agendar parada"}</Button>
      </DialogFooter>
    </form>
  )
}
