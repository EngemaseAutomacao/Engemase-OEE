"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { ArrowUpCircleIcon, CheckIcon, CopyIcon, CpuIcon, EyeIcon, SearchIcon, TriangleAlertIcon, Undo2Icon, XIcon } from "lucide-react"

import type { GatewayStatus } from "@/lib/mock/types"
import { dec, num } from "@/lib/format"
import { GATEWAY_STATUS_LABEL } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterPills, SoftBadge, SquareLink, TD, TH, normalize, squareClass } from "./bits"
import { useFleet } from "./fleet-context"
import type { FleetRow } from "./fleet-data"
import { GATEWAY_TONE } from "./labels"

type StatusFilter = "all" | GatewayStatus
type Condition = "all" | "problem" | "outdated" | "config" | "clock" | "buffer"

const CONDITION_LABEL: Record<Condition, string> = {
  all: "Todas as situações",
  problem: "Com algum problema",
  outdated: "Agente desatualizado",
  config: "Configuração pendente",
  clock: "Relógio com desvio",
  buffer: "Fila acumulada",
}

function matchesCondition(r: FleetRow, c: Condition): boolean {
  switch (c) {
    case "all":
      return true
    case "problem":
      return r.issues > 0
    case "outdated":
      return r.versionState === "outdated" || r.versionState === "unsupported"
    case "config":
      return r.configState === "pending"
    case "clock":
      return r.clockState === "alert" || r.clockState === "warn"
    case "buffer":
      return r.bufferState !== "ok"
  }
}

function clockLabel(ms: number): string {
  const sign = ms > 0 ? "+" : ms < 0 ? "−" : ""
  const abs = Math.abs(ms)
  return abs < 1000 ? `${sign}${abs} ms` : `${sign}${dec(abs / 1000)} s`
}

