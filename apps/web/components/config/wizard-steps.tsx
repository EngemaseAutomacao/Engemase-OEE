"use client"

import { ActivityIcon, BinaryIcon, CpuIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { STATE_META } from "@/lib/states"
import type { MachineState, StateMode } from "@/lib/mock/types"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StateDot } from "@/components/oee/state-badge"
import { STATE_MODE_HINT, STATE_MODE_LABEL, piecesPerHour } from "@/components/config/labels"
import { toNum, type Errors, type IdentDraft, type RulesDraft, type WizardLine, type WizardUnit } from "@/components/config/wizard-model"

/** Sugere um código a partir do nome: "Injetora 07" → "INJ-07". */
export function suggestCode(name: string): string {
  const parts = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return ""
  const num = parts.find((p) => /^\d+$/.test(p))
  const word = parts.find((p) => /[A-Z]/.test(p)) ?? ""
  return [word.slice(0, 3), num].filter(Boolean).join("-")
}

// ---------------------------------------------------------------------------
// Etapa 1 — Identificação
// ---------------------------------------------------------------------------

export function IdentStep({
  draft,
  onChange,
  errors,
  show,
  units,
  lines,
  machineTypes,
}: {
  draft: IdentDraft
  onChange: (patch: Partial<IdentDraft>) => void
  errors: Errors
  show: boolean
  units: WizardUnit[]
  lines: WizardLine[]
  machineTypes: string[]
}) {
  const err = (k: string) => (show ? (errors[k] ?? null) : null)
  const unitLines = lines.filter((l) => l.unitId === draft.unitId)
  const areaNames = [...new Set(unitLines.map((l) => l.areaName))]
  const suggestion = suggestCode(draft.name)

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Field data-invalid={!!err("name")}>
        <FieldLabel htmlFor="wz-name">Nome da máquina</FieldLabel>
        <Input id="wz-name" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Ex.: Injetora 07" autoFocus aria-invalid={!!err("name")} />
        {err("name") ? <FieldError>{err("name")}</FieldError> : <FieldDescription className="text-xs">Como aparece no dashboard, na TV e na tela do operador.</FieldDescription>}
      </Field>
      <Field data-invalid={!!err("code")}>
        <FieldLabel htmlFor="wz-code">Código</FieldLabel>
        <Input
          id="wz-code"
          value={draft.code}
          onChange={(e) => onChange({ code: e.target.value.toUpperCase() })}
          placeholder={suggestion || "Ex.: INJ-07"}
          className="font-mono uppercase"
          maxLength={16}
          aria-invalid={!!err("code")}
        />
        {err("code") ? (
          <FieldError>{err("code")}</FieldError>
        ) : suggestion && !draft.code ? (
          <FieldDescription className="text-xs">
            Sugestão:{" "}
            <button type="button" className="font-mono font-medium text-foreground underline underline-offset-4" onClick={() => onChange({ code: suggestion })}>
              {suggestion}
            </button>
          </FieldDescription>
        ) : (
          <FieldDescription className="text-xs">Identificador curto e único no cliente (patrimônio ou TAG da máquina).</FieldDescription>
        )}
      </Field>
      <Field data-invalid={!!err("type")}>
        <FieldLabel htmlFor="wz-type">Tipo</FieldLabel>
        <Select value={draft.type} onValueChange={(v) => onChange({ type: v })}>
          <SelectTrigger id="wz-type" className="w-full" aria-invalid={!!err("type")}>
            <SelectValue placeholder="Escolha o tipo" />
          </SelectTrigger>
          <SelectContent>
            {machineTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {err("type") ? <FieldError>{err("type")}</FieldError> : <FieldDescription className="text-xs">Usado para sugerir templates de sinais de máquinas iguais.</FieldDescription>}
      </Field>
      <div className="hidden md:block" />
      <Field data-invalid={!!err("unitId")}>
        <FieldLabel htmlFor="wz-unit">Unidade</FieldLabel>
        <Select
          value={draft.unitId}
          onValueChange={(v) => onChange({ unitId: v, lineId: lines.find((l) => l.unitId === v)?.id ?? "" })}
        >
          <SelectTrigger id="wz-unit" className="w-full" aria-invalid={!!err("unitId")}>
            <SelectValue placeholder="Escolha a unidade" />
          </SelectTrigger>
          <SelectContent>
            {units.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError>{err("unitId")}</FieldError>
      </Field>
      <Field data-invalid={!!err("lineId")}>
        <FieldLabel htmlFor="wz-line">Linha</FieldLabel>
        <Select value={draft.lineId} onValueChange={(v) => onChange({ lineId: v })} disabled={unitLines.length === 0}>
          <SelectTrigger id="wz-line" className="w-full" aria-invalid={!!err("lineId")}>
            <SelectValue placeholder={unitLines.length ? "Escolha a linha" : "Nenhuma linha nesta unidade"} />
          </SelectTrigger>
          <SelectContent>
            {areaNames.map((area) => (
              <SelectGroup key={area}>
                <SelectLabel>{area}</SelectLabel>
                {unitLines
                  .filter((l) => l.areaName === area)
                  .map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                      <span className="font-mono text-xs text-muted-foreground">{l.code}</span>
                    </SelectItem>
                  ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <FieldError>{err("lineId")}</FieldError>
      </Field>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Etapa 4 — Regras de OEE
// ---------------------------------------------------------------------------

const MODE_ICON: Record<StateMode, typeof ActivityIcon> = {
  signals: ActivityIcon,
  state_code: BinaryIcon,
  count_derived: CpuIcon,
}

const MAP_STATES: Exclude<MachineState, "NO_COMM">[] = ["RUNNING", "STOPPED", "FAULT", "SETUP", "PLANNED_STOP"]

export function RulesStep({
  draft,
  onChange,
  errors,
  show,
}: {
  draft: RulesDraft
  onChange: (patch: Partial<RulesDraft>) => void
  errors: Errors
  show: boolean
}) {
  const err = (k: string) => (show ? (errors[k] ?? null) : null)
  const cycle = toNum(draft.idealCycleS)
  const idleS = cycle > 0 && toNum(draft.idleAfterCycles) > 0 ? cycle * toNum(draft.idleAfterCycles) : null

  const updateMap = (key: string, patch: Partial<RulesDraft["stateMap"][number]>) =>
    onChange({ stateMap: draft.stateMap.map((r) => (r.key === key ? { ...r, ...patch } : r)) })

  return (
    <div className="flex flex-col gap-6">
      <Field data-invalid={!!err("stateMode")}>
        <FieldLabel>Modo de estado</FieldLabel>
        <RadioGroup value={draft.stateMode} onValueChange={(v) => onChange({ stateMode: v as StateMode })} className="grid gap-3 lg:grid-cols-3">
          {(Object.keys(STATE_MODE_LABEL) as StateMode[]).map((m) => {
            const Icon = MODE_ICON[m]
            return (
              <FieldLabel key={m} htmlFor={`wz-mode-${m}`}>
                <Field orientation="horizontal">
                  <Icon className="mt-0.5 size-5 text-muted-foreground" />
                  <FieldContent>
                    <FieldTitle>{STATE_MODE_LABEL[m]}</FieldTitle>
                    <FieldDescription className="text-xs">{STATE_MODE_HINT[m]}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value={m} id={`wz-mode-${m}`} />
                </Field>
              </FieldLabel>
            )
          })}
        </RadioGroup>
        <FieldError>{err("stateMode")}</FieldError>
      </Field>

      {draft.stateMode === "state_code" && (
        <div className="flex flex-col gap-3 rounded-lg border p-3 sm:p-4">
          <div>
            <div className="text-sm font-medium">Mapa do código de estado</div>
            <p className="text-xs text-muted-foreground">Valor do registrador “Código de estado” do CLP → estado de OEE. Valores não mapeados contam como parada.</p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="hidden grid-cols-[5rem_minmax(0,1fr)_minmax(0,1.2fr)_2.25rem] gap-2 px-0.5 text-xs font-medium text-muted-foreground sm:grid">
              <span>Valor</span>
              <span>Significado no CLP</span>
              <span>Estado de OEE</span>
              <span />
            </div>
            {draft.stateMap.map((row) => (
              <div key={row.key} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.25rem] gap-2 sm:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1.2fr)_2.25rem]">
                <Input
                  value={row.code}
                  onChange={(e) => updateMap(row.key, { code: e.target.value.replace(/\D/g, "") })}
                  className="h-8 font-mono"
                  inputMode="numeric"
                  aria-label="Valor no CLP"
                />
                <Input value={row.label} onChange={(e) => updateMap(row.key, { label: e.target.value })} className="h-8" aria-label="Significado no CLP" />
                <Select value={row.state} onValueChange={(v) => updateMap(row.key, { state: v as RulesDraft["stateMap"][number]["state"] })}>
                  <SelectTrigger size="sm" className="col-span-2 w-full sm:col-span-1" aria-label="Estado de OEE">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MAP_STATES.map((s) => (
                      <SelectItem key={s} value={s}>
                        <StateDot state={s} />
                        {STATE_META[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto"
                  onClick={() => onChange({ stateMap: draft.stateMap.filter((r) => r.key !== row.key) })}
                  aria-label={`Remover valor ${row.code}`}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const next = Math.max(-1, ...draft.stateMap.map((r) => Number(r.code) || 0)) + 1
                onChange({ stateMap: [...draft.stateMap, { key: `sm_${draft.stateMap.length}_${next}`, code: String(next), label: "", state: "STOPPED" }] })
              }}
            >
              <PlusIcon />
              Adicionar valor
            </Button>
            {err("stateMap") && <span className="text-xs text-destructive">{err("stateMap")}</span>}
          </div>
        </div>
      )}

      {draft.stateMode === "count_derived" && (
        <Field data-invalid={!!err("idleAfterCycles")} className="rounded-lg border p-3 sm:p-4">
          <FieldLabel htmlFor="wz-idle">Considerar parada após</FieldLabel>
          <div className="flex flex-wrap items-center gap-3">
            <InputGroup className="w-40">
              <InputGroupInput id="wz-idle" value={draft.idleAfterCycles} onChange={(e) => onChange({ idleAfterCycles: e.target.value })} inputMode="numeric" aria-invalid={!!err("idleAfterCycles")} />
              <InputGroupAddon align="inline-end">
                <InputGroupText>ciclos</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <span className="text-sm text-muted-foreground">
              {idleS !== null ? `sem peça = ${idleS.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s com o ciclo ideal atual` : "informe o ciclo ideal abaixo"}
            </span>
          </div>
          <FieldError>{err("idleAfterCycles")}</FieldError>
        </Field>
      )}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <NumberField
          id="wz-cycle"
          label="Ciclo ideal"
          unit="s"
          value={draft.idealCycleS}
          onChange={(v) => onChange({ idealCycleS: v })}
          error={err("idealCycleS")}
          hint={cycle > 0 ? `${piecesPerHour(cycle)} · produtos podem ter ciclo próprio` : "Tempo de ciclo da máquina na velocidade nominal."}
          inputMode="decimal"
          placeholder="Ex.: 18"
        />
        <NumberField
          id="wz-micro"
          label="Limite de micro-parada"
          unit="s"
          value={draft.microStopS}
          onChange={(v) => onChange({ microStopS: v })}
          error={err("microStopS")}
          hint="Paradas menores contam como perda de performance e não pedem motivo."
        />
        <NumberField
          id="wz-debounce"
          label="Debounce"
          unit="s"
          value={draft.debounceS}
          onChange={(v) => onChange({ debounceS: v })}
          error={err("debounceS")}
          hint="Tempo que o sinal precisa ficar estável para virar mudança de estado."
          inputMode="decimal"
        />
        <NumberField
          id="wz-comm"
          label="Sem comunicação após"
          unit="s"
          value={draft.commLossS}
          onChange={(v) => onChange({ commLossS: v })}
          error={err("commLossS")}
          hint="Sem leitura por esse tempo, o estado vira “Sem comunicação”."
        />
      </div>
    </div>
  )
}

function NumberField({
  id,
  label,
  unit,
  value,
  onChange,
  error,
  hint,
  inputMode = "numeric",
  placeholder,
}: {
  id: string
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
  error: string | null
  hint: string
  inputMode?: "numeric" | "decimal"
  placeholder?: string
}) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput id={id} value={value} onChange={(e) => onChange(e.target.value)} inputMode={inputMode} placeholder={placeholder} aria-invalid={!!error} />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{unit}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      {error ? <FieldError>{error}</FieldError> : <FieldDescription className="text-xs">{hint}</FieldDescription>}
    </Field>
  )
}
