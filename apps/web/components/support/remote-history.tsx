"use client"

import { useState } from "react"
import { BanIcon, DownloadIcon, EyeIcon, FileDownIcon, FileSpreadsheetIcon, FileTextIcon, HistoryIcon, PlugZapIcon, PowerOffIcon, SendIcon, ShieldCheckIcon, type LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { duration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { CONNECTION_LABEL, bytesLabel, dateTimeOf, minutesLabel } from "./remote-labels"
import { isHistory, useRemote } from "./remote-provider"
import { StatusChip } from "./remote-sessions"
import type { RemoteSessionVM } from "./remote-types"

type Filter = "all" | "ended" | "declined"

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "ended", label: "Realizadas" },
  { id: "declined", label: "Recusadas e expiradas" },
]

const realDuration = (s: RemoteSessionVM) => (s.startedMs !== null && s.endedMs !== null ? duration((s.endedMs - s.startedMs) / 1000) : null)

/** Botão "Exportar histórico" (CSV de verdade; PDF simulado). */
export function ExportHistoryMenu({ variant = "outline", size = "default", className }: { variant?: "outline" | "ghost"; size?: "default" | "xs"; className?: string }) {
  const { exportHistory } = useRemote()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <DownloadIcon />
          Exportar histórico
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Para a auditoria do cliente</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => exportHistory("csv")}>
          <FileSpreadsheetIcon />
          Planilha (CSV)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => exportHistory("pdf")}>
          <FileTextIcon />
          Relatório (PDF)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TimelineItem({ icon, tone, title, detail, at, last }: { icon: LucideIcon; tone: IconTone; title: string; detail?: React.ReactNode; at: string; last?: boolean }) {
  return (
    <li className="relative grid grid-cols-[2rem_1fr] gap-3 pb-5 last:pb-0">
      {!last && <span className="absolute top-9 bottom-1 left-4 w-px -translate-x-1/2 bg-border" aria-hidden />}
      <IconCircle icon={icon} tone={tone} soft size="sm" />
      <div className="min-w-0 pt-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{at}</span>
        </div>
        {detail && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{detail}</div>}
      </div>
    </li>
  )
}

