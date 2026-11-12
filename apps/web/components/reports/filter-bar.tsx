"use client"

import { useId } from "react"
import { FilterXIcon, SlidersHorizontalIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/**
 * Barra compacta de filtros dos relatórios (padrão novo): uma linha de "pílulas" com o rótulo
 * dentro do próprio campo, resumo e "Limpar" à direita. No celular os campos ficam em duas colunas;
 * no desktop largo a barra fica fixa no topo.
 */
export function FilterBar({
  children,
  summary,
  canReset,
  onReset,
  className,
}: {
  children: React.ReactNode
  summary?: React.ReactNode
  canReset?: boolean
  onReset?: () => void
  className?: string
}) {
  return (
    <section
      aria-label="Filtros do relatório"
      className={cn(
        "rounded-2xl border bg-card p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] xl:sticky xl:top-16 xl:z-[5]",
        className,
      )}
    >
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <span className="col-span-2 hidden items-center gap-1.5 pr-1 text-xs font-semibold text-muted-foreground lg:inline-flex">
          <SlidersHorizontalIcon className="size-4" />
          Filtros
        </span>
        {children}
        <div className="col-span-2 flex min-h-8 items-center justify-between gap-3 sm:ml-auto sm:justify-end">
          {summary && <div className="text-xs text-muted-foreground tabular-nums">{summary}</div>}
          {onReset && (
            <Button variant="ghost" size="sm" onClick={onReset} disabled={!canReset} className="shrink-0">
              <FilterXIcon />
              Limpar
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

export interface FilterOption {
  value: string
  label: string
  hint?: string
}

/** Select em forma de pílula, com o rótulo dentro ("Linha: Todas") e a opção "todos" no topo. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  allShort,
  disabled,
  className,
  triggerClassName,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: FilterOption[]
  /** Rótulo da opção "todos" na lista (ex.: "Todas as unidades"). */
  allLabel?: string
  /** Versão curta para o botão (ex.: "Todas"); o rótulo do campo já diz o quê. */
  allShort?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
}) {
  const id = useId()
  // rótulo explícito: aparece já na renderização do servidor (sem "piscar" vazio)
  const current = value === "all" ? (allShort ?? allLabel) : options.find((o) => o.value === value)?.label
  const active = value !== "all"
  return (
    <div className={cn("min-w-0", className)}>
      <span id={id} className="sr-only">
        {label}
      </span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          size="sm"
          aria-labelledby={id}
          className={cn(
            "w-full rounded-lg bg-muted/50 sm:w-auto sm:max-w-[240px] sm:min-w-[150px]",
            active && "border-primary/40 bg-primary/5",
            triggerClassName,
          )}
        >
          <SelectValue>
            <span className="flex min-w-0 items-center gap-1">
              <span className="shrink-0 text-muted-foreground">{label}:</span>
              <span className={cn("truncate", active && "font-semibold text-primary")}>{current}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allLabel && <SelectItem value="all">{allLabel}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
              {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Botões segmentados (ex.: 7 dias | 14 dias), com rótulo opcional à esquerda. */
export function SegmentedFilter<T extends string>({
  label,
  value,
  onChange,
  options,
  showLabel = false,
  className,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  /** Mostra o rótulo antes dos botões (quando as opções sozinhas não bastam, ex.: "Agrupar por"). */
  showLabel?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {showLabel && <span className="shrink-0 text-xs text-muted-foreground">{label}:</span>}
      <ToggleGroup
        type="single"
        size="sm"
        spacing={0.5}
        value={value}
        onValueChange={(v) => {
          if (v) onChange(v as T)
        }}
        aria-label={label}
        className="w-full rounded-lg bg-muted/60 p-0.5 sm:w-auto"
      >
        {options.map((o) => (
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            className="h-7 flex-1 rounded-md px-3 text-xs data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-primary data-[state=on]:shadow-xs sm:flex-none"
          >
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
