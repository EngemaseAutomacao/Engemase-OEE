"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowUpRightIcon, BellIcon, CheckCheckIcon, CheckIcon, FactoryIcon, MapPinIcon, RouterIcon, WorkflowIcon } from "lucide-react"

import type { AlertSeverity } from "@/lib/mock"
import { cn } from "@/lib/utils"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import type { AlertEntity, AlertVM } from "./account-data"
import { ALERT_TYPE_META, SEVERITY_META, STATUS_META, type AlertStatus } from "./labels"

type StatusTab = AlertStatus | "all"

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "open", label: "Abertas" },
  { value: "acknowledged", label: "Reconhecidas" },
  { value: "resolved", label: "Resolvidas" },
  { value: "all", label: "Todas" },
]

const EMPTY_TEXT: Record<StatusTab, { title: string; text: string }> = {
  open: { title: "Nenhum alerta aberto", text: "Tudo sob controle. Quando algo exigir ação, o alerta aparece aqui e no sino." },
  acknowledged: { title: "Nada reconhecido no momento", text: "Alertas reconhecidos ficam aqui até a condição ser resolvida." },
  resolved: { title: "Nenhum alerta resolvido", text: "Alertas resolvidos (manual ou automaticamente) aparecem aqui." },
  all: { title: "Nenhum alerta ainda", text: "Os alertas deste cliente aparecem aqui assim que as regras forem disparadas." },
}

export const TAB_TRIGGER =
  "h-8 flex-none rounded-lg px-3 text-[13px] data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-primary/15 dark:data-[state=active]:text-primary"

export function TabCount({ n, strong }: { n: number; strong?: boolean }) {
  return (
    <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", strong ? "bg-[#e96549] text-white" : "bg-muted text-muted-foreground")}>{n}</span>
  )
}

const ENTITY_ICON = { machine: FactoryIcon, gateway: RouterIcon, line: WorkflowIcon, unit: MapPinIcon } as const

function EntityLabel({ entity }: { entity: AlertEntity }) {
  const Icon = ENTITY_ICON[entity.kind]
  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-medium text-foreground/80">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{entity.name}</span>
    </span>
  )
}

function AlertRow({ alert: a, onAck, onOpen }: { alert: AlertVM; onAck: (a: AlertVM) => void; onOpen: (a: AlertVM) => void }) {
  const type = ALERT_TYPE_META[a.type]
  const sev = SEVERITY_META[a.severity]
  return (
    <li className={cn("relative flex flex-wrap gap-x-3 gap-y-2 py-3.5 first:pt-1 last:pb-0 sm:flex-nowrap")}>
      <div className="relative">
        <IconCircle icon={type.icon} tone={sev.tone} soft />
        {!a.read && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-[#e96549]" aria-label="Não lido" />}
      </div>
      <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] sm:basis-auto">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-sm leading-tight", a.read ? "font-medium" : "font-semibold")}>{a.title}</span>
          <span className={cn("rounded-full px-2 py-px text-[11px] font-semibold", sev.badge)}>{sev.label}</span>
          <span className={cn("rounded-full px-2 py-px text-[11px] font-semibold", STATUS_META[a.status].badge)}>{STATUS_META[a.status].label}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{a.body}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {a.entity && <EntityLabel entity={a.entity} />}
          {a.entity && a.unitName && <span aria-hidden>·</span>}
          {a.unitName && <span className="truncate">{a.unitName}</span>}
          <span aria-hidden>·</span>
          <time title={a.at} className="tabular-nums">
            {a.ago}
          </time>
          <span aria-hidden className="hidden sm:inline">
            ·
          </span>
          <span className="hidden sm:inline">{type.label}</span>
          {a.acknowledgedBy && (
            <span className="inline-flex items-center gap-1 text-foreground/70">
              <CheckIcon className="size-3.5" aria-hidden />
              Reconhecido por {a.acknowledgedBy}
            </span>
          )}
        </div>
      </div>
      <div className="ml-[3.5rem] flex shrink-0 items-start gap-1.5 sm:ml-0">
        {a.status === "open" && (
          <Button size="sm" variant="outline" className="h-8" onClick={() => onAck(a)}>
            <CheckIcon />
            Reconhecer
          </Button>
        )}
        <Link
          href={a.href}
          onClick={() => onOpen(a)}
          aria-label={`Abrir: ${a.title}`}
          title="Abrir"
          className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition hover:bg-primary/20"
        >
          <ArrowUpRightIcon className="size-4" />
        </Link>
      </div>
    </li>
  )
}

