"use client"

import { useState } from "react"
import { CopyIcon, InfoIcon, LoaderCircleIcon, MonitorIcon, MoonIcon, RefreshCwIcon, SunIcon, SunMoonIcon, TabletSmartphoneIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { PairingQr } from "@/components/settings/pairing-qr"
import type { SettingsUnit, TerminalKind, TerminalLine, TerminalMachine, TerminalRow, TerminalTheme } from "@/components/settings/types"

export const KIND_LABEL: Record<TerminalKind, string> = { andon_tv: "TV Andon", operator_tablet: "Tablet do operador" }
export const THEME_LABEL: Record<TerminalTheme, string> = { dark: "Escuro", light: "Claro", system: "Automático" }
export const PAIRING_HOST = "oee.engemase.com.br/terminal"

export interface TerminalFormValue {
  name: string
  kind: TerminalKind
  unitId: string
  lineIds: string[]
  machineIds: string[]
  theme: TerminalTheme
}

const KINDS: { value: TerminalKind; icon: typeof MonitorIcon; title: string; hint: string }[] = [
  { value: "andon_tv", icon: MonitorIcon, title: "TV Andon", hint: "Painel da linha em tela cheia, só leitura. Ideal para TV de 43\" ou maior." },
  { value: "operator_tablet", icon: TabletSmartphoneIcon, title: "Tablet do operador", hint: "Na máquina: classificar paradas, lançar refugo e trocar produto." },
]

const THEMES: { value: TerminalTheme; icon: typeof SunIcon }[] = [
  { value: "dark", icon: MoonIcon },
  { value: "light", icon: SunIcon },
  { value: "system", icon: SunMoonIcon },
]

/** Código de 6 dígitos no formato "482 917" (gerado só em handlers). */
export function newPairingCode() {
  const n = Math.floor(100000 + Math.random() * 900000)
  return `${String(n).slice(0, 3)} ${String(n).slice(3)}`
}

export function TerminalDialog({
  open,
  onOpenChange,
  editing,
  units,
  lines,
  machines,
  onCreate,
  onSave,
  onSimulateConnect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Terminal em edição ou pendente (mostra o código); `null` = novo. */
  editing: { row: TerminalRow; mode: "edit" | "code" } | null
  units: SettingsUnit[]
  lines: TerminalLine[]
  machines: TerminalMachine[]
  onCreate: (value: TerminalFormValue, code: string) => void
  onSave: (id: string, value: TerminalFormValue) => void
  onSimulateConnect: (value: TerminalFormValue, code: string, id: string | null) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {open && (
          <TerminalForm
            key={editing ? `${editing.row.id}-${editing.mode}` : "new"}
            editing={editing}
            units={units}
            lines={lines}
            machines={machines}
            onCancel={() => onOpenChange(false)}
            onCreate={onCreate}
            onSave={onSave}
            onSimulateConnect={onSimulateConnect}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function TerminalForm({
  editing,
  units,
  lines,
  machines,
  onCancel,
  onCreate,
  onSave,
  onSimulateConnect,
}: {
  editing: { row: TerminalRow; mode: "edit" | "code" } | null
  units: SettingsUnit[]
  lines: TerminalLine[]
  machines: TerminalMachine[]
  onCancel: () => void
  onCreate: (value: TerminalFormValue, code: string) => void
  onSave: (id: string, value: TerminalFormValue) => void
  onSimulateConnect: (value: TerminalFormValue, code: string, id: string | null) => void
}) {
  const row = editing?.row
  const [kind, setKind] = useState<TerminalKind>(row?.kind ?? "andon_tv")
  const [name, setName] = useState(row?.name ?? "")
  const [unitId, setUnitId] = useState(row?.unitId ?? units[0]?.id ?? "")
  const [lineIds, setLineIds] = useState<string[]>(row?.lineIds ?? [])
  const [machineIds, setMachineIds] = useState<string[]>(row?.machineIds ?? [])
  const [theme, setTheme] = useState<TerminalTheme>(row?.theme ?? "dark")
  const [code, setCode] = useState<string | null>(editing?.mode === "code" ? row?.pairingCode ?? null : null)
  const [touched, setTouched] = useState(false)

  const unitLines = lines.filter((l) => l.unitId === unitId)
  const unitMachines = machines.filter((m) => m.unitId === unitId)
  const isEdit = editing?.mode === "edit"

  const value: TerminalFormValue = {
    name: name.trim(),
    kind,
    unitId,
    lineIds: kind === "andon_tv" ? lineIds : [],
    machineIds: kind === "operator_tablet" ? machineIds : [],
    theme,
  }

  const errors = {
    name: value.name.length < 3 ? "Dê um nome que identifique o aparelho no chão de fábrica." : null,
    scope:
      kind === "andon_tv"
        ? lineIds.length === 0
          ? "Escolha ao menos uma linha para a TV mostrar."
          : null
        : machineIds.length === 0
          ? "Escolha ao menos uma máquina para o tablet."
          : null,
  }
  const valid = !errors.name && !errors.scope

  const suggestName = (k: TerminalKind, ls: string[], ms: string[]) => {
    if (name.trim() && touched) return
    if (k === "andon_tv" && ls.length) setName(`TV ${lines.find((l) => l.id === ls[0])?.name ?? ""}${ls.length > 1 ? ` +${ls.length - 1}` : ""}`)
    if (k === "operator_tablet" && ms.length) {
      const names = ms.map((id) => machines.find((m) => m.id === id)?.name ?? "")
      setName(`Tablet ${names.slice(0, 2).join(" e ")}${names.length > 2 ? ` +${names.length - 2}` : ""}`)
    }
  }

  const changeKind = (k: TerminalKind) => {
    setKind(k)
    setTheme(k === "andon_tv" ? "dark" : "system")
    suggestName(k, lineIds, machineIds)
  }
  const changeUnit = (u: string) => {
    setUnitId(u)
    setLineIds([])
    setMachineIds([])
  }
  const toggleLine = (id: string, on: boolean) => {
    const next = on ? [...lineIds, id] : lineIds.filter((x) => x !== id)
    setLineIds(next)
    suggestName(kind, next, machineIds)
  }
  const toggleMachine = (id: string, on: boolean) => {
    const next = on ? [...machineIds, id] : machineIds.filter((x) => x !== id)
    setMachineIds(next)
    suggestName(kind, lineIds, next)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!valid) return
    if (isEdit && row) {
      onSave(row.id, value)
      return
    }
    setCode(newPairingCode())
  }

  // ------------------------------------------------------------------ código
  if (code) {
    const pendingId = editing?.mode === "code" ? (row?.id ?? null) : null
    return (
      <div className="grid gap-5">
        <DialogHeader>
          <DialogTitle>Código de pareamento · {value.name || row?.name}</DialogTitle>
          <DialogDescription>Faça isto no próprio aparelho ({KIND_LABEL[kind]}). O código vale por 10 minutos e só pode ser usado uma vez.</DialogDescription>
        </DialogHeader>
        <div className="grid items-center gap-5 rounded-2xl bg-muted/60 p-5 sm:grid-cols-[auto_1fr]">
          <div className="mx-auto rounded-2xl border bg-card p-3 shadow-xs">
            <PairingQr code={code} />
          </div>
          <div className="grid gap-3 text-center sm:text-left">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Código</div>
              <div className="font-mono text-4xl font-bold tracking-[0.18em] tabular-nums">{code}</div>
            </div>
            <ol className="grid gap-1.5 text-left text-sm">
              <li>
                <span className="font-semibold text-primary">1.</span> No navegador do aparelho, abra <span className="font-mono text-xs font-semibold">{PAIRING_HOST}</span>
              </li>
              <li>
                <span className="font-semibold text-primary">2.</span> Digite o código acima ou leia o QR com a câmera
              </li>
              <li>
                <span className="font-semibold text-primary">3.</span> Pronto: a tela abre direto no que foi escolhido aqui
              </li>
            </ol>
            <div className="inline-flex items-center justify-center gap-2 text-xs text-muted-foreground sm:justify-start">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              Aguardando o aparelho digitar o código…
            </div>
          </div>
        </div>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          O aparelho recebe um token próprio de terminal (não é login de pessoa), com prazo de 12 meses. Você pode revogar a qualquer momento nesta tela.
        </p>
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(code.replace(" ", "")).catch(() => undefined)
                toast.success("Código copiado")
              }}
            >
              <CopyIcon />
              Copiar
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCode(newPairingCode())
                toast("Novo código gerado", { description: "O código anterior deixou de valer." })
              }}
            >
              <RefreshCwIcon />
              Gerar outro
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="ghost" onClick={() => onSimulateConnect(value, code, pendingId)}>
              Simular aparelho conectado
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (pendingId) onCancel()
                else onCreate(value, code)
              }}
            >
              Concluir
            </Button>
          </div>
        </DialogFooter>
      </div>
    )
  }

  // ------------------------------------------------------------------ formulário
  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{isEdit ? `Editar terminal · ${row?.name}` : "Parear novo terminal"}</DialogTitle>
        <DialogDescription>
          {isEdit ? "O aparelho recebe as mudanças em até 1 minuto, sem precisar parear de novo." : "Escolha o que o aparelho vai mostrar. Em seguida geramos um código de 6 dígitos para digitar nele."}
        </DialogDescription>
      </DialogHeader>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Tipo de terminal</legend>
        <RadioGroup value={kind} onValueChange={(v) => changeKind(v as TerminalKind)} className="grid gap-2 sm:grid-cols-2" disabled={isEdit}>
          {KINDS.map((k) => (
            <Label
              key={k.value}
              htmlFor={`kind-${k.value}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal transition hover:bg-muted/50",
                kind === k.value && "border-primary bg-primary/5 ring-1 ring-primary/30",
                isEdit && kind !== k.value && "opacity-50",
              )}
            >
              <RadioGroupItem id={`kind-${k.value}`} value={k.value} className="sr-only" />
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", kind === k.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                <k.icon className="size-4" />
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm font-semibold">{k.title}</span>
                <span className="text-xs leading-snug text-muted-foreground">{k.hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="trm-unit">Unidade</Label>
          <Select value={unitId} onValueChange={changeUnit} disabled={isEdit}>
            <SelectTrigger id="trm-unit" className="w-full">
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
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="trm-name">Nome do terminal</Label>
          <Input
            id="trm-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setTouched(true)
            }}
            placeholder={kind === "andon_tv" ? "Ex.: TV Linha Injeção A" : "Ex.: Tablet Injetoras 01–02"}
            maxLength={40}
            aria-invalid={touched && !!errors.name}
          />
          {touched && errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">{kind === "andon_tv" ? "Linhas que a TV mostra" : "Máquinas do tablet"}</legend>
        {kind === "andon_tv" ? (
          unitLines.length === 0 ? (
            <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">Esta unidade ainda não tem linhas cadastradas.</p>
          ) : (
            <div className="grid gap-2 rounded-xl bg-muted/50 p-3 sm:grid-cols-2">
              {unitLines.map((l) => (
                <Label key={l.id} htmlFor={`ln-${l.id}`} className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-card px-3 py-2 font-normal">
                  <Checkbox id={`ln-${l.id}`} checked={lineIds.includes(l.id)} onCheckedChange={(c) => toggleLine(l.id, c === true)} />
                  <span className="text-sm">{l.name}</span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">{l.code}</span>
                </Label>
              ))}
            </div>
          )
        ) : unitMachines.length === 0 ? (
          <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">Esta unidade ainda não tem máquinas cadastradas.</p>
        ) : (
          <div className="grid gap-3 rounded-xl bg-muted/50 p-3">
            {unitLines
              .filter((l) => unitMachines.some((m) => m.lineId === l.id))
              .map((l) => (
                <div key={l.id} className="grid gap-1.5">
                  <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{l.name}</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {unitMachines
                      .filter((m) => m.lineId === l.id)
                      .map((m) => (
                        <Label key={m.id} htmlFor={`mc-${m.id}`} className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-card px-3 py-2 font-normal">
                          <Checkbox id={`mc-${m.id}`} checked={machineIds.includes(m.id)} onCheckedChange={(c) => toggleMachine(m.id, c === true)} />
                          <span className="text-sm">{m.name}</span>
                          <span className="ml-auto font-mono text-[11px] text-muted-foreground">{m.code}</span>
                        </Label>
                      ))}
                  </div>
                </div>
              ))}
            {machineIds.length > 4 && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-state-stopped">
                <TriangleAlertIcon className="size-3.5" />
                Mais de 4 máquinas num tablet dificulta o apontamento. Considere um tablet por posto.
              </p>
            )}
          </div>
        )}
        {touched && errors.scope && <p className="text-xs text-destructive">{errors.scope}</p>}
      </fieldset>

      <div className="grid gap-1.5">
        <Label>Tema da tela</Label>
        <ToggleGroup type="single" variant="outline" value={theme} onValueChange={(v) => v && setTheme(v as TerminalTheme)} className="bg-card">
          {THEMES.map((t) => (
            <ToggleGroupItem key={t.value} value={t.value} className="gap-1.5 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              <t.icon className="size-4" />
              {THEME_LABEL[t.value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">Tema próprio do terminal: não muda o tema de nenhuma pessoa. Para TV, o escuro cansa menos a vista e destaca os estados.</p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={touched && !valid}>
          {isEdit ? "Salvar alterações" : "Gerar código de pareamento"}
        </Button>
      </DialogFooter>
    </form>
  )
}