/** Tabela da frota de gateways de todos os clientes, com busca e filtros. */
export function FleetTable() {
  const { rows, clients, latest, scheduled, schedule, unschedule } = useFleet()
  const [query, setQuery] = useState("")
  const [client, setClient] = useState("all")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [condition, setCondition] = useState<Condition>("all")

  const base = useMemo(() => {
    const q = normalize(query.trim())
    return rows.filter((r) => {
      if (client !== "all" && r.clientId !== client) return false
      if (!matchesCondition(r, condition)) return false
      if (!q) return true
      return normalize(`${r.name} ${r.hostname} ${r.clientName} ${r.unitName} ${r.ipIt ?? ""} ${r.ipOt ?? ""} ${r.agentVersion ?? ""}`).includes(q)
    })
  }, [rows, client, condition, query])

  const filtered = status === "all" ? base : base.filter((r) => r.status === status)
  const count = (s: GatewayStatus) => base.filter((r) => r.status === s).length
  const hasFilters = query !== "" || client !== "all" || status !== "all" || condition !== "all"
  const clear = () => {
    setQuery("")
    setClient("all")
    setStatus("all")
    setCondition("all")
  }

  const update = (r: FleetRow) => {
    schedule([r.id], latest)
    toast.success(`Atualização para ${latest} agendada`, {
      description:
        r.status === "online"
          ? `${r.name} recebe o comando agent.update no próximo /sync. Rollback automático se não sincronizar em 5 min.`
          : `${r.name} está ${r.status === "offline" ? "offline" : "com alertas"}: a atualização começa quando ele voltar a sincronizar.`,
    })
  }
  const cancel = (r: FleetRow) => {
    unschedule([r.id])
    toast(`Atualização de ${r.name} cancelada`)
  }
  const copyCode = (code: string) => {
    void navigator.clipboard?.writeText(code).catch(() => undefined)
    toast.success("Código de ativação copiado", { description: `${code} · use no gateway: sudo oee-gateway enroll --code ${code}` })
  }

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <header className="flex flex-col gap-3 px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold">Gateways</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Todos os clientes · versão do agente, configuração, fila e relógio reportados no /sync</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por gateway, hostname, cliente, unidade, IP ou versão"
              aria-label="Buscar gateways"
              className="pl-8"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select value={client} onValueChange={setClient}>
              <SelectTrigger className="w-full sm:w-52" aria-label="Filtrar por cliente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={condition} onValueChange={(v) => setCondition(v as Condition)}>
              <SelectTrigger className="w-full sm:w-52" aria-label="Filtrar por situação">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CONDITION_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPills
            label="Filtrar por status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "Todos", count: base.length },
              { value: "online", label: "Online", count: count("online") },
              { value: "degraded", label: "Com alertas", count: count("degraded") },
              { value: "offline", label: "Offline", count: count("offline") },
              { value: "pending", label: "Aguardando ativação", count: count("pending") },
            ]}
          />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clear} className="h-8 text-xs">
              <XIcon />
              Limpar filtros
            </Button>
          )}
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="px-5 pb-5">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CpuIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhum gateway encontrado</EmptyTitle>
              <EmptyDescription>Ajuste a busca ou os filtros para ver outros gateways da frota.</EmptyDescription>
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
          <table className="w-full min-w-[1220px] text-sm">
            <thead className="border-b">
              <tr>
                <th className={TH}>Gateway</th>
                <th className={TH}>Cliente</th>
                <th className={TH}>Unidade</th>
                <th className={TH}>Status</th>
                <th className={TH}>Último contato</th>
                <th className={TH}>Agente</th>
                <th className={TH}>Config. aplicada × publicada</th>
                <th className={cn(TH, "text-right")}>Fila</th>
                <th className={cn(TH, "text-right")}>Relógio</th>
                <th className={cn(TH, "text-right")}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((r) => {
                const target = scheduled[r.id]
                const outdated = r.versionState === "outdated" || r.versionState === "unsupported"
                return (
                  <tr key={r.id} className="transition-colors hover:bg-muted/40">
                    <td className={TD}>
                      <div className="min-w-0 leading-tight">
                        <div className="truncate font-medium">{r.name}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {r.hostname} · {r.machines} máq. · {r.devices} CLP{r.devices === 1 ? "" : "s"}
                        </div>
                      </div>
                    </td>
                    <td className={TD}>
                      <div className="leading-tight">
                        <div className="truncate">{r.clientName}</div>
                        {r.clientStatus !== "active" && (
                          <div className="text-[11px] text-muted-foreground">{r.clientStatus === "suspended" ? "Cliente suspenso" : "Em implantação"}</div>
                        )}
                      </div>
                    </td>
                    <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{r.unitName}</td>
                    <td className={TD}>
                      <SoftBadge tone={GATEWAY_TONE[r.status]} dot>
                        {GATEWAY_STATUS_LABEL[r.status]}
                      </SoftBadge>
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      <div className={cn("leading-tight", r.status === "offline" && "text-state-fault")}>{r.lastSeen ? r.lastSeenAgo : "Nunca conectou"}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">{r.lastSeenAt}</div>
                    </td>
                    <td className={TD}>
                      <div className="flex flex-col gap-1">
                        {r.versionState === "none" ? (
                          <span className="text-xs text-muted-foreground">Não ativado</span>
                        ) : outdated ? (
                          <SoftBadge
                            tone={r.versionState === "unsupported" ? "red" : "amber"}
                            icon={TriangleAlertIcon}
                            title={r.versionState === "unsupported" ? "Versão sem suporte: atualize assim que o gateway voltar" : `Versão anterior à estável ${latest}`}
                          >
                            <span className="font-mono">{r.agentVersion}</span> · {r.versionState === "unsupported" ? "sem suporte" : "desatualizado"}
                          </SoftBadge>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span className="font-mono font-medium">{r.agentVersion}</span>
                            <span className="text-muted-foreground">{r.channel}</span>
                          </span>
                        )}
                        {target && (
                          <SoftBadge tone="teal" icon={ArrowUpCircleIcon}>
                            → {target} agendada
                          </SoftBadge>
                        )}
                      </div>
                    </td>
                    <td className={TD}>
                      {r.configState === "none" ? (
                        <span className="text-xs text-muted-foreground">v{r.configVersion} publicada · aguardando ativação</span>
                      ) : r.configState === "pending" ? (
                        <SoftBadge tone="amber" title="O gateway ainda não aplicou a última configuração publicada">
                          v{r.configApplied} de v{r.configVersion} · pendente
                        </SoftBadge>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <CheckIcon className="size-3.5 text-state-running" aria-hidden />
                          <span className="font-medium tabular-nums">v{r.configApplied}</span>
                          <span className="text-muted-foreground">= v{r.configVersion}</span>
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        TD,
                        "text-right font-semibold tabular-nums",
                        r.bufferState === "alert" ? "text-state-fault" : r.bufferState === "warn" ? "text-amber-700 dark:text-state-stopped" : "text-muted-foreground",
                      )}
                    >
                      {num(r.bufferPending)}
                    </td>
                    <td className={cn(TD, "text-right whitespace-nowrap")}>
                      {r.clockOffsetMs === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : r.clockState === "alert" ? (
                        <SoftBadge tone="red" icon={TriangleAlertIcon} title="Desvio acima de 2 s: verificar NTP/chrony">
                          {clockLabel(r.clockOffsetMs)}
                        </SoftBadge>
                      ) : (
                        <span className={cn("text-xs font-medium tabular-nums", r.clockState === "warn" ? "text-amber-700 dark:text-state-stopped" : "text-muted-foreground")}>
                          {clockLabel(r.clockOffsetMs)}
                        </span>
                      )}
                    </td>
                    <td className={TD}>
                      <div className="flex items-center justify-end gap-1.5">
                        {r.enrollmentCode && (
                          <button type="button" onClick={() => copyCode(r.enrollmentCode!)} aria-label={`Copiar código de ativação de ${r.name}`} title="Copiar código de ativação" className={squareClass("navy")}>
                            <CopyIcon aria-hidden />
                          </button>
                        )}
                        {outdated &&
                          (target ? (
                            <button type="button" onClick={() => cancel(r)} aria-label={`Cancelar atualização de ${r.name}`} title="Cancelar atualização" className={squareClass("slate")}>
                              <Undo2Icon aria-hidden />
                            </button>
                          ) : (
                            <button type="button" onClick={() => update(r)} aria-label={`Atualizar agente de ${r.name} para ${latest}`} title={`Atualizar para ${latest}`} className={squareClass("orange")}>
                              <ArrowUpCircleIcon aria-hidden />
                            </button>
                          ))}
                        {r.clientSlug && <SquareLink href={r.href} label={`Abrir ${r.name}`} icon={EyeIcon} tone="teal" />}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-5 pt-1 pb-4 text-[11px] text-muted-foreground">
        Relógio: diferença para o horário do servidor; acima de 2 s gera alerta. Fila: registros guardados no gateway aguardando envio (nada se perde enquanto estiver offline).
      </p>
    </section>
  )
}
