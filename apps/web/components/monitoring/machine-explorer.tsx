"use client"

import { useMemo, useState } from "react"
import { LayoutGridIcon, ListIcon, SearchIcon, SearchXIcon, XIcon } from "lucide-react"

import { STATE_META, STATE_ORDER } from "@/lib/states"
import type { MachineState, MachineWithLive } from "@/lib/mock"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { StateDot } from "@/components/oee/state-badge"
import { MachineTable, type MachineRow } from "@/components/monitoring/machine-table"
import { MachineTile } from "@/components/refresh/machine-tile"

type View = "grid" | "table"

export interface ExplorerUnit {
  id: string
  name: string
}
export interface ExplorerLine {
  id: string
  name: string
  code: string
  unitId: string
}

/** Normaliza para busca sem acento e sem caixa. */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()

/** Lista de máquinas com filtros locais (unidade, linha, estado, busca) e alternância grade/tabela. */
export function MachineExplorer({
  machines,
  units,
  lines,
  clientSlug,
}: {
  machines: MachineWithLive[]
  units: ExplorerUnit[]
  lines: ExplorerLine[]
  clientSlug: string
}) {
  const [view, setView] = useState<View>("grid")
  const [query, setQuery] = useState("")
  const [unitId, setUnitId] = useState("all")
  const [lineId, setLineId] = useState("all")
  const [states, setStates] = useState<MachineState[]>([])

  const unitName = useMemo(() => new Map(units.map((u) => [u.id, u.name])), [units])
  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines])
  const visibleLines = unitId === "all" ? lines : lines.filter((l) => l.unitId === unitId)

  // Filtros de local e busca (antes do estado) — base para as contagens dos chips de estado.
  const scoped = useMemo(() => {
    const q = norm(query.trim())
    return machines.filter((m) => {
      if (unitId !== "all" && m.unitId !== unitId) return false
      if (lineId !== "all" && m.lineId !== lineId) return false
      if (!q) return true
      return [m.name, m.code, m.type, m.live?.productName ?? ""].some((v) => norm(v).includes(q))
    })
  }, [machines, unitId, lineId, query])

  const filtered = states.length === 0 ? scoped : scoped.filter((m) => states.includes(m.live?.state ?? "NO_COMM"))

  const stateCount = (s: MachineState) => scoped.filter((m) => (m.live?.state ?? "NO_COMM") === s).length
  const hasFilters = query !== "" || unitId !== "all" || lineId !== "all" || states.length > 0
  const clearFilters = () => {
    setQuery("")
    setUnitId("all")
    setLineId("all")
    setStates([])
  }

  const rows: MachineRow[] = filtered.map((m) => {
    const line = lineById.get(m.lineId)
    return { ...m, lineName: line?.name ?? "—", lineCode: line?.code ?? "", unitName: unitName.get(m.unitId) ?? "—" }
  })

  return (
    <div className="flex flex-col gap-4">
      {/* Barra compacta de filtros */}
      <section
        aria-label="Filtros de máquinas"
        className="flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:px-4"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <InputGroup className="lg:max-w-xs">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, código ou produto"
              aria-label="Buscar máquina"
            />
            {query && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Limpar busca" onClick={() => setQuery("")}>
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            {units.length > 1 && (
              <Select
                value={unitId}
                onValueChange={(v) => {
                  setUnitId(v)
                  setLineId("all")
                }}
              >
                <SelectTrigger className="w-full sm:w-48" aria-label="Unidade">
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
            <Select value={lineId} onValueChange={setLineId}>
              <SelectTrigger className="w-full sm:w-48" aria-label="Linha">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as linhas</SelectItem>
                {visibleLines.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ToggleGroup
            type="single"
            variant="outline"
            value={view}
            onValueChange={(v) => v && setView(v as View)}
            className="lg:ml-auto"
            aria-label="Modo de exibição"
          >
            <ToggleGroupItem value="grid" aria-label="Grade">
              <LayoutGridIcon />
              Grade
            </ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Tabela">
              <ListIcon />
              Tabela
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <ToggleGroup
            type="multiple"
            size="sm"
            spacing={1}
            value={states}
            onValueChange={(v) => setStates(v as MachineState[])}
            className="flex-wrap"
            aria-label="Filtrar por estado"
          >
            {STATE_ORDER.map((s) => {
              const n = stateCount(s)
              return (
                <ToggleGroupItem
                  key={s}
                  value={s}
                  className="gap-1.5 rounded-full bg-muted/60 px-3 text-xs data-[state=on]:bg-primary/10 data-[state=on]:font-semibold data-[state=on]:text-primary"
                  disabled={n === 0 && !states.includes(s)}
                >
                  <StateDot state={s} />
                  {STATE_META[s].short}
                  <span className="text-muted-foreground tabular-nums">{n}</span>
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {filtered.length} de {machines.length} {machines.length === 1 ? "máquina" : "máquinas"}
            </span>
            {hasFilters && (
              <Button variant="ghost" size="xs" onClick={clearFilters}>
                <XIcon />
                Limpar filtros
              </Button>
            )}
          </div>
        </div>
      </section>

      {filtered.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma máquina encontrada</EmptyTitle>
            <EmptyDescription>Nenhuma máquina corresponde aos filtros selecionados. Ajuste a busca ou limpe os filtros.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={clearFilters}>
              Limpar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {rows.map((m) => (
            <MachineTile key={m.id} machine={m} href={`/${clientSlug}/maquinas/${m.id}`} lineName={m.lineName} unitName={m.unitName} />
          ))}
        </div>
      ) : (
        <MachineTable rows={rows} clientSlug={clientSlug} />
      )}
    </div>
  )
}
