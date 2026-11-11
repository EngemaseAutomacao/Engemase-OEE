"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Building2Icon, EyeIcon, LogInIcon, MoreHorizontalIcon, SearchIcon, XIcon } from "lucide-react"

import type { ClientManagement, ClientPlan } from "@/lib/mock/types"
import { num } from "@/lib/format"
import { PLAN_LABEL } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ClientRow } from "./admin-data"
import { ClientStatusBadge, ManagementBadge, PlanBadge, SoftBadge, TD, TH, UsageBar, squareClass } from "./bits"
import { useEnterClient } from "./enter-client"
import { ACTION_META, ACTION_RESULT, LifecycleDialog, actionsFor, lifecycleToast, type LifecycleAction } from "./lifecycle-dialogs"
import { MANAGEMENT_LABEL, STATUS_LABEL, onlyDigits, type AdminClientStatus } from "./labels"

type StatusFilter = "all" | AdminClientStatus

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()

/** Tabela de clientes do console com busca, filtros e menu de ações por linha. */
export function ClientsTable({ rows }: { rows: ClientRow[] }) {
  const router = useRouter()
  const enter = useEnterClient()
  const [overrides, setOverrides] = useState<Record<string, AdminClientStatus>>({})
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [plan, setPlan] = useState<"all" | ClientPlan>("all")
  const [management, setManagement] = useState<"all" | ClientManagement>("all")
  const [dialog, setDialog] = useState<{ action: LifecycleAction; row: ClientRow; nonce: number } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const statusOf = (r: ClientRow): AdminClientStatus => overrides[r.id] ?? r.status

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: rows.length, onboarding: 0, active: 0, suspended: 0, closed: 0 }
    for (const r of rows) c[overrides[r.id] ?? r.status]++
    return c
  }, [rows, overrides])

  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    const qDigits = onlyDigits(query)
    return rows.filter((r) => {
      const st = overrides[r.id] ?? r.status
      if (status !== "all" && st !== status) return false
      if (plan !== "all" && r.plan !== plan) return false
      if (management !== "all" && r.management !== management) return false
      if (!q) return true
      const hay = normalize(`${r.name} ${r.legalName} ${r.city} ${r.state} ${r.slug}`)
      return hay.includes(q) || (qDigits.length >= 3 && onlyDigits(r.cnpj).includes(qDigits))
    })
  }, [rows, overrides, query, status, plan, management])

  const hasFilters = query !== "" || status !== "all" || plan !== "all" || management !== "all"
  const clear = () => {
    setQuery("")
    setStatus("all")
    setPlan("all")
    setManagement("all")
  }

  const confirm = (action: LifecycleAction) => {
    if (!dialog) return
    const { row } = dialog
    setOverrides((o) => ({ ...o, [row.id]: ACTION_RESULT[action] }))
    const t = lifecycleToast(action, row.name)
    toast.success(t.title, { description: t.description })
    setDialogOpen(false)
  }

  const openDialog = (action: LifecycleAction, row: ClientRow) => {
    setDialog((d) => ({ action, row, nonce: (d?.nonce ?? 0) + 1 }))
    setDialogOpen(true)
  }

  const pills: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "Todos" },
    { value: "active", label: "Ativos" },
    { value: "onboarding", label: "Implantação" },
    { value: "suspended", label: "Suspensos" },
    ...(counts.closed > 0 ? [{ value: "closed" as const, label: "Encerrados" }] : []),
  ]

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      {/* Barra de busca e filtros */}
      <div className="flex flex-col gap-3 px-5 pt-4 pb-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, razão social, CNPJ, cidade ou identificador"
              aria-label="Buscar clientes"
              className="pl-8"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select value={plan} onValueChange={(v) => setPlan(v as "all" | ClientPlan)}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Filtrar por plano">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os planos</SelectItem>
                {(Object.keys(PLAN_LABEL) as ClientPlan[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    Plano {PLAN_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={management} onValueChange={(v) => setManagement(v as "all" | ClientManagement)}>
              <SelectTrigger className="w-full sm:w-52" aria-label="Filtrar por modo de gestão">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda gestão</SelectItem>
                <SelectItem value="engemase">{MANAGEMENT_LABEL.engemase}</SelectItem>
                <SelectItem value="self">{MANAGEMENT_LABEL.self}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="-mx-1 overflow-x-auto px-1">
          <div role="radiogroup" aria-label="Filtrar por status" className="flex w-max items-center gap-1.5">
            {pills.map((p) => {
              const active = status === p.value
              return (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setStatus(p.value)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {p.label}
                  <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-white/20" : "bg-muted")}>{counts[p.value]}</span>
                </button>
              )
            })}
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clear} className="h-8 text-xs">
                <XIcon />
                Limpar filtros
              </Button>
            )}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-5 pb-5">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2Icon />
              </EmptyMedia>
              <EmptyTitle>Nenhum cliente encontrado</EmptyTitle>
              <EmptyDescription>Ajuste a busca ou os filtros para ver outros clientes.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={clear}>
                Limpar filtros
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <div className="overflow-x-auto px-5 pb-2">
          <table className="w-full min-w-[980px] text-sm [&_td]:px-2.5 [&_td:first-child]:pl-0 [&_td:last-child]:pr-0 [&_th]:px-2.5 [&_th:first-child]:pl-0 [&_th:last-child]:pr-0">
            <thead className="border-b">
              <tr>
                <th className={TH}>Cliente</th>
                <th className={TH}>CNPJ · cidade/UF</th>
                <th className={TH}>Plano · gestão</th>
                <th className={TH}>Status</th>
                <th className={cn(TH, "text-right")}>
                  <abbr title="Unidades" className="no-underline">Unid.</abbr>
                </th>
                <th className={TH}>Máquinas</th>
                <th className={TH}>Gateways</th>
                <th className={TH}>Usuários</th>
                <th className={TH}>Criado</th>
                <th className={cn(TH, "text-right")}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((r) => {
                const st = statusOf(r)
                const actions = actionsFor(st)
                return (
                  <tr key={r.id} className={cn("transition-colors hover:bg-muted/40", st === "closed" && "opacity-60")}>
                    <td className={TD}>
                      <Link href={`/admin/clientes/${r.id}`} className="group block min-w-0 leading-tight">
                        <span className="block truncate font-semibold group-hover:text-primary">{r.name}</span>
                        <span className="block max-w-44 truncate text-xs text-muted-foreground">{r.legalName}</span>
                      </Link>
                    </td>
                    <td className={cn(TD, "text-xs whitespace-nowrap")}>
                      <div className="font-mono text-muted-foreground">{r.cnpj}</div>
                      <div>
                        {r.city}/{r.state}
                      </div>
                    </td>
                    <td className={TD}>
                      <div className="flex flex-col gap-1">
                        <PlanBadge plan={r.plan} />
                        <ManagementBadge management={r.management} short />
                      </div>
                    </td>
                    <td className={TD}>
                      <ClientStatusBadge status={st} />
                    </td>
                    <td className={cn(TD, "text-right tabular-nums")}>{r.units}</td>
                    <td className={TD}>
                      <div className="w-20">
                        <span className="text-xs tabular-nums">
                          <span className="font-semibold">{num(r.machines)}</span>
                          <span className="text-muted-foreground"> / {num(r.machinesLimit)}</span>
                        </span>
                        <UsageBar used={r.machines} limit={r.machinesLimit} className="mt-1" />
                      </div>
                    </td>
                    <td className={TD}>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs whitespace-nowrap tabular-nums" title={`Limite do plano: ${r.gatewaysLimit} gateways`}>
                          <span className="font-semibold">{r.gatewaysOnline}</span>
                          <span className="text-muted-foreground"> / {r.gateways} online</span>
                        </span>
                        {r.gatewaysProblem > 0 && (
                          <SoftBadge tone="red" dot>
                            {r.gatewaysProblem} com problema
                          </SoftBadge>
                        )}
                        {r.gatewaysPending > 0 && (
                          <SoftBadge tone="slate" dot>
                            {r.gatewaysPending} aguardando
                          </SoftBadge>
                        )}
                      </div>
                    </td>
                    <td className={cn(TD, "text-xs whitespace-nowrap tabular-nums")}>
                      <span className="font-semibold">{r.users}</span>
                      <span className="text-muted-foreground"> / {r.usersLimit}</span>
                    </td>
                    <td className={cn(TD, "text-xs whitespace-nowrap text-muted-foreground tabular-nums")}>{r.createdLabel}</td>
                    <td className={TD}>
                      <div className="flex items-center justify-end gap-1.5">
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger className={squareClass("slate")} aria-label={`Mais ações para ${r.name}`}>
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel className="truncate text-xs text-muted-foreground">{r.name}</DropdownMenuLabel>
                            <DropdownMenuItem onSelect={() => router.push(`/admin/clientes/${r.id}`)}>
                              <EyeIcon />
                              Abrir detalhe
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => enter(r)} disabled={st === "closed"}>
                              <LogInIcon />
                              Entrar como cliente
                            </DropdownMenuItem>
                            {actions.length > 0 && <DropdownMenuSeparator />}
                            {actions.map((a) => {
                              const Icon = ACTION_META[a].icon
                              return (
                                <DropdownMenuItem key={a} variant={a === "close" ? "destructive" : "default"} onSelect={() => openDialog(a, r)}>
                                  <Icon />
                                  {ACTION_META[a].label}
                                </DropdownMenuItem>
                              )
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
        <span>
          Mostrando {filtered.length} de {rows.length} {rows.length === 1 ? "cliente" : "clientes"}
          {status !== "all" && ` · ${STATUS_LABEL[status as AdminClientStatus]}`}
        </span>
        <span>Suspender não interrompe a coleta: os gateways continuam enviando dados.</span>
      </footer>

      <LifecycleDialog
        open={dialogOpen}
        action={dialog?.action ?? null}
        nonce={dialog?.nonce}
        client={{ name: dialog?.row.name ?? "", slug: dialog?.row.slug ?? "" }}
        onOpenChange={setDialogOpen}
        onConfirm={(a) => confirm(a)}
      />
    </section>
  )
}
