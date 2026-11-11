"use client"

import { useState } from "react"
import Link from "next/link"
import {
  BuildingIcon,
  CalendarRangeIcon,
  ClipboardCheckIcon,
  CpuIcon,
  DownloadIcon,
  FilterXIcon,
  GlobeLockIcon,
  HeadsetIcon,
  HistoryIcon,
  ListIcon,
  MonitorSmartphoneIcon,
  PaletteIcon,
  SearchIcon,
  ShieldCheckIcon,
  UsersIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { SettingsTitle, SoftBadge, plural } from "@/components/settings/bits"
import type { AuditActorKind, AuditCategory, AuditRow } from "@/components/settings/types"

const CATEGORY: Record<AuditCategory, { label: string; icon: LucideIcon; tone: IconTone }> = {
  config: { label: "Configuração", icon: CpuIcon, tone: "blue" },
  users: { label: "Usuários e acessos", icon: UsersIcon, tone: "navy" },
  production: { label: "Produção", icon: ClipboardCheckIcon, tone: "teal" },
  support: { label: "Suporte Engemase", icon: HeadsetIcon, tone: "orange" },
  remote: { label: "Acesso remoto (VPN)", icon: GlobeLockIcon, tone: "orange" },
  terminals: { label: "Terminais", icon: MonitorSmartphoneIcon, tone: "teal" },
  lifecycle: { label: "Ciclo de vida do cliente", icon: BuildingIcon, tone: "navy" },
  branding: { label: "Aparência", icon: PaletteIcon, tone: "blue" },
}

type Origin = "all" | "engemase" | "client"
const isEngemase = (k: AuditActorKind) => k === "engemase" || k === "support"

export function AuditLog({ clientName, clientSlug, rows }: { clientName: string; clientSlug: string; rows: AuditRow[] }) {
  const [view, setView] = useState<"timeline" | "table">("timeline")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<AuditCategory | "all">("all")
  const [person, setPerson] = useState<string>("all")
  const [origin, setOrigin] = useState<Origin>("all")

  const people = [...new Set(rows.map((r) => r.actor))].sort((a, b) => a.localeCompare(b, "pt-BR"))
  const categories = (Object.keys(CATEGORY) as AuditCategory[]).filter((c) => rows.some((r) => r.category === c))

  const q = query.trim().toLowerCase()
  const visible = rows
    .filter((r) => category === "all" || r.category === category)
    .filter((r) => person === "all" || r.actor === person)
    .filter((r) => origin === "all" || (origin === "engemase" ? isEngemase(r.actorKind) : !isEngemase(r.actorKind)))
    .filter((r) => !q || [r.actor, r.actionLabel, r.entityName, r.details ?? "", r.ticket ?? ""].some((x) => x.toLowerCase().includes(q)))
  const filtered = category !== "all" || person !== "all" || origin !== "all" || q !== ""

  const last30 = rows.filter((r) => r.daysAgo < 30)
  const engemase30 = last30.filter((r) => isEngemase(r.actorKind))
  const remote30 = last30.filter((r) => r.action === "remote.request")
  const people30 = new Set(last30.map((r) => r.actor)).size

  const clear = () => {
    setQuery("")
    setCategory("all")
    setPerson("all")
    setOrigin("all")
  }

  const days: { key: string; label: string; items: AuditRow[] }[] = []
  for (const r of visible) {
    const last = days[days.length - 1]
    if (last && last.key === r.dayKey) last.items.push(r)
    else days.push({ key: r.dayKey, label: r.dayLabel, items: [r] })
  }

  const engemaseRecent = rows.filter((r) => isEngemase(r.actorKind)).slice(0, 5)

  return (
    <>
      <SettingsTitle
        title="Auditoria"
        description={`Tudo o que mudou em ${clientName}: quem fez, quando e o quê. Ações da equipe Engemase ficam destacadas.`}
        actions={
          <Button
            variant="outline"
            onClick={() =>
              toast.success("Exportação gerada", {
                description: `${plural(visible.length, "evento", "eventos")} em CSV, respeitando o seu escopo de unidades. O download aparece em instantes.`,
              })
            }
          >
            <DownloadIcon />
            Exportar CSV
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={HistoryIcon} tone="blue" label="Eventos em 30 dias" value={last30.length} hint={`${plural(rows.length, "evento", "eventos")} no histórico`} />
        <StatCard icon={ShieldCheckIcon} tone="navy" label="Ações da Engemase" value={engemase30.length} hint="Últimos 30 dias, sempre visíveis aqui" />
        <StatCard icon={GlobeLockIcon} tone="orange" label="Pedidos de acesso remoto" value={remote30.length} hint="Últimos 30 dias" />
        <StatCard icon={UsersIcon} tone="teal" label="Pessoas diferentes" value={people30} hint="Fizeram alterações em 30 dias" />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-12">
        <SectionCard
          title="Histórico"
          description={filtered ? `${plural(visible.length, "evento", "eventos")} com os filtros atuais` : "Mais recentes primeiro"}
          className="xl:col-span-8"
          action={
            <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as "timeline" | "table")} className="shrink-0 bg-card">
              <ToggleGroupItem value="timeline" aria-label="Linha do tempo" className="gap-1.5 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                <WorkflowIcon className="size-3.5" />
                <span className="hidden sm:inline">Linha do tempo</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="table" aria-label="Tabela" className="gap-1.5 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                <ListIcon className="size-3.5" />
                <span className="hidden sm:inline">Tabela</span>
              </ToggleGroupItem>
            </ToggleGroup>
          }
        >
          <div className="mb-4 grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-center">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por item, detalhe ou chamado" className="h-8 pl-8 text-sm" aria-label="Buscar na auditoria" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={category} onValueChange={(v) => setCategory(v as AuditCategory | "all")}>
                <SelectTrigger size="sm" className="w-full md:w-44" aria-label="Filtrar por ação">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as ações</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY[c].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={person} onValueChange={setPerson}>
                <SelectTrigger size="sm" className="w-full md:w-44" aria-label="Filtrar por pessoa">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as pessoas</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ToggleGroup type="single" variant="outline" size="sm" value={origin} onValueChange={(v) => v && setOrigin(v as Origin)} className="bg-card">
              {(
                [
                  ["all", "Todos"],
                  ["engemase", "Engemase"],
                  ["client", "Cliente"],
                ] as const
              ).map(([v, label]) => (
                <ToggleGroupItem key={v} value={v} className="px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {visible.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HistoryIcon />
                </EmptyMedia>
                <EmptyTitle>{rows.length === 0 ? "Nada registrado ainda" : "Nenhum evento com esses filtros"}</EmptyTitle>
                <EmptyDescription>
                  {rows.length === 0 ? "Alterações de configuração, usuários, terminais e acessos da Engemase aparecem aqui." : "Tente outra pessoa, outro tipo de ação ou limpe a busca."}
                </EmptyDescription>
              </EmptyHeader>
              {filtered && (
                <EmptyContent>
                  <Button variant="outline" size="sm" onClick={clear}>
                    <FilterXIcon />
                    Limpar filtros
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : view === "timeline" ? (
            <div className="grid gap-5">
              {days.map((d) => (
                <section key={d.key}>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <CalendarRangeIcon className="size-3.5" />
                    {d.label}
                    <span className="font-normal">· {plural(d.items.length, "evento", "eventos")}</span>
                  </h3>
                  <ol className="relative grid gap-2">
                    <span className="absolute top-3 bottom-3 left-[4.25rem] w-px bg-border sm:left-[5rem]" aria-hidden />
                    {d.items.map((r) => (
                      <TimelineItem key={r.id} row={r} />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="py-2.5 pr-3 pl-5 font-medium">Data e hora</th>
                    <th className="px-3 py-2.5 font-medium">Pessoa</th>
                    <th className="px-3 py-2.5 font-medium">Ação</th>
                    <th className="px-3 py-2.5 font-medium">Item</th>
                    <th className="py-2.5 pr-5 pl-3 font-medium">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visible.map((r) => (
                    <tr key={r.id} className={cn("align-top", isEngemase(r.actorKind) && "bg-primary/[0.04]")}>
                      <td className="py-2.5 pr-3 pl-5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{r.dateTime}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium whitespace-nowrap">{r.actor}</div>
                        <ActorBadge row={r} />
                      </td>
                      <td className="px-3 py-2.5 text-xs">{r.actionLabel}</td>
                      <td className="px-3 py-2.5 text-xs font-medium">{r.entityName}</td>
                      <td className="py-2.5 pr-5 pl-3 text-xs text-muted-foreground">
                        {r.details ?? "—"}
                        {r.ticket && <span className="ml-1 font-semibold text-foreground">· {r.ticket}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <div className="grid gap-4 xl:col-span-4">
          <SectionCard title="Equipe Engemase neste cliente" description="Últimas ações de suporte, campo e plataforma" href={`/${clientSlug}/config/usuarios`} linkLabel="Ver acessos">
            {engemaseRecent.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhuma ação da Engemase registrada.</p>
            ) : (
              <ul className="grid gap-3">
                {engemaseRecent.map((r) => (
                  <li key={r.id} className="flex items-start gap-3">
                    <IconCircle icon={r.actorKind === "support" ? HeadsetIcon : ShieldCheckIcon} tone={r.actorKind === "support" ? "orange" : "navy"} soft size="sm" />
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="truncate text-sm font-medium">{r.actor}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.actionLabel} · {r.entityName}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{r.dateTime}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="O que fica registrado">
            <ul className="grid gap-2 text-xs text-muted-foreground">
              {[
                "Configurações de gateways, conexões Modbus, tags, máquinas e turnos (antes e depois)",
                "Usuários, papéis e unidades; terminais pareados e revogados",
                "Toda entrada da Engemase, com motivo e chamado, e cada sessão de acesso remoto",
                "Classificação de paradas e comandos enviados aos gateways",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-3 rounded-xl bg-muted/60 p-3 text-[11px] leading-snug text-muted-foreground">
              O histórico é guardado por 5 anos e não pode ser editado. Quem vê só algumas unidades enxerga apenas os eventos delas. Dúvidas sobre um acesso? Veja{" "}
              <Link href={`/${clientSlug}/acesso-remoto`} className="font-semibold text-primary hover:underline">
                Acesso remoto
              </Link>
              .
            </p>
          </SectionCard>
        </div>
      </div>
    </>
  )
}

function ActorBadge({ row }: { row: AuditRow }) {
  if (row.actorKind === "support")
    return (
      <SoftBadge tone="orange" icon={HeadsetIcon} className="mt-0.5">
        {row.actorRole ?? "Suporte Engemase"}
      </SoftBadge>
    )
  if (row.actorKind === "engemase")
    return (
      <SoftBadge tone="blue" icon={ShieldCheckIcon} className="mt-0.5">
        {row.actorRole ?? "Equipe Engemase"}
      </SoftBadge>
    )
  if (row.actorKind === "system") return <span className="text-[11px] text-muted-foreground">Automático</span>
  return row.actorRole ? <span className="text-[11px] text-muted-foreground">{row.actorRole}</span> : null
}

function TimelineItem({ row }: { row: AuditRow }) {
  const meta = CATEGORY[row.category]
  const eng = isEngemase(row.actorKind)
  return (
    <li className="relative grid grid-cols-[2.75rem_auto_1fr] items-start gap-2 sm:grid-cols-[3.25rem_auto_1fr] sm:gap-3">
      <span className="pt-2 text-right text-xs font-semibold text-muted-foreground tabular-nums">{row.time}</span>
      <IconCircle icon={meta.icon} tone={eng ? (row.actorKind === "support" ? "orange" : "navy") : meta.tone} soft={!eng} size="sm" className="relative ring-4 ring-card" />
      <div
        className={cn(
          "min-w-0 rounded-xl border px-3 py-2",
          eng ? (row.actorKind === "support" ? "border-[#e96549]/30 bg-[#e96549]/[0.06]" : "border-primary/25 bg-primary/[0.05]") : "border-transparent bg-muted/40",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{row.actor}</span>
          <ActorBadge row={row} />
          {row.ticket && <SoftBadge tone="slate">chamado {row.ticket}</SoftBadge>}
        </div>
        <p className="mt-0.5 text-sm">
          {row.actionLabel} <span className="font-medium">· {row.entityName}</span>
        </p>
        {row.details && <p className="mt-0.5 text-xs text-muted-foreground">{row.details}</p>}
        {row.impersonatedBy && <p className="mt-1 text-[11px] font-medium text-[#cf5539]">Via {row.impersonatedBy}</p>}
      </div>
    </li>
  )
}