function SessionSheet({ s, open, onOpenChange }: { s: RemoteSessionVM | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  if (!s) return <Sheet open={false} onOpenChange={onOpenChange} />
  const rejected = s.status === "rejected"
  const items: { icon: LucideIcon; tone: IconTone; title: string; detail?: React.ReactNode; at: string }[] = [
    {
      icon: SendIcon,
      tone: "navy",
      title: `Pedido de ${s.requestedBy}`,
      detail: (
        <>
          {minutesLabel(s.requestedDurationMin)} · chamado {s.ticket} · “{s.reason}”
          {s.requestedPlc && (
            <>
              <br />
              Inclui {s.requestedPlc.deviceName} ({s.requestedPlc.target})
            </>
          )}
        </>
      ),
      at: dateTimeOf(s.requestedMs),
    },
  ]
  if (s.decidedMs !== null) {
    items.push(
      rejected
        ? { icon: BanIcon, tone: "red", title: `Recusado por ${s.decidedBy ?? "admin do cliente"}`, detail: s.endedReason?.replace(/^Recusado:\s*/, ""), at: dateTimeOf(s.decidedMs) }
        : {
            icon: ShieldCheckIcon,
            tone: "teal",
            title: `Aprovado por ${s.decidedBy ?? "admin do cliente"}`,
            detail: s.changes.length ? s.changes.join(" · ") : "Com MFA · aprovação assinada enviada ao gateway",
            at: dateTimeOf(s.decidedMs),
          },
    )
  }
  if (s.startedMs !== null) {
    items.push({ icon: PlugZapIcon, tone: "blue", title: "Técnico conectado", detail: s.connection ? CONNECTION_LABEL[s.connection] : undefined, at: dateTimeOf(s.startedMs) })
  }
  if (s.status === "ended" && s.endedMs !== null) {
    items.push({ icon: PowerOffIcon, tone: "slate", title: "Sessão encerrada", detail: s.endedReason ?? undefined, at: dateTimeOf(s.endedMs) })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="gap-1.5 border-b px-5 pt-5 pb-4">
          <div className="pr-8">
            <StatusChip status={s.status} />
          </div>
          <SheetTitle className="text-lg font-bold">
            {s.gatewayName} · {s.ticket}
          </SheetTitle>
          <SheetDescription>
            {s.requestedBy} · {s.requestedByRole}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <ol>
            {items.map((it, i) => (
              <TimelineItem key={it.title} {...it} last={i === items.length - 1} />
            ))}
          </ol>
          <dl className="mt-6 grid grid-cols-2 gap-3 rounded-xl bg-muted/60 p-3">
            <div>
              <dt className="text-[11px] text-muted-foreground">Duração real</dt>
              <dd className="text-sm font-semibold">{realDuration(s) ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Aprovada</dt>
              <dd className="text-sm font-semibold">{s.decidedMs !== null && !rejected ? minutesLabel(s.durationMin) : "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Tráfego</dt>
              <dd className="text-sm font-semibold">{bytesLabel(s.bytes)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Escopo</dt>
              <dd className="text-sm font-semibold">{s.plc ? "SSH + CLP" : "SSH no gateway"}</dd>
            </div>
          </dl>
        </div>
        {s.startedMs !== null && (
          <div className="border-t px-5 py-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={() =>
                toast.success("Log de comandos baixado", {
                  description: `Registro do sudo da sessão ${s.ticket} no ${s.gatewayName}, com hash de integridade.`,
                })
              }
            >
              <FileDownIcon />
              Baixar log de comandos
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

export function RemoteHistory({ className }: { className?: string }) {
  const { sessions } = useRemote()
  const [filter, setFilter] = useState<Filter>("all")
  const [selected, setSelected] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const history = sessions.filter(isHistory).sort((a, b) => b.requestedMs - a.requestedMs)
  const rows = history.filter((s) => (filter === "all" ? true : filter === "ended" ? s.status === "ended" : s.status !== "ended"))
  const current = selected ? (sessions.find((s) => s.id === selected) ?? null) : null

  return (
    <SectionCard
      title="Histórico de sessões"
      description="Pedidos, aprovações, conexões e encerramentos · retenção de 5 anos"
      action={<ExportHistoryMenu variant="ghost" size="xs" className="shrink-0 font-semibold text-primary" />}
      className={className}
    >
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar histórico">
        {FILTERS.map((f) => {
          const n = f.id === "all" ? history.length : f.id === "ended" ? history.filter((s) => s.status === "ended").length : history.filter((s) => s.status !== "ended").length
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition hover:bg-muted",
                filter === f.id && "border-primary bg-primary/10 text-primary hover:bg-primary/10",
              )}
            >
              {f.label}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          )
        })}
      </div>

      {rows.length > 0 ? (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] text-muted-foreground uppercase">
                <th className="py-2 pr-3 font-semibold">Pedido</th>
                <th className="py-2 pr-3 font-semibold">Gateway</th>
                <th className="py-2 pr-3 font-semibold">Técnico · chamado</th>
                <th className="py-2 pr-3 font-semibold">Duração</th>
                <th className="py-2 pr-3 font-semibold">Tráfego</th>
                <th className="py-2 pr-3 font-semibold">Resultado</th>
                <th className="py-2 text-right font-semibold">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((s) => (
                <tr key={s.id} className="align-top">
                  <td className="py-3 pr-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{dateTimeOf(s.requestedMs)}</td>
                  <td className="py-3 pr-3">
                    <div className="font-medium whitespace-nowrap">{s.gatewayName}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{s.hostname}</div>
                  </td>
                  <td className="max-w-[260px] py-3 pr-3">
                    <div className="font-medium">
                      {s.requestedBy} <span className="text-xs font-normal text-muted-foreground">· {s.ticket}</span>
                    </div>
                    <div className="line-clamp-1 text-xs text-muted-foreground" title={s.reason}>
                      {s.reason}
                    </div>
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    {realDuration(s) ? (
                      <>
                        <div className="font-medium tabular-nums">{realDuration(s)}</div>
                        <div className="text-[11px] text-muted-foreground">de {minutesLabel(s.durationMin)} aprovadas</div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap tabular-nums">{bytesLabel(s.bytes)}</td>
                  <td className="max-w-[220px] py-3 pr-3">
                    <StatusChip status={s.status} />
                    {s.endedReason && <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{s.endedReason}</div>}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(s.id)
                        setSheetOpen(true)
                      }}
                      aria-label={`Detalhes da sessão ${s.ticket}`}
                      className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition hover:bg-primary/20"
                    >
                      <EyeIcon className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty className="border p-6 md:p-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>Nada por aqui</EmptyTitle>
            <EmptyDescription>Nenhuma sessão neste filtro. Todo pedido, aprovação e encerramento aparece aqui e na Auditoria.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <SessionSheet s={current} open={sheetOpen} onOpenChange={setSheetOpen} />
    </SectionCard>
  )
}
