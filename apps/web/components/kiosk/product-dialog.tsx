"use client"

import { Fragment, useMemo, useState } from "react"
import { BoxesIcon, SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { dec } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import type { ProductOption } from "@/components/kiosk/operator-types"

const cycle = (s: number) => (Number.isInteger(s) ? `${s} s` : `${dec(s)} s`)

export function ProductDialog({
  open,
  onOpenChange,
  machineName,
  products,
  currentCode,
  defaultCycleS,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  machineName: string
  products: ProductOption[]
  currentCode: string
  defaultCycleS: number
  onConfirm: (product: ProductOption) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        {open && (
          <ProductBody
            machineName={machineName}
            products={products}
            currentCode={currentCode}
            defaultCycleS={defaultCycleS}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ProductBody({
  machineName,
  products,
  currentCode,
  defaultCycleS,
  onCancel,
  onConfirm,
}: {
  machineName: string
  products: ProductOption[]
  currentCode: string
  defaultCycleS: number
  onCancel: () => void
  onConfirm: (product: ProductOption) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products
      .filter((p) => !q || `${p.code} ${p.name}`.toLowerCase().includes(q))
      .sort((a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name, "pt-BR"))
  }, [products, query])

  const choice = products.find((p) => p.id === selected) ?? null

  return (
    <>
      <DialogHeader className="border-b p-4 text-left sm:p-5">
        <DialogTitle className="text-xl sm:text-2xl">Trocar produto</DialogTitle>
        <DialogDescription>
          Escolha o produto que entra em produção agora na {machineName}. O ciclo ideal do novo produto passa a valer para a performance a
          partir deste momento.
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-5">
        {products.length > 6 && (
          <InputGroup className="h-12">
            <InputGroupAddon>
              <SearchIcon className="size-5" />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por código ou nome"
              aria-label="Buscar produto"
              className="text-base md:text-base"
            />
          </InputGroup>
        )}

        {visible.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BoxesIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhum produto encontrado</EmptyTitle>
              <EmptyDescription>
                {products.length === 0
                  ? "Nenhum produto cadastrado para este cliente. Peça ao supervisor para cadastrar."
                  : "Confira o código ou o nome digitado."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div role="radiogroup" aria-label="Produtos" className="grid gap-2">
            {visible.map((p, i) => {
              const current = p.code === currentCode
              const active = selected === p.id
              const groupStart = i === 0 || visible[i - 1].configured !== p.configured
              return (
                <Fragment key={p.id}>
                  {groupStart && (
                    <div className={cn("text-xs font-semibold tracking-wide text-muted-foreground uppercase", i > 0 && "mt-3")}>
                      {p.configured ? "Produtos desta máquina" : "Outros produtos do cliente"}
                    </div>
                  )}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={current}
                    onClick={() => setSelected(p.id)}
                    className={cn(
                      "flex min-h-18 touch-manipulation items-center gap-4 rounded-xl border-2 px-4 py-3 text-left transition-colors select-none",
                      "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.99]",
                      active ? "border-primary bg-primary/10" : "border-input bg-card hover:bg-accent",
                      current && "cursor-default border-dashed opacity-70 hover:bg-card active:scale-100",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border-2",
                        active ? "border-primary" : "border-muted-foreground/40",
                      )}
                    >
                      {active && <span className="size-3 rounded-full bg-primary" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lg leading-tight font-semibold">{p.name}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        Código {p.code} ·{" "}
                        {p.configured ? `ciclo ideal ${cycle(p.idealCycleS)}` : `sem ciclo cadastrado, usa o da máquina (${cycle(defaultCycleS)})`}
                      </span>
                    </span>
                    {current && (
                      <span className="shrink-0 rounded-full bg-state-running/15 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-state-running">
                        Em produção
                      </span>
                    )}
                  </button>
                </Fragment>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t p-4 sm:flex-row sm:justify-end">
        <Button variant="ghost" className="h-12 text-base sm:px-6" onClick={onCancel}>
          Cancelar
        </Button>
        <Button className="h-14 text-lg sm:min-w-56" disabled={!choice} onClick={() => choice && onConfirm(choice)}>
          {choice ? `Trocar para ${choice.code}` : "Selecione um produto"}
        </Button>
      </div>
    </>
  )
}
