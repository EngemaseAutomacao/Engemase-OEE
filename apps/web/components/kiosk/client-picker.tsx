"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowRightIcon,
  Building2Icon,
  CircleCheckIcon,
  HourglassIcon,
  MapPinIcon,
  PauseCircleIcon,
  RouterIcon,
  SearchIcon,
  Settings2Icon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { pct } from "@/lib/format"
import { CLIENT_STATUS_LABEL, PLAN_LABEL } from "@/lib/roles"
import type { ClientManagement, ClientPlan, ClientStatus } from "@/lib/mock"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { OeeRing } from "@/components/oee/oee-ring"

export interface ClientPickerItem {
  id: string
  slug: string
  name: string
  legalName: string
  initials: string
  city: string
  state: string
  status: ClientStatus
  plan: ClientPlan
  management: ClientManagement
  unitNames: string[]
  machines: number
  running: number
  faults: number
  noComm: number
  gateways: number
  gatewaysOnline: number
  problemGateways: { name: string; statusLabel: string; lastSeen: string }[]
  pendingGateways: number
  oee: number | null
  machinesWithData: number
}

type StatusFilter = "all" | ClientStatus

const STATUS_BADGE: Record<ClientStatus, string> = {
  active: "bg-emerald-600/10 text-emerald-700 dark:bg-state-running/15 dark:text-state-running",
  onboarding: "bg-primary/10 text-primary",
  suspended: "bg-state-fault/10 text-state-fault",
}

const STATUS_ORDER: Record<ClientStatus, number> = { active: 0, onboarding: 1, suspended: 2 }

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()

