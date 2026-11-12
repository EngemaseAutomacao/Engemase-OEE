"use client"

import { useMemo, useState } from "react"
import {
  FactoryIcon,
  FileSpreadsheetIcon,
  Grid3x3Icon,
  PackageIcon,
  PackageSearchIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TimerIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { num, pct } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { norm, piecesPerHour, plural, seconds } from "@/components/config/labels"
import { CycleMatrixDialog, ImportCsvDialog, ProductDialog, type ProductDraft } from "@/components/config/product-dialogs"
import { ConfirmDialog, IconAction, PageTitle } from "@/components/config/ui-bits"
import { EngemaseOnlyChip, useCanEdit } from "@/components/config/engemase-managed"

export interface ProductMachine {
  id: string
  name: string
  code: string
  type: string
  lineName: string
  unitId: string
  unitName: string
  /** Ciclo ideal padrão da máquina (usado quando o produto não tem ciclo próprio). */
  defaultCycleS: number
}

export interface ProductRow {
  id: string
  code: string
  name: string
  /** machineId → ciclo ideal em segundos */
  cycles: Record<string, number>
  /** Máquinas produzindo este produto agora (códigos). */
  runningOn: string[]
}

/** Diferença relativa acima da qual o ciclo do produto merece conferência. */
const DEVIATION = 0.3

export function ProductsManager({
  initialProducts,
  machines,
  units,
}: {
  initialProducts: ProductRow[]
  machines: ProductMachine[]
  units: { id: string; name: string }[]
}) {
  const [products, setProducts] = useState(initialProducts)
  const canEdit = useCanEdit()
  const [query, setQuery] = useState("")
  const [unitId, setUnitId] = useState("all")
  const [editing, setEditing] = useState<ProductRow | "new" | null>(null)
  const [matrixOpen, setMatrixOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleting, setDeleting] = useState<ProductRow | null>(null)

  const machineById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines])
  const unitMachines = unitId === "all" ? machines : machines.filter((m) => m.unitId === unitId)
  const unitMachineIds = new Set(unitMachines.map((m) => m.id))

  const q = norm(query.trim())
  const visible = products.filter((p) => {
    const inUnit = unitId === "all" || Object.keys(p.cycles).some((id) => unitMachineIds.has(id)) || Object.keys(p.cycles).length === 0
    const match = !q || norm(`${p.code} ${p.name}`).includes(q)
    return inUnit && match
  })

  // Indicadores
  const combos = products.reduce((s, p) => s + Object.keys(p.cycles).length, 0)
  const covered = new Set(products.flatMap((p) => Object.keys(p.cycles)))
  const uncovered = machines.filter((m) => !covered.has(m.id))
  const running = products.filter((p) => p.runningOn.length > 0).length
  const deviations = products.flatMap((p) =>
    Object.entries(p.cycles)
      .map(([mid, c]) => ({ p, m: machineById.get(mid), c }))
      .filter((x) => x.m && Math.abs(x.c - x.m.defaultCycleS) / x.m.defaultCycleS > DEVIATION),
  )

  const save = (draft: ProductDraft) => {
    const cycles: Record<string, number> = {}
    for (const [mid, v] of Object.entries(draft.cycles)) {
      const n = Number(v.replace(",", "."))
      if (v.trim() && n > 0) cycles[mid] = n
    }
    if (draft.id) {
      setProducts((list) => list.map((p) => (p.id === draft.id ? { ...p, code: draft.code.trim(), name: draft.name.trim(), cycles } : p)))
      toast.success("Produto atualizado", { description: `${draft.code.trim()} · ${draft.name.trim()} · ${plural(Object.keys(cycles).length, "máquina", "máquinas")}` })
    } else {
      const id = `prd_new_${draft.code.trim()}`
      setProducts((list) => [...list, { id, code: draft.code.trim(), name: draft.name.trim(), cycles, runningOn: [] }])
      toast.success("Produto cadastrado", {
        description: `${draft.code.trim()} · ${draft.name.trim()}. Já pode ser escolhido na tela do operador.`,
      })
    }
    setEditing(null)
  }

  const saveMatrix = (next: Record<string, Record<string, number>>, changed: number) => {
    setProducts((list) => list.map((p) => (next[p.id] ? { ...p, cycles: next[p.id] } : p)))
    setMatrixOpen(false)
    toast.success("Matriz de ciclos salva", {
      description: changed ? `${plural(changed, "ciclo alterado", "ciclos alterados")}. O OEE dos turnos abertos é recalculado.` : "Nenhuma alteração.",
    })
  }

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageTitle
        title="Produtos"
        description="Ciclo ideal de cada produto em cada máquina: é a base da performance do OEE."
        actions={
          canEdit && (
            <>
              <EngemaseOnlyChip />
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <UploadIcon />
                Importar CSV
              </Button>
              <Button variant="outline" onClick={() => setMatrixOpen(true)} disabled={products.length === 0 || machines.length === 0}>
                <Grid3x3Icon />
                Matriz de ciclos
              </Button>
              <Button onClick={() => setEditing("new")}>
                <PlusIcon />
                Novo produto
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={PackageIcon} tone="blue" label="Produtos" value={num(products.length)} hint={`${running} em uso nas máquinas agora`} />
        <StatCard icon={TimerIcon} tone="navy" label="Ciclos ideais definidos" value={num(combos)} hint="produto × máquina" />
        <StatCard
          icon={FactoryIcon}
          tone="teal"
          label="Máquinas cobertas"
          value={
            <>
              {covered.size}
              <span className="text-base font-semibold text-muted-foreground"> / {machines.length}</span>
            </>
          }
          hint={`${pct(machines.length ? covered.size / machines.length : 0, 0)} com ciclo por produto`}
        />
        <StatCard
          icon={TriangleAlertIcon}
          tone="orange"
          label="Ciclos para conferir"
          value={num(deviations.length)}
          hint={`fora de ±${pct(DEVIATION, 0)} do padrão`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <SectionCard
          title="Catálogo de produtos"
          description={`${plural(visible.length, "produto", "produtos")}${q ? ` para “${query.trim()}”` : ""}`}
          className="xl:col-span-8"
          action={
            canEdit && products.length > 0 && machines.length > 0 ? (
              <button type="button" onClick={() => setMatrixOpen(true)} className="shrink-0 text-xs font-semibold text-primary hover:underline">
                Editar matriz
              </button>
            ) : undefined
          }
        >
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <InputGroup className="sm:max-w-72">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por código ou nome" aria-label="Buscar produto" />
            </InputGroup>
            {units.length > 1 && (
              <Select value={unitId} onValueChange={setUnitId}>
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
          </div>
          {visible.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PackageSearchIcon />
                </EmptyMedia>
                <EmptyTitle>{products.length === 0 ? "Nenhum produto cadastrado" : "Nenhum produto encontrado"}</EmptyTitle>
                <EmptyDescription>
                  {products.length === 0
                    ? canEdit
                      ? "Cadastre os produtos com o ciclo ideal de cada máquina, ou importe uma planilha CSV."
                      : "A equipe Engemase cadastra os produtos e o ciclo ideal de cada máquina. Para pedir, abra um chamado."
                    : "Tente outro código ou nome, ou mude a unidade."}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="flex-row flex-wrap justify-center">
                {products.length === 0 ? (
                  canEdit && (
                    <Button onClick={() => setEditing("new")}>
                      <PlusIcon />
                      Novo produto
                    </Button>
                  )
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQuery("")
                      setUnitId("all")
                    }}
                  >
                    Limpar filtros
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : (
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-16 text-xs">Código</TableHead>
                  <TableHead className="text-xs">Produto</TableHead>
                  <TableHead className="text-xs">Máquinas · ciclo ideal</TableHead>
                  <TableHead className="w-24 text-right text-xs">Capacidade</TableHead>
                  <TableHead className="w-20 text-right text-xs">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((p) => {
                  const entries = Object.entries(p.cycles)
                    .map(([mid, c]) => ({ m: machineById.get(mid), c }))
                    .filter((x): x is { m: ProductMachine; c: number } => !!x.m && (unitId === "all" || x.m.unitId === unitId))
                  const best = entries.length ? Math.min(...entries.map((x) => x.c)) : 0
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs font-semibold">{p.code}</TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{p.name}</div>
                        {p.runningOn.length > 0 && (
                          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-state-running">
                            <span className="size-1.5 rounded-full bg-state-running" />
                            Produto atual em {p.runningOn.join(", ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {entries.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Sem máquina · usa o ciclo padrão</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {entries.map(({ m, c }) => {
                              const off = Math.abs(c - m.defaultCycleS) / m.defaultCycleS > DEVIATION
                              return (
                                <span
                                  key={m.id}
                                  title={`${m.name} · padrão da máquina ${seconds(m.defaultCycleS)}`}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                                    off ? "bg-[#e96549]/12 text-[#cf5539]" : "bg-primary/8 text-foreground",
                                  )}
                                >
                                  <span className="font-mono font-semibold">{m.code}</span>
                                  <span className="tabular-nums">{seconds(c)}</span>
                                </span>
                              )
                            })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{best ? piecesPerHour(best) : "—"}</TableCell>
                      <TableCell>
                        {canEdit && (
                          <div className="flex justify-end gap-1.5">
                            <IconAction icon={PencilIcon} label={`Editar ${p.name}`} onClick={() => setEditing(p)} />
                            <IconAction icon={Trash2Icon} label={`Excluir ${p.name}`} tone="red" onClick={() => setDeleting(p)} />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <div className="flex flex-col gap-4 xl:col-span-4">
          <SectionCard title="Ciclo padrão por máquina" description="Usado quando o produto em produção não tem ciclo próprio">
            <ul className="divide-y">
              {unitMachines.map((m) => {
                const count = products.filter((p) => p.cycles[m.id]).length
                return (
                  <li key={m.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2c4e73]/10 text-[10px] font-bold text-[#2c4e73] dark:bg-white/10 dark:text-[#9cc3e6]">
                      {m.code.split("-").pop()}
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-medium">{m.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {m.lineName} · {count ? plural(count, "produto", "produtos") : "nenhum produto"}
                      </span>
                    </span>
                    <span className="text-right leading-tight">
                      <span className="block text-sm font-semibold tabular-nums">{seconds(m.defaultCycleS)}</span>
                      <span className="block text-[10px] text-muted-foreground">{piecesPerHour(m.defaultCycleS)}</span>
                    </span>
                  </li>
                )
              })}
              {unitMachines.length === 0 && <li className="py-4 text-center text-sm text-muted-foreground">Nenhuma máquina nesta unidade.</li>}
            </ul>
          </SectionCard>

          <SectionCard title="Como entra no OEE" description="Performance = ciclo ideal × peças ÷ tempo rodando">
            <div className="flex flex-col gap-3 text-xs text-muted-foreground">
              <p>
                O gateway lê o <span className="font-medium text-foreground">código do produto</span> no CLP (ou o operador troca na tela). Cada minuto de produção usa o
                ciclo ideal daquele produto naquela máquina.
              </p>
              {uncovered.length > 0 && (
                <p className="rounded-lg bg-[#e96549]/10 px-3 py-2 text-[#cf5539]">
                  {plural(uncovered.length, "máquina usa", "máquinas usam")} só o ciclo padrão: {uncovered.map((m) => m.code).join(", ")}.
                </p>
              )}
              {canEdit && (
                <Button variant="outline" size="sm" className="self-start" onClick={() => setImportOpen(true)}>
                  <FileSpreadsheetIcon />
                  Importar planilha de ciclos
                </Button>
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      <ProductDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        product={editing === "new" ? null : editing}
        machines={machines}
        existingCodes={products.filter((p) => editing === "new" || p.id !== (editing as ProductRow | null)?.id).map((p) => p.code)}
        onSave={save}
      />
      <CycleMatrixDialog open={matrixOpen} onOpenChange={setMatrixOpen} products={products} machines={machines} units={units} onSave={saveMatrix} />
      <ImportCsvDialog open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Excluir ${deleting?.name ?? "produto"}?`}
        description="O histórico de produção continua com o código do produto, mas ele deixa de aparecer na tela do operador e nos novos turnos."
        onConfirm={() => {
          if (!deleting) return
          setProducts((list) => list.filter((p) => p.id !== deleting.id))
          toast.success("Produto excluído", { description: `${deleting.code} · ${deleting.name}` })
          setDeleting(null)
        }}
      />
    </div>
  )
}
