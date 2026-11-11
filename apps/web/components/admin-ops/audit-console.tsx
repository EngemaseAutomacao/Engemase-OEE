"use client"

import { Fragment, useMemo, useState } from "react"
import { toast } from "sonner"
import { ClipboardListIcon, DownloadIcon, EyeIcon, HeadsetIcon, SearchIcon, ShieldCheckIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { FilterPills, PersonAvatar, SoftBadge, TD, TH, normalize, squareClass, type Tone } from "./bits"
import type { AuditData, AuditRow } from "./audit-data"
import { CATEGORY_LABEL, type AuditCategory } from "./labels"
import { downloadCsv } from "./csv"

type CategoryFilter = "all" | AuditCategory

const CATEGORY_TONE: Record<AuditCategory, Tone> = { platform: "navy", support: "orange", config: "blue", access: "violet", production: "teal" }
const ROW_ACCENT: Partial<Record<AuditCategory, string>> = {
  platform: "bg-[#2c4e73]/[0.04] shadow-[inset_3px_0_0_#2c4e73] dark:bg-white/[0.03] dark:shadow-[inset_3px_0_0_#9cc3e6]",
  support: "bg-[#e96549]/[0.05] shadow-[inset_3px_0_0_#e96549]",
}

/** Auditoria global: filtros por cliente, ação e pessoa; destaque para plataforma e suporte. */
export function AuditConsole({ data }: { data: AuditData }) {
  const [query, setQuery] = useState("")
  const [client, setClient] = useState("all")
  const [action, setAction] = useState("all")
  const [person, setPerson] = useState("all")
  const [category, setCategory] = useState<CategoryFilter>("all")
  const [detail, setDetail] = useState<AuditRow | null>(null)

  const actions = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of data.rows) map.set(r.action, r.actionLabel)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data.rows])
  const people = useMemo(() => [...new Set(data.rows.map((r) => r.actorName))].sort((a, b) => a.localeCompare(b)), [data.rows])

  const base = useMemo(() => {
    const q = normalize(query.trim())
    return data.rows.filter((r) => {
      if (client === "platform" ? r.clientId !== null : client !== "all" && r.clientId !== client) return false
      if (action !== "all" && r.action !== action) return false
      if (person !== "all" && r.actorName !== person) return false
      if (!q) return true
      return normalize(`${r.actorName} ${r.clientName} ${r.actionLabel} ${r.action} ${r.entityName} ${r.details}`).includes(q)
    })
  }, [data.rows, query, client, action, person])

  const filtered = category === "all" ? base : base.filter((r) => r.category === category)
  const count = (c: AuditCategory) => base.filter((r) => r.category === c).length
  const hasFilters = query !== "" || client !== "all" || action !== "all" || person !== "all" || category !== "all"
  const clear = () => {
    setQuery("")
    setClient("all")
    setAction("all")
    setPerson("all")
    setCategory("all")
  }

  const exportCsv = () => {
    downloadCsv(
      "auditoria-plataforma.csv",
      ["data_hora", "pessoa", "tipo", "exibido_ao_cliente_como", "cliente", "acao", "codigo_acao", "item", "detalhes"],
      filtered.map((r) => [r.fullLabel, r.actorName, r.actorRole, r.impersonatedBy ?? "", r.clientName, r.actionLabel, r.action, `${r.entityLabel}: ${r.entityName}`, r.details]),
    )
    toast.success("Exportação gerada", { description: `${filtered.length} evento(s) com os filtros atuais · auditoria-plataforma.csv` })
  }

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <header className="flex flex-col gap-3 px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold">Eventos</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Registro só de inserção · eventos com cliente também aparecem na auditoria do próprio cliente</p>
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <DownloadIcon />
            <span className="hidden sm:inline">Exportar CSV</span>
          </Button>
        </div>
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar em pessoa, item ou detalhes" aria-label="Buscar na auditoria" className="pl-8" />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:flex">
            <Select value={client} onValueChange={setClient}>
              <SelectTrigger className="w-full xl:w-48" aria-label="Filtrar por cliente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                <SelectItem value="platform">Só plataforma (sem cliente)</SelectItem>
                {data.clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="w-full xl:w-52" aria-label="Filtrar por ação">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as ações</SelectItem>
                {actions.map(([code, label]) => (
                  <SelectItem key={code} value={code}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={person} onValueChange={setPerson}>
              <SelectTrigger className="w-full xl:w-44" aria-label="Filtrar por pessoa">
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
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPills
            label="Filtrar por tipo de evento"
            value={category}
            onChange={setCategory}
            options={[
              { value: "all", label: "Todos", count: base.length },
              ...(Object.keys(CATEGORY_LABEL) as AuditCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c], count: count(c) })),
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
                <ClipboardListIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhum evento encontrado</EmptyTitle>
              <EmptyDescription>Nenhum registro combina com a busca e os filtros escolhidos.</EmptyDescription>
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
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="border-b">
              <tr>
                <th className={cn(TH, "first:pl-3")}>Hora</th>
                <th className={TH}>Pessoa</th>
                <th className={TH}>Cliente</th>
                <th className={TH}>Ação</th>
                <th className={TH}>Item</th>
                <th className={TH}>Detalhes</th>
                <th className={cn(TH, "text-right")}>
                  <span className="sr-only">Abrir</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const newDay = i === 0 || filtered[i - 1]!.dayKey !== r.dayKey
                return (
                  <Fragment key={r.id}>
                    {newDay && (
                      <tr>
                        <td colSpan={7} className="pt-4 pb-1.5 pl-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                          {r.dayLabel}
                        </td>
                      </tr>
                    )}
                    <tr className={cn("border-t transition-colors hover:bg-muted/40", ROW_ACCENT[r.category])}>
                      <td className={cn(TD, "w-16 font-medium whitespace-nowrap tabular-nums first:pl-3")}>{r.timeLabel}</td>
                      <td className={TD}>
                        <div className="flex items-center gap-2.5">
                          <PersonAvatar name={r.actorName} tone={r.actorKind === "engemase" ? "navy" : "slate"} size="sm" />
                          <div className="min-w-0 leading-tight">
                            <div className="truncate font-medium">{r.actorName}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{r.actorRole}</div>
                          </div>
                        </div>
                      </td>
                      <td className={cn(TD, "whitespace-nowrap", r.clientId === null && "text-muted-foreground italic")}>{r.clientName}</td>
                      <td className={TD}>
                        <SoftBadge
                          tone={CATEGORY_TONE[r.category]}
                          icon={r.category === "support" ? HeadsetIcon : r.category === "platform" ? ShieldCheckIcon : undefined}
                          title={`${CATEGORY_LABEL[r.category]} · ${r.action}`}
                        >
                          {r.actionLabel}
                        </SoftBadge>
                      </td>
                      <td className={TD}>
                        <div className="max-w-56 leading-tight">
                          <div className="truncate">{r.entityName}</div>
                          <div className="text-[11px] text-muted-foreground">{r.entityLabel}</div>
                        </div>
                      </td>
                      <td className={cn(TD, "max-w-80 text-xs text-muted-foreground")}>
                        <span className="line-clamp-2">{r.details || "—"}</span>
                        {r.impersonatedBy && <span className="mt-0.5 block font-medium text-[#cf5539]">Exibido ao cliente como “{r.impersonatedBy}”</span>}
                      </td>
                      <td className={cn(TD, "text-right")}>
                        <button type="button" onClick={() => setDetail(r)} className={squareClass("slate")} aria-label={`Ver detalhes do evento ${r.actionLabel} de ${r.actorName}`}>
                          <EyeIcon aria-hidden />
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-5 pt-1 pb-4 text-[11px] text-muted-foreground">
        Mostrando {filtered.length} de {data.rows.length} eventos desde {data.since}. Linhas destacadas: ações de plataforma (azul-marinho) e acessos do suporte Engemase (laranja).
      </p>

      <Sheet open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle>{detail.actionLabel}</SheetTitle>
                <SheetDescription>
                  {detail.fullLabel} · {detail.clientName}
                </SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 px-4 pb-6">
                <div className="flex flex-wrap gap-1.5">
                  <SoftBadge tone={CATEGORY_TONE[detail.category]}>{CATEGORY_LABEL[detail.category]}</SoftBadge>
                  <SoftBadge tone={detail.clientId ? "green" : "slate"}>{detail.clientId ? "Visível ao cliente" : "Só no console"}</SoftBadge>
                </div>
                <dl className="grid gap-2.5 rounded-xl bg-muted/60 p-3 text-sm">
                  {[
                    ["Pessoa", `${detail.actorName} (${detail.actorRole})`],
                    ["Exibido ao cliente", detail.impersonatedBy ?? "—"],
                    ["Cliente", detail.clientName],
                    ["Item", `${detail.entityLabel}: ${detail.entityName}`],
                    ["Código da ação", detail.action],
                    ["Registro", detail.id],
                  ].map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-2">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className={cn("min-w-0 text-xs font-medium break-words", (k === "Código da ação" || k === "Registro") && "font-mono")}>{v}</dd>
                    </div>
                  ))}
                </dl>
                <div>
                  <div className="mb-1 text-xs font-semibold">Detalhes</div>
                  <p className="text-sm text-muted-foreground">{detail.details || "Sem detalhes adicionais."}</p>
                </div>
                {detail.category === "support" && (
                  <p className="rounded-lg border border-[#e96549]/30 bg-[#e96549]/5 p-3 text-xs">
                    Acesso de suporte da Engemase: aparece com faixa na tela do cliente e na auditoria dele, com pessoa, chamado e duração.
                  </p>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  )
}
