"use client"

import {
  ArchiveXIcon,
  Building2Icon,
  CheckIcon,
  CircleDashedIcon,
  CpuIcon,
  FileCogIcon,
  HistoryIcon,
  type LucideIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  RocketIcon,
  ShieldCheckIcon,
  UserPlusIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { SectionCard } from "@/components/dashboard/section-card"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { Ring } from "@/components/dashboard/ring"
import { Button } from "@/components/ui/button"
import type { ChecklistItem, LifecycleEvent } from "./admin-data"
import { useClientDetail } from "./client-detail-context"
import { useLifecycle } from "./client-detail-header"
import { ACTION_META, actionsFor } from "./lifecycle-dialogs"
import { LIFECYCLE_ORDER, STATUS_EFFECT, STATUS_LABEL, type AdminClientStatus } from "./labels"

const STATE_ICON: Record<AdminClientStatus, { icon: LucideIcon; tone: IconTone }> = {
  onboarding: { icon: RocketIcon, tone: "blue" },
  active: { icon: PlayCircleIcon, tone: "green" },
  suspended: { icon: PauseCircleIcon, tone: "amber" },
  closed: { icon: ArchiveXIcon, tone: "slate" },
}

const EVENT_ICON: Record<string, { icon: LucideIcon; tone: IconTone }> = {
  "client.create": { icon: Building2Icon, tone: "blue" },
  "client.suspend": { icon: PauseCircleIcon, tone: "amber" },
  "gateway.create": { icon: CpuIcon, tone: "teal" },
  "config.publish": { icon: FileCogIcon, tone: "navy" },
  "user.invite": { icon: UserPlusIcon, tone: "navy" },
  "support.impersonate": { icon: ShieldCheckIcon, tone: "violet" },
}

/** Aba "Ciclo de vida": estados, ações, checklist de implantação e linha do tempo (docs/15 §6–7). */
export function LifecycleTab({ checklist, events, name, slug }: { checklist: ChecklistItem[]; events: LifecycleEvent[]; name: string; slug: string }) {
  const { status, events: local } = useClientDetail()
  const { run, dialog } = useLifecycle(name, slug)
  const actions = actionsFor(status)
  const current = LIFECYCLE_ORDER.indexOf(status)
  const done = checklist.filter((c) => c.done).length

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Estado do cliente" description="Implantação → Ativo; suspensão e encerramento quando necessário">
        <ol className="grid gap-3 md:grid-cols-4">
          {LIFECYCLE_ORDER.map((st, i) => {
            const meta = STATE_ICON[st]
            const isCurrent = st === status
            const passed = i < current && st === "onboarding"
            return (
              <li
                key={st}
                className={cn(
                  "relative flex flex-col gap-2 rounded-xl border p-3 transition",
                  isCurrent ? "border-primary bg-primary/5 ring-1 ring-primary" : passed ? "bg-muted/30" : "opacity-80",
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                <div className="flex items-center gap-2">
                  <IconCircle icon={meta.icon} tone={meta.tone} soft={!isCurrent} size="sm" />
                  <span className="text-sm font-semibold">{STATUS_LABEL[st]}</span>
                  {isCurrent && <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">Atual</span>}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{STATUS_EFFECT[st]}</p>
              </li>
            )
          })}
        </ol>
        {actions.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
            <span className="mr-auto text-xs text-muted-foreground">Toda mudança pede confirmação e fica na auditoria do cliente.</span>
            {actions.map((a) => {
              const Icon = ACTION_META[a].icon
              return (
                <Button
                  key={a}
                  size="sm"
                  variant={a === "activate" || a === "reactivate" ? "default" : "outline"}
                  onClick={() => run(a)}
                  className={cn(a === "close" && "text-destructive hover:text-destructive", a === "suspend" && "text-amber-700 dark:text-state-stopped")}
                >
                  <Icon />
                  {ACTION_META[a].label}
                </Button>
              )
            })}
          </div>
        ) : (
          <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">Encerramento segue o runbook manual: exportação, carência, revogação e termo de eliminação.</p>
        )}
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-12">
        <SectionCard title="Implantação" description="Fluxo de docs/15: do cadastro ao cliente ativo" className="xl:col-span-5">
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-muted/60 p-3">
            <Ring value={done / checklist.length} size={52} stroke={6} color="#0e9384" label={`${done}/${checklist.length}`} />
            <div className="min-w-0 text-sm">
              <div className="font-semibold">{done === checklist.length ? "Implantação completa" : `${checklist.length - done} etapas pendentes`}</div>
              <div className="text-xs text-muted-foreground">Conferido nos dados atuais do cliente</div>
            </div>
          </div>
          <ul className="grid gap-2.5">
            {checklist.map((c) => (
              <li key={c.key} className="flex items-start gap-2.5">
                <span
                  className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", c.done ? "bg-state-running text-white" : "text-muted-foreground")}
                  aria-label={c.done ? "Concluído" : "Pendente"}
                >
                  {c.done ? <CheckIcon className="size-3.5" /> : <CircleDashedIcon className="size-5" />}
                </span>
                <span className="min-w-0 leading-tight">
                  <span className={cn("block text-sm", c.done ? "font-medium" : "font-semibold")}>{c.label}</span>
                  <span className="block text-xs text-muted-foreground">{c.hint}</span>
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Linha do tempo" description="Eventos deste cliente na auditoria" href="/admin/auditoria" className="xl:col-span-7">
          {events.length + local.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum evento registrado.</p>
          ) : (
            <ol className="relative grid gap-4">
              <span className="absolute top-2 bottom-2 left-4 border-l-2 border-dashed border-border" aria-hidden />
              {[...local].reverse().map((e) => (
                <li key={e.id} className="relative flex min-w-0 items-start gap-3">
                  <IconCircle icon={HistoryIcon} tone="orange" size="sm" className="ring-4 ring-card" />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold">{e.title}</span>
                      <span className="shrink-0 text-[11px] font-semibold text-primary">{e.at}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{e.subtitle}</div>
                  </div>
                </li>
              ))}
              {[...events].reverse().map((e) => {
                const meta = EVENT_ICON[e.action] ?? { icon: HistoryIcon, tone: "slate" as const }
                return (
                  <li key={e.id} className="relative flex min-w-0 items-start gap-3">
                    <IconCircle icon={meta.icon} tone={meta.tone} size="sm" className="ring-4 ring-card" />
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold">{e.title}</span>
                        <time className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{e.at}</time>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{e.subtitle}</div>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </SectionCard>
      </div>
      {dialog}
    </div>
  )
}
