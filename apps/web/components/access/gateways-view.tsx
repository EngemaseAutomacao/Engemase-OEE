"use client"

import { useMemo, useState } from "react"
import { LayersIcon, RouterIcon, SearchIcon, ShieldCheckIcon, TriangleAlertIcon, WifiIcon, WifiOffIcon } from "lucide-react"

import type { GatewayStatus } from "@/lib/mock/types"
import { GATEWAY_STATUS_LABEL } from "@/lib/roles"
import { Ring } from "@/components/dashboard/ring"
import { StatCard } from "@/components/dashboard/stat-card"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterPills, type PillOption } from "./filter-pills"
import { GatewayCard } from "./gateway-card"
import { STATUS_RANK, type GatewayRow } from "./gateway-view"
import { GATEWAY_STATUS_STYLE, norm, plural } from "./labels"
import { PageTitle } from "./page-title"
import { ProvisionGatewayDialog } from "./provision-dialog"

type StatusFilter = GatewayStatus | "all"
const STATUSES: GatewayStatus[] = ["online", "degraded", "offline", "pending"]

/** Lista de gateways do cliente: KPIs, filtros, cards e provisionamento. */
export function GatewaysView({
  clientSlug,
  managed,
  rows: initialRows,
  units,
  limit,
  freshExpiresLabel,
}: {
  clientSlug: string
  /** Cliente "gerenciado pela Engemase" (docs/15). */
  managed: boolean
  rows: GatewayRow[]
  units: { id: string; name: string }[]
  limit: number
  freshExpiresLabel: string
}) {
  const [rows, setRows] = useState(initialRows)
  const [status, setStatus] = useState<StatusFilter>("all")
  const [unit, setUnit] = useState("all")
  const [query, setQuery] = useState("")

  const counts = useMemo(() => {
    const c: Record<GatewayStatus, number> = { online: 0, degraded: 0, offline: 0, pending: 0 }
    rows.forEach((r) => c[r.status]++)
    return c
  }, [rows])

  const issues = rows.filter((r) => r.status === "degraded").reduce((s, r) => s + r.issues.length, 0)
  const offlineBuffer = rows.filter((r) => r.status === "offline").reduce((s, r) => s + r.bufferPending, 0)
  const devices = rows.reduce((s, r) => s + r.devices, 0)

  const visible = useMemo(() => {
    const q = norm(query.trim())
    return rows
      .filter((r) => status === "all" || r.status === status)
      .filter((r) => unit === "all" || r.unitId === unit)
      .filter((r) => !q || norm(`${r.name} ${r.hostname} ${r.unitName}`).includes(q))
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name, "pt-BR"))
  }, [rows, status, unit, query])

  const filtered = status !== "all" || unit !== "all" || query.trim() !== ""
  const clear = () => {
    setStatus("all")
    setUnit("all")
    setQuery("")
  }

  const pills: PillOption<StatusFilter>[] = [
    { value: "all", label: "Todos", count: rows.length },
    ...STATUSES.map((s) => ({ value: s, label: GATEWAY_STATUS_LABEL[s], count: counts[s], dot: GATEWAY_STATUS_STYLE[s].dot })),
  ]

  const provision = (
    <ProvisionGatewayDialog
      units={units}
      used={rows.length}
      limit={limit}
      expiresLabel={freshExpiresLabel}
      onCreated={(row) => {
        setRows((rs) => [...rs, row])
        setStatus("all")
      }}
    />
  )

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageTitle
        title="Gateways"
        description="Computadores de borda que leem os CLPs por Modbus TCP ou RTU (RS-485) e enviam os dados para a plataforma."
        actions={
          <>
            {managed && (
              <span className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-xs font-medium text-muted-foreground shadow-xs">
                <ShieldCheckIcon className="size-4 text-[#0e9384]" />
                Gerenciado pela Engemase
              </span>
            )}
            {provision}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={WifiIcon}
          tone="teal"
          label="Gateways online"
          value={
            <>
              {counts.online}
              <span className="text-base font-semibold text-muted-foreground"> / {rows.length}</span>
            </>
          }
          hint={counts.online > 0 ? "Sincronizando a cada 10 s" : "Nenhum gateway sincronizando"}
        />
        <StatCard
          icon={TriangleAlertIcon}
          tone="orange"
          label="Com alertas"
          value={counts.degraded}
          hint={counts.degraded > 0 ? `${plural(issues, "pendência", "pendências")} para revisar` : "Nenhuma pendência"}
        />
        <StatCard
          icon={WifiOffIcon}
          tone="red"
          label="Offline"
          value={counts.offline}
          hint={counts.offline > 0 ? `${plural(offlineBuffer, "leitura", "leituras")} guardadas no buffer` : "Todos com contato"}
        />
        <StatCard
          icon={LayersIcon}
          tone="blue"
          label="Uso do plano"
          value={
            <>
              {rows.length}
              <span className="text-base font-semibold text-muted-foreground"> / {limit}</span>
            </>
          }
          hint={counts.pending > 0 ? `${counts.pending} aguardando ativação` : `${plural(devices, "CLP", "CLPs")} conectados`}
          aside={<Ring value={limit > 0 ? rows.length / limit : 0} size={54} stroke={6} color="#257bb4" />}
        />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterPills label="Filtrar por status" options={pills} value={status} onChange={setStatus} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {units.length > 1 && (
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger className="w-full bg-card sm:w-48" aria-label="Filtrar por unidade">
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
          <InputGroup className="w-full bg-card sm:w-64">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou hostname" aria-label="Buscar gateway" />
          </InputGroup>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RouterIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum gateway cadastrado</EmptyTitle>
            <EmptyDescription>
              Cadastre o primeiro gateway para começar a coletar dados dos CLPs. Você recebe um código de ativação e os comandos de instalação.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{provision}</EmptyContent>
        </Empty>
      ) : visible.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed bg-card py-10">
          <EmptyHeader>
            <EmptyTitle className="text-base">Nenhum gateway encontrado</EmptyTitle>
            <EmptyDescription>Nenhum gateway corresponde aos filtros escolhidos.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={clear}>
              Limpar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {filtered && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Mostrando {visible.length} de {plural(rows.length, "gateway", "gateways")}.{" "}
              <button type="button" onClick={clear} className="font-semibold text-primary hover:underline">
                Limpar filtros
              </button>
            </p>
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            {visible.map((r) => (
              <GatewayCard key={r.id} row={r} href={`/${clientSlug}/config/gateways/${r.id}`} freshExpiresLabel={freshExpiresLabel} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
