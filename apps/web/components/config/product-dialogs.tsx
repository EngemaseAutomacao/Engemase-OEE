"use client"

import { useState } from "react"
import { DownloadIcon, FileSpreadsheetIcon, RotateCcwIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { piecesPerHour, plural, seconds } from "@/components/config/labels"
import type { ProductMachine, ProductRow } from "@/components/config/products-manager"

export interface ProductDraft {
  id: string | null
  code: string
  name: string
  /** machineId → ciclo digitado (presença da chave = a máquina produz o item). */
  cycles: Record<string, string>
}

const parseCycle = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(",", ".")))
const fmtInput = (n: number) => String(n).replace(".", ",")

/** Agrupa máquinas por unidade e linha, na ordem recebida. */
function groupMachines(machines: ProductMachine[]) {
  const groups: { key: string; label: string; items: ProductMachine[] }[] = []
  for (const m of machines) {
    const key = `${m.unitName} · ${m.lineName}`
    const g = groups.find((x) => x.key === key)
    if (g) g.items.push(m)
    else groups.push({ key, label: key, items: [m] })
  }
  return groups
}

// ---------------------------------------------------------------------------
// Novo / editar produto
// ---------------------------------------------------------------------------

export function ProductDialog({
  open,
  onOpenChange,
  product,
  machines,
  existingCodes,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: ProductRow | null
  machines: ProductMachine[]
  existingCodes: string[]
  onSave: (draft: ProductDraft) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {open && <ProductForm key={product?.id ?? "new"} product={product} machines={machines} existingCodes={existingCodes} onSave={onSave} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ProductForm({
  product,
  machines,
  existingCodes,
  onSave,
  onCancel,
}: {
  product: ProductRow | null
  machines: ProductMachine[]
  existingCodes: string[]
  onSave: (draft: ProductDraft) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<ProductDraft>(() => ({
    id: product?.id ?? null,
    code: product?.code ?? "",
    name: product?.name ?? "",
    cycles: Object.fromEntries(Object.entries(product?.cycles ?? {}).map(([k, v]) => [k, fmtInput(v)])),
  }))
  const [show, setShow] = useState(false)

  const code = draft.code.trim()
  const errors = {
    code: !/^[A-Za-z0-9][A-Za-z0-9.\-/]{0,15}$/.test(code)
      ? "Use até 16 caracteres (letras, números, ponto, hífen ou barra)."
      : existingCodes.some((c) => c.toLowerCase() === code.toLowerCase())
        ? "Já existe um produto com este código."
        : null,
    name: draft.name.trim().length < 3 ? "Informe o nome do produto (mín. 3 caracteres)." : null,
    cycles: Object.values(draft.cycles).some((v) => !(parseCycle(v) > 0) || parseCycle(v) > 3600) ? "Cada máquina marcada precisa de um ciclo entre 0,1 e 3.600 s." : null,
  }
  const invalid = Object.values(errors).some(Boolean)
  const selected = Object.keys(draft.cycles).length

  const toggle = (m: ProductMachine, on: boolean) =>
    setDraft((d) => {
      const cycles = { ...d.cycles }
      if (on) cycles[m.id] = fmtInput(m.defaultCycleS)
      else delete cycles[m.id]
      return { ...d, cycles }
    })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setShow(true)
        if (!invalid) onSave(draft)
      }}
      className="flex flex-col"
    >
      <DialogHeader className="border-b px-6 pt-6 pb-4">
        <DialogTitle>{product ? `Editar ${product.name}` : "Novo produto"}</DialogTitle>
        <DialogDescription>O código deve ser o mesmo que o CLP envia no registrador de produto/receita.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-5 px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Field data-invalid={show && !!errors.code}>
            <FieldLabel htmlFor="prd-code">Código</FieldLabel>
            <Input id="prd-code" value={draft.code} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} className="font-mono" placeholder="Ex.: 1205" autoFocus />
            {show && errors.code && <FieldError>{errors.code}</FieldError>}
          </Field>
          <Field data-invalid={show && !!errors.name}>
            <FieldLabel htmlFor="prd-name">Nome</FieldLabel>
            <Input id="prd-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Ex.: Tampa 28 mm vermelha" />
            {show && errors.name && <FieldError>{errors.name}</FieldError>}
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Ciclo ideal por máquina</div>
              <p className="text-xs text-muted-foreground">Marque as máquinas que produzem o item. O valor sugerido é o ciclo padrão da máquina.</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{plural(selected, "máquina", "máquinas")}</span>
          </div>

          {groupMachines(machines).map((g) => (
            <fieldset key={g.key} className="rounded-xl border">
              <legend className="ml-3 px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.label}</legend>
              <ul className="divide-y">
                {g.items.map((m) => {
                  const on = m.id in draft.cycles
                  const v = draft.cycles[m.id] ?? ""
                  const n = parseCycle(v)
                  const bad = on && !(n > 0)
                  return (
                    <li key={m.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_8rem_6.5rem]">
                      <Checkbox id={`prd-m-${m.id}`} checked={on} onCheckedChange={(c) => toggle(m, c === true)} />
                      <label htmlFor={`prd-m-${m.id}`} className="min-w-0 cursor-pointer leading-tight">
                        <span className="block truncate text-sm font-medium">{m.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          <span className="font-mono">{m.code}</span> · padrão {seconds(m.defaultCycleS)}
                        </span>
                      </label>
                      <InputGroup className={cn("col-start-2 h-8 sm:col-start-auto", !on && "opacity-50")}>
                        <InputGroupInput
                          value={v}
                          onChange={(e) => setDraft((d) => ({ ...d, cycles: { ...d.cycles, [m.id]: e.target.value } }))}
                          disabled={!on}
                          inputMode="decimal"
                          className="text-right font-mono"
                          aria-label={`Ciclo ideal em ${m.name}`}
                          aria-invalid={show && bad}
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>s</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                      <span className="col-start-2 text-xs text-muted-foreground tabular-nums sm:col-start-auto sm:text-right">{on && n > 0 ? piecesPerHour(n) : "—"}</span>
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          ))}
          {show && errors.cycles && <p className="text-xs text-destructive">{errors.cycles}</p>}
          {selected === 0 && <FieldDescription className="text-xs">Sem máquina marcada, o OEE usa o ciclo padrão de cada máquina.</FieldDescription>}
        </div>
      </div>

      <DialogFooter className="border-t px-6 py-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">{product ? "Salvar alterações" : "Cadastrar produto"}</Button>
      </DialogFooter>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Matriz produto × máquina
// ---------------------------------------------------------------------------

export function CycleMatrixDialog({
  open,
  onOpenChange,
  products,
  machines,
  units,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: ProductRow[]
  machines: ProductMachine[]
  units: { id: string; name: string }[]
  onSave: (next: Record<string, Record<string, number>>, changed: number) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-5xl">
        {open && <MatrixForm products={products} machines={machines} units={units} onSave={onSave} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function MatrixForm({
  products,
  machines,
  units,
  onSave,
  onCancel,
}: {
  products: ProductRow[]
  machines: ProductMachine[]
  units: { id: string; name: string }[]
  onSave: (next: Record<string, Record<string, number>>, changed: number) => void
  onCancel: () => void
}) {
  const initial = () => Object.fromEntries(products.map((p) => [p.id, Object.fromEntries(machines.map((m) => [m.id, p.cycles[m.id] ? fmtInput(p.cycles[m.id]) : ""]))]))
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>(initial)
  const [unitId, setUnitId] = useState(units[0]?.id ?? "all")

  const cols = unitId === "all" ? machines : machines.filter((m) => m.unitId === unitId)
  const original = (pid: string, mid: string) => {
    const c = products.find((p) => p.id === pid)?.cycles[mid]
    return c ? fmtInput(c) : ""
  }
  let changed = 0
  let invalid = 0
  for (const p of products) {
    for (const m of machines) {
      const v = grid[p.id][m.id].trim()
      if (v !== original(p.id, m.id)) changed++
      if (v && !(parseCycle(v) > 0)) invalid++
    }
  }

  const submit = () => {
    const next: Record<string, Record<string, number>> = {}
    for (const p of products) {
      next[p.id] = {}
      for (const m of machines) {
        const n = parseCycle(grid[p.id][m.id])
        if (n > 0) next[p.id][m.id] = n
      }
    }
    onSave(next, changed)
  }

  return (
    <div className="flex flex-col">
      <DialogHeader className="border-b px-6 pt-6 pb-4">
        <DialogTitle>Matriz de ciclos ideais</DialogTitle>
        <DialogDescription>Segundos por peça (ou ciclo) de cada produto em cada máquina. Deixe em branco onde a máquina não produz o item.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {units.length > 1 ? (
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger size="sm" className="w-52" aria-label="Unidade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
                <SelectItem value="all">Todas as unidades</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">{units[0]?.name}</span>
          )}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-primary/20 ring-1 ring-primary/40" /> alterado
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-muted ring-1 ring-border" /> não produz
            </span>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="sticky left-0 z-10 min-w-48 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Produto</th>
                {cols.map((m) => (
                  <th key={m.id} className="px-1.5 py-2 text-center text-xs font-medium" title={`${m.name} · ${m.lineName}`}>
                    <div className="font-mono font-semibold">{m.code}</div>
                    <div className="font-normal text-muted-foreground">padrão {seconds(m.defaultCycleS)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-1.5 text-left font-normal">
                    <span className="mr-2 font-mono text-xs font-semibold">{p.code}</span>
                    <span className="text-xs">{p.name}</span>
                  </th>
                  {cols.map((m) => {
                    const v = grid[p.id][m.id]
                    const dirty = v.trim() !== original(p.id, m.id)
                    const bad = v.trim() !== "" && !(parseCycle(v) > 0)
                    return (
                      <td key={m.id} className="px-1.5 py-1.5 text-center">
                        <input
                          value={v}
                          onChange={(e) => setGrid((g) => ({ ...g, [p.id]: { ...g[p.id], [m.id]: e.target.value } }))}
                          inputMode="decimal"
                          placeholder="—"
                          aria-label={`Ciclo de ${p.name} em ${m.name}`}
                          aria-invalid={bad}
                          className={cn(
                            "h-8 w-[4.5rem] rounded-md border bg-transparent px-2 text-center font-mono text-xs tabular-nums outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                            v.trim() === "" && "bg-muted/60",
                            dirty && "border-primary/50 bg-primary/10",
                            bad && "border-destructive bg-destructive/10",
                          )}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {invalid > 0 && <p className="text-xs text-destructive">{plural(invalid, "célula inválida", "células inválidas")}: use números maiores que zero (ex.: 18 ou 1,2).</p>}
      </div>

      <DialogFooter className="items-center border-t px-6 py-4 sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {changed ? plural(changed, "alteração", "alterações") : "Nenhuma alteração"}
          {changed > 0 && (
            <Button type="button" variant="ghost" size="xs" onClick={() => setGrid(initial())}>
              <RotateCcwIcon />
              Desfazer
            </Button>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} disabled={invalid > 0}>
            Salvar matriz
          </Button>
        </div>
      </DialogFooter>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Importar CSV
// ---------------------------------------------------------------------------

const CSV_EXAMPLE = `codigo;produto;maquina;ciclo_s
1201;Tampa 28 mm branca;INJ-01;18
1201;Tampa 28 mm branca;INJ-02;18
1205;Tampa 28 mm vermelha;INJ-01;18,5`

export function ImportCsvDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar produtos por CSV</DialogTitle>
          <DialogDescription>Uma linha por produto × máquina. Produtos existentes são atualizados pelo código; os demais são criados.</DialogDescription>
        </DialogHeader>
        <pre className="overflow-x-auto rounded-xl bg-muted/60 p-3 font-mono text-[11px] leading-relaxed">{CSV_EXAMPLE}</pre>
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          <li>Separador ponto e vírgula, codificação UTF-8 (padrão do Excel em português).</li>
          <li>A coluna “maquina” usa o código da máquina (ex.: INJ-01). Ciclo em segundos, com vírgula decimal.</li>
        </ul>
        <button
          type="button"
          onClick={() => {
            onOpenChange(false)
            toast.success("ciclos-produtos.csv importado", {
              description: "14 linhas lidas · 2 produtos criados · 3 atualizados · 1 linha ignorada (máquina INJ-09 não existe).",
            })
          }}
          className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition hover:border-primary/50 hover:bg-primary/5"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UploadIcon className="size-5" />
          </span>
          <span className="text-sm font-medium">Escolher arquivo .csv</span>
          <span className="text-xs text-muted-foreground">ou arraste a planilha para cá</span>
        </button>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => toast.success("Modelo baixado", { description: "modelo-produtos.csv com as máquinas deste cliente." })}>
            <DownloadIcon />
            Baixar modelo
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <FileSpreadsheetIcon />
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
