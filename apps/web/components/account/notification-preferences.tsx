"use client"

import { useId, useState } from "react"
import { BellIcon, LockIcon, MailIcon, MessageCircleIcon, MoonStarIcon, RotateCcwIcon, SaveIcon, SmartphoneIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import type { ScopeUnit } from "./account-data"
import { ALERT_TYPE_META, DEFAULT_CHANNELS, PREF_ALERT_TYPES, SEVERITY_META, type PrefAlertType } from "./labels"

interface TypePref {
  on: boolean
  push: boolean
  email: boolean
}

const defaultTypes = (): Record<PrefAlertType, TypePref> =>
  Object.fromEntries(
    PREF_ALERT_TYPES.map((t) => [t, { on: t !== "remote_access_session", push: DEFAULT_CHANNELS[t].push, email: DEFAULT_CHANNELS[t].email }]),
  ) as Record<PrefAlertType, TypePref>

const DAYS = [
  { v: "1", l: "Seg" },
  { v: "2", l: "Ter" },
  { v: "3", l: "Qua" },
  { v: "4", l: "Qui" },
  { v: "5", l: "Sex" },
  { v: "6", l: "Sáb" },
  { v: "0", l: "Dom" },
]

function ColHead({ icon: Icon, label, soon }: { icon: typeof BellIcon; label: string; soon?: boolean }) {
  return (
    <th scope="col" className="w-20 px-2 pb-2 text-center align-bottom font-medium">
      <span className="inline-flex flex-col items-center gap-1">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-xs">{label}</span>
        {soon && <span className="rounded-full bg-[#e96549]/12 px-1.5 text-[10px] font-semibold text-[#cf5539]">em breve</span>}
      </span>
    </th>
  )
}

/** Preferências de alerta do usuário neste cliente: tipos × canais, escopo e horário de silêncio (docs/13). */
export function NotificationPreferences({
  scope,
  isPlatform,
  email,
  clientName,
}: {
  scope: ScopeUnit[]
  isPlatform: boolean
  email: string
  clientName: string
}) {
  const uid = useId()
  const allMachines = scope.flatMap((u) => u.machines.map((m) => m.id))

  const [types, setTypes] = useState(defaultTypes)
  const [scopeMode, setScopeMode] = useState<"all" | "custom">("all")
  const [machines, setMachines] = useState<string[]>(allMachines)
  const [quiet, setQuiet] = useState({ enabled: true, start: "22:00", end: "06:00", days: ["1", "2", "3", "4", "5", "6", "0"], critical: true })
  const [digest, setDigest] = useState({ shift: true, daily: false })
  const [dirty, setDirty] = useState(false)

  const visibleTypes = PREF_ALERT_TYPES.filter((t) => isPlatform || !ALERT_TYPE_META[t].platformOnly)

  function touch() {
    setDirty(true)
  }
  function setType(t: PrefAlertType, patch: Partial<TypePref>) {
    setTypes((s) => ({ ...s, [t]: { ...s[t], ...patch } }))
    touch()
  }
  function toggleMachine(id: string, on: boolean) {
    setMachines((l) => (on ? [...new Set([...l, id])] : l.filter((x) => x !== id)))
    touch()
  }
  function toggleUnit(u: ScopeUnit, on: boolean) {
    const ids = u.machines.map((m) => m.id)
    setMachines((l) => (on ? [...new Set([...l, ...ids])] : l.filter((x) => !ids.includes(x))))
    touch()
  }

  function save() {
    if (scopeMode === "custom" && machines.length === 0) {
      toast.error("Escolha ao menos uma máquina ou volte para “Todas as máquinas que posso ver”.")
      return
    }
    if (quiet.enabled && quiet.days.length === 0) {
      toast.error("Escolha ao menos um dia para o horário de silêncio.")
      return
    }
    setDirty(false)
    toast.success("Preferências salvas", { description: `Valem para ${clientName} em todos os seus aparelhos.` })
  }
  function reset() {
    setTypes(defaultTypes())
    setScopeMode("all")
    setMachines(allMachines)
    setQuiet({ enabled: true, start: "22:00", end: "06:00", days: ["1", "2", "3", "4", "5", "6", "0"], critical: true })
    setDigest({ shift: true, daily: false })
    setDirty(true)
    toast.info("Padrão restaurado. Salve para aplicar.")
  }

  const activeCount = visibleTypes.filter((t) => types[t].on).length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-12">
        {/* Tipos × canais */}
        <SectionCard
          title="O que receber e por onde"
          description={`${activeCount} de ${visibleTypes.length} tipos ligados · a central no app recebe sempre; push, e-mail e WhatsApp são canais de entrega`}
          className="xl:col-span-8"
        >
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b">
                  <th scope="col" className="pb-2 text-left text-xs font-medium text-muted-foreground">
                    Tipo de alerta
                  </th>
                  <th scope="col" className="w-20 px-2 pb-2 text-center align-bottom text-xs font-medium">
                    Receber
                  </th>
                  <ColHead icon={BellIcon} label="Central" />
                  <ColHead icon={SmartphoneIcon} label="Push" />
                  <ColHead icon={MailIcon} label="E-mail" />
                  <ColHead icon={MessageCircleIcon} label="WhatsApp" soon />
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleTypes.map((t) => {
                  const meta = ALERT_TYPE_META[t]
                  const p = types[t]
                  return (
                    <tr key={t} className={cn(!p.on && "text-muted-foreground")}>
                      <td className="py-3 pr-3">
                        <div className="flex items-start gap-3">
                          <IconCircle icon={meta.icon} tone={SEVERITY_META[meta.severity].tone} soft size="sm" className={cn(!p.on && "opacity-50")} />
                          <div className="min-w-0 leading-tight">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-foreground">{meta.label}</span>
                              {meta.platformOnly && (
                                <span className="rounded-full bg-[#2c4e73]/10 px-1.5 text-[10px] font-semibold text-[#2c4e73] dark:bg-white/10 dark:text-[#9cc3e6]">
                                  Equipe Engemase
                                </span>
                              )}
                            </div>
                            <span className="mt-0.5 block text-xs text-muted-foreground">{meta.description}</span>
                            <span className="mt-1 inline-block rounded-md bg-muted px-1.5 py-px text-[11px] text-muted-foreground">{meta.rule}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 text-center">
                        <Switch checked={p.on} onCheckedChange={(v) => setType(t, { on: v })} aria-label={`Receber ${meta.label}`} />
                      </td>
                      <td className="px-2 text-center">
                        <span
                          className={cn("inline-flex size-4 items-center justify-center rounded-[4px]", p.on ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}
                          title="A central no app recebe sempre"
                        >
                          <LockIcon className="size-2.5" aria-label="Sempre ligada" />
                        </span>
                      </td>
                      <td className="px-2 text-center">
                        <Checkbox checked={p.on && p.push} disabled={!p.on} onCheckedChange={(v) => setType(t, { push: v === true })} aria-label={`Push para ${meta.label}`} />
                      </td>
                      <td className="px-2 text-center">
                        <Checkbox checked={p.on && p.email} disabled={!p.on} onCheckedChange={(v) => setType(t, { email: v === true })} aria-label={`E-mail para ${meta.label}`} />
                      </td>
                      <td className="px-2 text-center">
                        <Checkbox checked={false} disabled aria-label={`WhatsApp para ${meta.label} (em breve)`} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
            <b className="text-foreground">Escalonamento:</b> alerta crítico sem reconhecimento em 15 min sobe para o próximo nível (supervisor → gerente). O WhatsApp entra
            nessa etapa quando for liberado, com modelos aprovados e seu consentimento.
          </p>
        </SectionCard>

        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          {/* Horário de silêncio */}
          <SectionCard
            title="Horário de silêncio"
            description="Push e e-mail ficam retidos; tudo continua na central"
            action={
              <Switch
                checked={quiet.enabled}
                onCheckedChange={(v) => {
                  setQuiet((q) => ({ ...q, enabled: v }))
                  touch()
                }}
                aria-label="Ativar horário de silêncio"
              />
            }
          >
            <div className={cn("grid gap-4", !quiet.enabled && "pointer-events-none opacity-50")} aria-disabled={!quiet.enabled}>
              <div className="flex items-center gap-3">
                <IconCircle icon={MoonStarIcon} tone="navy" soft size="sm" />
                <div className="grid flex-1 grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor={`${uid}-qs`} className="text-xs text-muted-foreground">
                      Das
                    </Label>
                    <Input
                      id={`${uid}-qs`}
                      type="time"
                      value={quiet.start}
                      disabled={!quiet.enabled}
                      onChange={(e) => {
                        setQuiet((q) => ({ ...q, start: e.target.value }))
                        touch()
                      }}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`${uid}-qe`} className="text-xs text-muted-foreground">
                      Até
                    </Label>
                    <Input
                      id={`${uid}-qe`}
                      type="time"
                      value={quiet.end}
                      disabled={!quiet.enabled}
                      onChange={(e) => {
                        setQuiet((q) => ({ ...q, end: e.target.value }))
                        touch()
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">Dias</span>
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  size="sm"
                  value={quiet.days}
                  disabled={!quiet.enabled}
                  onValueChange={(v) => {
                    setQuiet((q) => ({ ...q, days: v }))
                    touch()
                  }}
                  className="w-full"
                  aria-label="Dias do horário de silêncio"
                >
                  {DAYS.map((d) => (
                    <ToggleGroupItem key={d.v} value={d.v} className="flex-1 px-0 text-xs data-[state=on]:bg-primary/10 data-[state=on]:text-primary">
                      {d.l}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <label className="flex items-start gap-3 rounded-xl border p-3">
                <Switch
                  checked={quiet.critical}
                  disabled={!quiet.enabled}
                  onCheckedChange={(v) => {
                    setQuiet((q) => ({ ...q, critical: v }))
                    touch()
                  }}
                  className="mt-0.5"
                />
                <span className="leading-tight">
                  <span className="block text-sm font-medium">Críticos tocam mesmo no silêncio</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">Falha de máquina e gateway offline chegam a qualquer hora.</span>
                </span>
              </label>
            </div>
          </SectionCard>

          {/* Resumos por e-mail */}
          <SectionCard title="Resumos por e-mail" description={`Enviados para ${email}`}>
            <div className="grid gap-3">
              {[
                { key: "shift" as const, title: "Resumo ao fim de cada turno", text: "OEE, paradas principais e alertas do turno." },
                { key: "daily" as const, title: "Resumo do dia anterior às 07:00", text: "Visão de todas as unidades que você acompanha." },
              ].map((d) => (
                <label key={d.key} className="flex items-start gap-3">
                  <Switch
                    checked={digest[d.key]}
                    onCheckedChange={(v) => {
                      setDigest((s) => ({ ...s, [d.key]: v }))
                      touch()
                    }}
                    className="mt-0.5"
                  />
                  <span className="leading-tight">
                    <span className="block text-sm font-medium">{d.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{d.text}</span>
                  </span>
                </label>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Escopo */}
      <SectionCard
        title="De quais máquinas"
        description="Você só recebe alertas de máquinas que pode ver (cliente e unidades do seu acesso). Alertas de gateway seguem a unidade."
      >
        <RadioGroup
          value={scopeMode}
          onValueChange={(v) => {
            setScopeMode(v as "all" | "custom")
            touch()
          }}
          className="grid gap-2 sm:grid-cols-2"
        >
          {[
            { v: "all", title: "Todas as máquinas que posso ver", text: "Inclui automaticamente máquinas novas das suas unidades." },
            { v: "custom", title: "Só as máquinas que eu escolher", text: "Útil para quem acompanha uma linha ou um setor." },
          ].map((o) => (
            <label
              key={o.v}
              htmlFor={`${uid}-scope-${o.v}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                scopeMode === o.v ? "border-primary bg-primary/5" : "hover:bg-accent/60",
              )}
            >
              <RadioGroupItem id={`${uid}-scope-${o.v}`} value={o.v} className="mt-0.5" />
              <span className="leading-tight">
                <span className="block text-sm font-medium">{o.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{o.text}</span>
              </span>
            </label>
          ))}
        </RadioGroup>

        {scopeMode === "custom" && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {scope.map((u) => {
              const selected = u.machines.filter((m) => machines.includes(m.id)).length
              const state = selected === 0 ? false : selected === u.machines.length ? true : "indeterminate"
              return (
                <fieldset key={u.id} className="rounded-xl border p-3">
                  <legend className="sr-only">{u.name}</legend>
                  <label className="flex items-center gap-2.5 border-b pb-2.5">
                    <Checkbox checked={state} onCheckedChange={(v) => toggleUnit(u, v === true)} disabled={u.machines.length === 0} />
                    <span className="flex-1 text-sm font-semibold">{u.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {selected} de {u.machines.length}
                    </span>
                  </label>
                  {u.machines.length === 0 ? (
                    <p className="pt-3 text-xs text-muted-foreground">Nenhuma máquina cadastrada nesta unidade.</p>
                  ) : (
                    <div className="grid gap-x-3 gap-y-2 pt-2.5 sm:grid-cols-2">
                      {u.machines.map((m) => (
                        <label key={m.id} className="flex items-center gap-2.5 rounded-lg px-1 py-0.5 hover:bg-accent/60">
                          <Checkbox checked={machines.includes(m.id)} onCheckedChange={(v) => toggleMachine(m.id, v === true)} />
                          <span className="min-w-0 leading-tight">
                            <span className="block truncate text-sm">{m.name}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{m.line}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Barra de salvar */}
      <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-2xl border bg-card/95 px-4 py-3 shadow-[0_8px_24px_rgba(16,24,40,0.08)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">
          {dirty ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <span className="size-2 rounded-full bg-[#e96549]" />
              Alterações não salvas
            </span>
          ) : (
            `Preferências pessoais para ${clientName}. Os administradores definem as regras; você escolhe o que receber.`
          )}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcwIcon />
            Restaurar padrão
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty}>
            <SaveIcon />
            Salvar preferências
          </Button>
        </div>
      </div>
    </div>
  )
}