/** Grade de clientes acessíveis com busca e filtro por status (estado local, sem searchParams). */
export function ClientPicker({ items }: { items: ClientPickerItem[] }) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: items.length, active: 0, onboarding: 0, suspended: 0 }
    for (const i of items) c[i.status]++
    return c
  }, [items])

  const visible = useMemo(() => {
    const q = normalize(query.trim())
    return items
      .filter((i) => status === "all" || i.status === status)
      .filter((i) => !q || normalize(`${i.name} ${i.legalName} ${i.city} ${i.state} ${i.unitNames.join(" ")}`).includes(q))
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name, "pt-BR"))
  }, [items, query, status])

  const filters: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "Todos" },
    { value: "active", label: "Ativos" },
    { value: "onboarding", label: "Em implantação" },
    { value: "suspended", label: "Suspensos" },
  ]

  return (
    <section className="flex flex-col gap-4" aria-labelledby="clientes-titulo">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 id="clientes-titulo" className="text-base font-semibold">
          Clientes <span className="font-normal text-muted-foreground tabular-nums">({items.length})</span>
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="-mx-1 overflow-x-auto px-1 pb-1 sm:pb-0">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={status}
              onValueChange={(v) => v && setStatus(v as StatusFilter)}
              aria-label="Filtrar por status"
            >
              {filters.map((f) => (
                <ToggleGroupItem key={f.value} value={f.value} className="gap-1.5 px-2.5 text-xs">
                  {f.label}
                  <span className="text-muted-foreground tabular-nums">{counts[f.value]}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <InputGroup className="sm:w-64">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente ou cidade"
              aria-label="Buscar cliente"
            />
          </InputGroup>
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2Icon />
            </EmptyMedia>
            <EmptyTitle>Nenhum cliente encontrado</EmptyTitle>
            <EmptyDescription>Confira a grafia ou limpe os filtros para ver todos os clientes.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("")
                setStatus("all")
              }}
            >
              Limpar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((item) => (
            <ClientCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}

function ClientCard({ item }: { item: ClientPickerItem }) {
  const suspended = item.status === "suspended"
  return (
    <Card
      className={cn(
        "group relative gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md",
        "has-[[data-primary-link]:focus-visible]:ring-[3px] has-[[data-primary-link]:focus-visible]:ring-ring/50",
        suspended && "bg-muted/40",
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-lg text-sm font-semibold",
            suspended ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
          )}
          aria-hidden
        >
          {item.initials}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/${item.slug}`}
            data-primary-link
            className="block truncate font-semibold outline-none after:absolute after:inset-0 after:content-['']"
          >
            {item.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPinIcon className="size-3" />
              {item.city}/{item.state}
            </span>
            <span aria-hidden>·</span>
            <span>Plano {PLAN_LABEL[item.plan]}</span>
            <span aria-hidden>·</span>
            <span>{item.management === "engemase" ? "Gerenciado pela Engemase" : "Autogestão"}</span>
          </div>
        </div>
        <Badge variant="outline" className={cn("shrink-0 border-transparent", STATUS_BADGE[item.status])}>
          {CLIENT_STATUS_LABEL[item.status]}
        </Badge>
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-4 border-t px-4 py-3">
        <div className="flex flex-col items-center gap-1">
          <OeeRing value={item.oee} size={64} stroke={7} />
          <span className="text-[11px] text-muted-foreground">Turno atual</span>
        </div>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Unidades</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{item.unitNames.length}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Máquinas</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{item.machines}</dd>
            <dd className="truncate text-xs text-muted-foreground tabular-nums">
              {item.machinesWithData > 0 ? `${item.running} produzindo` : "sem dados"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Gateways</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">
              {item.gatewaysOnline}
              <span className="text-sm font-normal text-muted-foreground">/{item.gateways}</span>
            </dd>
            <dd className="truncate text-xs text-muted-foreground">online</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-col gap-1.5 border-t px-4 py-3 text-sm">
        <ClientHealth item={item} />
      </div>

      <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-4 py-2 text-xs">
        <span className="min-w-0 truncate text-muted-foreground">{item.unitNames.join(" · ") || "Nenhuma unidade cadastrada"}</span>
        <div className="relative z-10 flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="xs" asChild>
            <Link href={`/admin/clientes/${item.id}`}>
              <Settings2Icon />
              Gerenciar
            </Link>
          </Button>
          <Button variant="ghost" size="xs" asChild className="text-primary">
            <Link href={`/${item.slug}`} tabIndex={-1} aria-hidden>
              Abrir
              <ArrowRightIcon className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  )
}

function ClientHealth({ item }: { item: ClientPickerItem }) {
  if (item.status === "suspended") {
    return (
      <HealthLine icon={PauseCircleIcon} tone="muted">
        Acesso suspenso: usuários do cliente não conseguem entrar. Dados e configurações preservados.
      </HealthLine>
    )
  }

  const lines: React.ReactNode[] = []
  if (item.problemGateways.length > 0) {
    lines.push(
      <HealthLine key="gw" icon={RouterIcon} tone="bad">
        {item.problemGateways.length === 1 ? "1 gateway com problema: " : `${item.problemGateways.length} gateways com problema: `}
        <span className="font-medium">
          {item.problemGateways.map((g) => `${g.name} (${g.statusLabel.toLowerCase()}, ${g.lastSeen})`).join("; ")}
        </span>
      </HealthLine>,
    )
  }
  if (item.pendingGateways > 0) {
    lines.push(
      <HealthLine key="pending" icon={HourglassIcon} tone="info">
        {item.pendingGateways === 1 ? "1 gateway aguardando ativação na planta" : `${item.pendingGateways} gateways aguardando ativação`}
      </HealthLine>,
    )
  }
  if (item.faults > 0) {
    lines.push(
      <HealthLine key="fault" icon={TriangleAlertIcon} tone="bad">
        {item.faults === 1 ? "1 máquina em falha agora" : `${item.faults} máquinas em falha agora`}
      </HealthLine>,
    )
  }
  if (item.noComm > 0 && item.machinesWithData > 0) {
    lines.push(
      <HealthLine key="nocomm" icon={WifiOffIcon} tone="warn">
        {item.noComm === 1 ? "1 máquina sem comunicação" : `${item.noComm} máquinas sem comunicação`}
      </HealthLine>,
    )
  }
  if (lines.length === 0) {
    lines.push(
      <HealthLine key="ok" icon={CircleCheckIcon} tone="good">
        Todos os gateways online · OEE {pct(item.oee, 1)} no turno
      </HealthLine>,
    )
  }
  return <>{lines}</>
}

const TONE: Record<"good" | "warn" | "bad" | "info" | "muted", string> = {
  good: "text-emerald-700 dark:text-state-running",
  warn: "text-amber-700 dark:text-state-stopped",
  bad: "text-state-fault",
  info: "text-primary",
  muted: "text-muted-foreground",
}

function HealthLine({
  icon: Icon,
  tone,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  tone: keyof typeof TONE
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex items-start gap-2 text-xs leading-snug", TONE[tone])}>
      <Icon className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  )
}