/** Lista de alertas com abas por situação e filtros de severidade e unidade. */
export function AlertsCard({
  alerts,
  units,
  onAck,
  onOpen,
  onReadAll,
  className,
}: {
  alerts: AlertVM[]
  units: { id: string; name: string }[]
  onAck: (a: AlertVM) => void
  onOpen: (a: AlertVM) => void
  onReadAll: () => void
  className?: string
}) {
  const [tab, setTab] = useState<StatusTab>("open")
  const [severity, setSeverity] = useState<AlertSeverity | "all">("all")
  const [unit, setUnit] = useState<string>("all")

  const filtered = useMemo(
    () => alerts.filter((a) => (severity === "all" || a.severity === severity) && (unit === "all" || a.unitId === unit)),
    [alerts, severity, unit],
  )
  const count = (s: StatusTab) => filtered.filter((a) => s === "all" || a.status === s).length
  const unread = alerts.filter((a) => !a.read).length

  return (
    <SectionCard
      title="Alertas"
      description="Do mais recente para o mais antigo · a central guarda todos os alertas, mesmo os que chegaram por push"
      className={className}
      action={
        <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs text-primary" disabled={unread === 0} onClick={onReadAll}>
          <CheckCheckIcon className="size-3.5" />
          <span className="hidden sm:inline">Marcar todas como lidas</span>
          <span className="sm:hidden">Lidas</span>
        </Button>
      }
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as StatusTab)} className="gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList className="h-10 w-max rounded-xl border bg-card p-1 shadow-xs">
              {STATUS_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className={TAB_TRIGGER}>
                  {t.label}
                  <TabCount n={count(t.value)} strong={t.value === "open" && count("open") > 0} />
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="flex gap-2">
            <Select value={severity} onValueChange={(v) => setSeverity(v as AlertSeverity | "all")}>
              <SelectTrigger size="sm" className="w-full min-w-36 rounded-lg bg-card lg:w-auto" aria-label="Severidade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as severidades</SelectItem>
                {(Object.keys(SEVERITY_META) as AlertSeverity[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className={cn("size-2 rounded-full", SEVERITY_META[s].dot)} />
                    {SEVERITY_META[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {units.length > 1 && (
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger size="sm" className="w-full min-w-36 rounded-lg bg-card lg:w-auto" aria-label="Unidade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as unidades</SelectItem>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {STATUS_TABS.map((t) => {
          const list = filtered.filter((a) => t.value === "all" || a.status === t.value)
          return (
            <TabsContent key={t.value} value={t.value}>
              {list.length === 0 ? (
                <Empty className="border border-dashed py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <BellIcon />
                    </EmptyMedia>
                    <EmptyTitle className="text-base">{EMPTY_TEXT[t.value].title}</EmptyTitle>
                    <EmptyDescription>
                      {severity !== "all" || unit !== "all" ? "Nenhum alerta com estes filtros. Tente limpar a severidade ou a unidade." : EMPTY_TEXT[t.value].text}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="divide-y">
                  {list.map((a) => (
                    <AlertRow key={a.id} alert={a} onAck={onAck} onOpen={onOpen} />
                  ))}
                </ul>
              )}
            </TabsContent>
          )
        })}
      </Tabs>
    </SectionCard>
  )
}
