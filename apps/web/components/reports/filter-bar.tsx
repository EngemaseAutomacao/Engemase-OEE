"use client"

import { useId } from "react"
import { FilterXIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/**
 * Barra de filtros dos relatórios: uma única linha acima de tudo o que ela filtra.
 * No celular os campos ficam em duas colunas; no desktop largo a barra fica fixa no topo.
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
      className={cn("rounded-xl border bg-card p-3 shadow-sm xl:sticky xl:top-16 xl:z-[5]", className)}
    >
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
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

export function FilterField({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

export interface FilterOption {
  value: string
  label: string
  hint?: string
}

/** Select com a opção "todos" no topo. */
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
  return (
    <FilterField label={label} htmlFor={id} className={className}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} size="sm" className={cn("w-full sm:w-[176px]", triggerClassName)}>
          <SelectValue>{current}</SelectValue>
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
    </FilterField>
  )
}

/** Botões segmentados (ex.: 7 dias | 14 dias). */
export function SegmentedFilter<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  className?: string
}) {
  return (
    <FilterField label={label} className={className}>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value}
        onValueChange={(v) => {
          if (v) onChange(v as T)
        }}
        aria-label={label}
        className="w-full sm:w-auto"
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} className="flex-1 data-[state=on]:font-semibold sm:flex-none">
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </FilterField>
  )
}
