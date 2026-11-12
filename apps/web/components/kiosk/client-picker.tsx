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
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { OeeRing } from "@/components/oee/oee-ring"
import { SoftIconLink } from "@/components/refresh/soft-action"

export interface ClientPickerItem {
  id: string
  slug: string
  name: string
  legalName: string
  initials: string
  /** Cor da identidade visual do cliente (docs/14); azul Engemase quando não há. */
  brandColor: string
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
export function ClientPicker({ items, consoleHref }: { items: ClientPickerItem[]; consoleHref?: string }) {
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
      <div className="flex flex-col gap-3 rounded-2xl border bg-card px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:flex-row lg:items-center lg:justify-between lg:px-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2 id="clientes-titulo" className="text-[15px] font-semibold">
              Clientes <span className="font-normal text-muted-foreground tabular-nums">({items.length})</span>
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Toque em um cliente para abrir o painel dele.</p>
          </div>
          {consoleHref && (
            <Link href={consoleHref} className="shrink-0 text-xs font-semibold text-primary hover:underline lg:hidden">
              Ver no console
            </Link>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="-mx-1 overflow-x-auto px-1 pb-1 sm:pb-0">
            <ToggleGroup
              type="single"
              size="sm"
              spacing={1}
              value={status}
              onValueChange={(v) => v && setStatus(v as StatusFilter)}
              aria-label="Filtrar por status"
            >
              {filters.map((f) => (
                <ToggleGroupItem
                  key={f.value}
                  value={f.value}
                  className="gap-1.5 rounded-full px-3 text-xs data-[state=on]:bg-primary/10 data-[state=on]:font-semibold data-[state=on]:text-primary"
                >
                  {f.label}
                  <span className="text-muted-foreground tabular-nums">{counts[f.value]}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <InputGroup className="sm:w-60">
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
          {consoleHref && (
            <Link href={consoleHref} className="hidden shrink-0 pl-1 text-xs font-semibold text-primary hover:underline lg:inline">
              Ver no console
            </Link>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed bg-card">
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
    <article
      className={cn(
        "group relative flex flex-col rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-shadow hover:shadow-md",
        "has-[[data-primary-link]:focus-visible]:ring-[3px] has-[[data-primary-link]:focus-visible]:ring-ring/50",
        suspended && "bg-muted/40",
      )}
    >
      <header className="flex items-start gap-3 px-5 pt-4">
        <span
          aria-hidden
          className={cn("flex size-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white", suspended && "grayscale")}
          style={{ background: item.brandColor }}
        >
          {item.initials}
        </span>
        <div className="min-w-0 flex-1">
          <Link
            href={`/${item.slug}`}
            data-primary-link
            className="block truncate text-[15px] font-semibold outline-none group-hover:text-primary after:absolute after:inset-0 after:rounded-2xl after:content-['']"
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
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_BADGE[item.status])}>
          {CLIENT_STATUS_LABEL[item.status]}
        </span>
      </header>

      <div className="mx-5 mt-4 grid grid-cols-[auto_1fr] items-center gap-4 rounded-xl bg-muted/60 p-3">
        <div className="flex flex-col items-center gap-1">
          <OeeRing value={item.oee} size={60} stroke={7} />
          <span className="text-[11px] text-muted-foreground">Turno atual</span>
        </div>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div className="min-w-0">
            <dt className="truncate text-xs text-muted-foreground">Unidades</dt>
            <dd className="mt-0.5 text-lg leading-tight font-bold tabular-nums">{item.unitNames.length}</dd>
          </div>
          <div className="min-w-0">
            <dt className="truncate text-xs text-muted-foreground">Máquinas</dt>
            <dd className="mt-0.5 text-lg leading-tight font-bold tabular-nums">{item.machines}</dd>
            <dd className="truncate text-xs text-muted-foreground tabular-nums">
              {item.machinesWithData > 0 ? `${item.running} produzindo` : "sem dados"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="truncate text-xs text-muted-foreground">Gateways</dt>
            <dd className="mt-0.5 text-lg leading-tight font-bold tabular-nums">
              {item.gatewaysOnline}
              <span className="text-sm font-medium text-muted-foreground">/{item.gateways}</span>
            </dd>
            <dd className="truncate text-xs text-muted-foreground">online</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-col gap-1.5 px-5 py-3 text-sm">
        <ClientHealth item={item} />
      </div>

      <footer className="mt-auto flex items-center justify-between gap-3 border-t px-5 py-3 text-xs">
        <span className="min-w-0 truncate text-muted-foreground">{item.unitNames.join(" · ") || "Nenhuma unidade cadastrada"}</span>
        <div className="relative z-10 flex shrink-0 items-center gap-1.5">
          <SoftIconLink href={`/admin/clientes/${item.id}`} label={`Gerenciar ${item.name} no console`} tone="slate">
            <Settings2Icon />
          </SoftIconLink>
          {/* Visual apenas: o clique atravessa para o link principal do cartão. */}
          <span
            aria-hidden
            className="pointer-events-none flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground"
          >
            <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </footer>
    </article>
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
