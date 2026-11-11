"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { CableIcon, DownloadIcon, HistoryIcon, TerminalIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterPills, PersonAvatar, SoftBadge, TD, TH } from "./bits"
import { downloadCsv } from "./csv"
import { STATUS_META } from "./labels"
import { useRemote } from "./remote-context"

type Outcome = "all" | "ended" | "refused" | "revoked"

const OUTCOME_OF = (s: string): Exclude<Outcome, "all"> | null =>
  s === "ended" ? "ended" : s === "rejected" || s === "expired_unapproved" || s === "cancelled" ? "refused" : s === "revoked" ? "revoked" : null

/** Histórico de sessões de todos os clientes, com filtros e exportação. */
export function RemoteHistory() {
  const { sessions, targets } = useRemote()
  const [client, setClient] = useState("all")
  const [outcome, setOutcome] = useState<Outcome>("all")

  const history = useMemo(() => sessions.filter((s) => OUTCOME_OF(s.status) !== null), [sessions])
  const base = client === "all" ? history : history.filter((s) => s.clientId === client)
  const filtered = outcome === "all" ? base : base.filter((s) => OUTCOME_OF(s.status) === outcome)
  const count = (o: Exclude<Outcome, "all">) => base.filter((s) => OUTCOME_OF(s.status) === o).length
  const hasFilters = client !== "all" || outcome !== "all"
  const clear = () => {
    setClient("all")
    setOutcome("all")
  }

  const exportCsv = () => {
    downloadCsv(
      "acesso-remoto-historico.csv",
      ["solicitada_em", "cliente", "gateway", "tecnico", "chamado", "motivo", "escopo", "decisao", "resultado", "duracao", "encerramento", "dados"],
      filtered.map((s) => [
        s.requestedLabel,
        s.clientName,
        s.gatewayName,
        s.requestedBy,
        s.ticket,
        s.reason,
        [s.ssh ? "SSH" : "", s.plc ? `CLP ${s.plc.target}` : ""].filter(Boolean).join(" + "),
        s.approvedLabel ?? "",
        STATUS_META[s.status].label,
        s.realDuration ?? "",
        s.endedReason ?? "",
        s.bytes ?? "",
      ]),
    )
    toast.success("Histórico exportado", { description: `${filtered.length} sessão(ões) · acesso-remoto-historico.csv` })
  }

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <header className="flex flex-col gap-3 px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold">Histórico</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Sessões encerradas, recusadas e revogadas · eventos guardados por 5 anos</p>
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <DownloadIcon />
            <span className="hidden sm:inline">Exportar CSV</span>
          </Button>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <Select value={client} onValueChange={setClient}>
            <SelectTrigger className="w-full md:w-56" aria-label="Filtrar por cliente">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os clientes</SelectItem>
              {targets.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <FilterPills
              label="Filtrar por resultado"
              value={outcome}
              onChange={setOutcome}
              options={[
                { value: "all", label: "Todas", count: base.length },
                { value: "ended", label: "Encerradas", count: count("ended") },
                { value: "refused", label: "Recusadas ou canceladas", count: count("refused") },
                { value: "revoked", label: "Revogadas", count: count("revoked") },
              ]}
            />
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clear} className="h-8 text-xs">
                <XIcon />
                Limpar
              </Button>
            )}
          </div>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="px-5 pb-5">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HistoryIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhuma sessão no histórico</EmptyTitle>
              <EmptyDescription>Não há sessões com esses filtros.</EmptyDescription>
            </EmptyHeader>
            {hasFilters && (
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={clear}>
                  Limpar filtros
                </Button>
              </EmptyContent>
            )}
          </Empty>
        </div>
      ) : (
        <div className="overflow-x-auto px-5 pb-4">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="border-b">
              <tr>
                <th className={TH}>Solicitada</th>
                <th className={TH}>Cliente · gateway</th>
                <th className={TH}>Técnico</th>
                <th className={TH}>Chamado e motivo</th>
                <th className={TH}>Escopo</th>
                <th className={TH}>Decisão do cliente</th>
                <th className={TH}>Resultado</th>
                <th className={cn(TH, "text-right")}>Duração</th>
                <th className={cn(TH, "text-right")}>Dados</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((s) => (
                <tr key={s.id} className="align-top transition-colors hover:bg-muted/40">
                  <td className={cn(TD, "whitespace-nowrap tabular-nums")}>{s.requestedLabel}</td>
                  <td className={TD}>
                    <div className="leading-tight">
                      <div className="truncate font-medium">{s.gatewayName}</div>
                      <div className="truncate text-xs text-muted-foreground">{s.clientName}</div>
                    </div>
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <PersonAvatar name={s.requestedBy} tone="navy" size="sm" />
                      <span className="truncate">{s.requestedBy}</span>
                    </div>
                  </td>
                  <td className={cn(TD, "max-w-72")}>
                    <div className="text-xs font-semibold">{s.ticket}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{s.reason}</div>
                  </td>
                  <td className={TD}>
                    <div className="flex flex-col gap-1">
                      {s.ssh && (
                        <SoftBadge tone="navy" icon={TerminalIcon}>
                          SSH
                        </SoftBadge>
                      )}
                      {s.plc && (
                        <SoftBadge tone="orange" icon={CableIcon} title={s.plc.deviceName}>
                          CLP {s.plc.target}
                        </SoftBadge>
                      )}
                    </div>
                  </td>
                  <td className={cn(TD, "text-xs text-muted-foreground")}>{s.approvedLabel ?? "—"}</td>
                  <td className={TD}>
                    <SoftBadge tone={STATUS_META[s.status].tone} dot>
                      {STATUS_META[s.status].label}
                    </SoftBadge>
                    {s.endedReason && <div className="mt-1 max-w-56 text-[11px] text-muted-foreground">{s.endedReason}</div>}
                  </td>
                  <td className={cn(TD, "text-right whitespace-nowrap tabular-nums")}>
                    {s.realDuration ?? "—"}
                    {s.realDuration && <div className="text-[11px] text-muted-foreground">de {s.durationMin >= 60 ? `${s.durationMin / 60} h` : `${s.durationMin} min`}</div>}
                  </td>
                  <td className={cn(TD, "text-right whitespace-nowrap text-muted-foreground tabular-nums")}>
                    {s.bytes ?? "—"}
                    {s.connection && <div className="text-[11px]">{s.connection === "relay" ? "relay" : "direta"}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
