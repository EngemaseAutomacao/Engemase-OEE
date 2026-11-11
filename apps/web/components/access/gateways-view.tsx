"use client"

import { useMemo, useState } from "react"
import { RouterIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { GATEWAY_STATUS_LABEL } from "@/lib/roles"
import type { GatewayStatus } from "@/lib/mock/types"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { GatewayCard } from "./gateway-card"
import { STATUS_RANK, type GatewayRow } from "./gateway-view"
import { GATEWAY_STATUS_STYLE } from "./labels"
import { ProvisionGatewayDialog } from "./provision-dialog"

const STATUSES: GatewayStatus[] = ["online", "degraded", "offline", "pending"]

/** Lista de gateways do cliente: resumo por status (filtro), cards e provisionamento. */
export function GatewaysView({
  clientSlug,
  rows: initialRows,
  units,
  limit,
  expiresLabel,
  notice,
}: {
  clientSlug: string
  rows: GatewayRow[]
  units: { id: string; name: string }[]
  limit: number
  expiresLabel: string
  notice?: React.ReactNode
}) {
  const [rows, setRows] = useState(initialRows)
  const [filter, setFilter] = useState<GatewayStatus | null>(null)

  const counts = useMemo(() => {
    const c: Record<GatewayStatus, number> = { online: 0, degraded: 0, offline: 0, pending: 0 }
    rows.forEach((r) => c[r.status]++)
    return c
  }, [rows])

  const visible = useMemo(
    () => [...rows].filter((r) => !filter || r.status === filter).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name, "pt-BR")),
    [rows, filter],
  )

  const usedPct = limit > 0 ? (rows.length / limit) * 100 : 0

  const provision = (
    <ProvisionGatewayDialog units={units} used={rows.length} limit={limit} expiresLabel={expiresLabel} onCreated={(row) => setRows((rs) => [...rs, row])} />
  )

  return (
    <>
      <PageHeader
        title="Gateways"
        description="Computadores de borda que leem os CLPs por Modbus TCP ou Modbus RTU (RS-485) e enviam os dados para a plataforma."
        actions={provision}
      />

      {notice}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STATUSES.map((s) => {
          const active = filter === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(active ? null : s)}
              aria-pressed={active}
              className={cn(
                "flex flex-col gap-1 rounded-xl border bg-card px-4 py-3 text-left shadow-xs transition-colors outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active && "border-primary ring-1 ring-primary",
                counts[s] === 0 && !active && "opacity-70",
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span className={cn("size-2 rounded-full", GATEWAY_STATUS_STYLE[s].dot)} />
                {GATEWAY_STATUS_LABEL[s]}
              </span>
              <span className="text-2xl font-semibold tabular-nums">{counts[s]}</span>
            </button>
          )
        })}
        <Card className="col-span-2 gap-1.5 px-4 py-3 shadow-xs sm:col-span-1">
          <span className="text-xs font-medium text-muted-foreground">Uso do plano</span>
          <span className="text-2xl font-semibold tabular-nums">
            {rows.length}
            <span className="text-base font-normal text-muted-foreground"> / {limit}</span>
          </span>
          <Progress value={Math.min(100, usedPct)} className="h-1.5" aria-label={`${rows.length} de ${limit} gateways`} />
        </Card>
      </div>

      {filter && (
        <div className="-mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          Mostrando {visible.length} de {rows.length} gateways com status <span className="font-medium text-foreground">{GATEWAY_STATUS_LABEL[filter]}</span>
          <Button variant="ghost" size="xs" onClick={() => setFilter(null)}>
            <XIcon />
            Limpar filtro
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty className="border border-dashed">
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
        <Empty className="border border-dashed py-10">
          <EmptyHeader>
            <EmptyTitle className="text-base">Nenhum gateway com este status</EmptyTitle>
            <EmptyDescription>Ótimo sinal. Limpe o filtro para ver todos.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {visible.map((r) => (
            <GatewayCard key={r.id} row={r} href={`/${clientSlug}/config/gateways/${r.id}`} expiresLabel={expiresLabel} />
          ))}
        </div>
      )}
    </>
  )
}
