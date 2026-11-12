"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Building2Icon,
  ChevronDownIcon,
  ClockIcon,
  CornerDownRightIcon,
  FactoryIcon,
  LayersIcon,
  MapPinIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RouterIcon,
  WorkflowIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import type { GatewayStatus } from "@/lib/mock/types"
import { GATEWAY_STATUS_LABEL } from "@/lib/roles"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { StatCard } from "@/components/dashboard/stat-card"
import { PageTitle } from "@/components/refresh/page-title"
import { SOFT_TONES, SoftIconButton } from "@/components/refresh/soft-action"
import { EngemaseOnlyChip, useCanEdit } from "@/components/config/engemase-managed"
import { GATEWAY_STATUS_DOT, TIMEZONES, UFS, norm, plural, timezoneShort } from "@/components/config/labels"

export interface UnitNode {
  id: string
  name: string
  city: string
  state: string
  timezone: string
  gateways: { id: string; name: string; status: GatewayStatus }[]
}
export interface AreaNode {
  id: string
  unitId: string
  name: string
}
export interface LineNode {
  id: string
  unitId: string
  areaId: string
  name: string
  code: string
  machineCount: number
}

type DialogState =
  | { kind: "unit"; unit?: UnitNode }
  | { kind: "area"; unitId: string; area?: AreaNode }
  | { kind: "line"; unitId: string; areaId?: string; line?: LineNode }

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}`

/** Árvore Unidade → Área → Linha (com contagem de máquinas) e diálogos de cadastro. */
export function UnitsManager({
  clientSlug,
  title,
  description,
  summary,
  machineLimit,
  initialUnits,
  initialAreas,
  initialLines,
}: {
  clientSlug: string
  title: string
  description: string
  summary: React.ReactNode
  /** Limite de máquinas do plano (para o indicador). */
  machineLimit: number
  initialUnits: UnitNode[]
  initialAreas: AreaNode[]
  initialLines: LineNode[]
}) {
  const [units, setUnits] = useState(initialUnits)
  const [areas, setAreas] = useState(initialAreas)
  const [lines, setLines] = useState(initialLines)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [open, setOpen] = useState(false)
  const canEdit = useCanEdit()

  const openDialog = (d: DialogState) => {
    setDialog(d)
    setOpen(true)
  }
  const close = () => setOpen(false)

  const saveUnit = (values: Omit<UnitNode, "id" | "gateways">, id?: string) => {
    if (id) {
      setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, ...values } : u)))
      toast.success(`Unidade "${values.name}" atualizada`)
    } else {
      setUnits((prev) => [...prev, { id: newId("uni"), gateways: [], ...values }])
      toast.success(`Unidade "${values.name}" criada`, { description: "Cadastre as áreas e linhas e depois provisione um gateway para ela." })
    }
    close()
  }

  const saveArea = (values: { name: string; unitId: string }, id?: string) => {
    if (id) {
      setAreas((prev) => prev.map((a) => (a.id === id ? { ...a, ...values } : a)))
      toast.success(`Área "${values.name}" atualizada`)
    } else {
      setAreas((prev) => [...prev, { id: newId("are"), ...values }])
      toast.success(`Área "${values.name}" criada`)
    }
    close()
  }

  const saveLine = (values: { name: string; code: string; unitId: string; areaId: string }, id?: string) => {
    if (id) {
      setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...values } : l)))
      toast.success(`Linha "${values.name}" atualizada`)
    } else {
      setLines((prev) => [...prev, { id: newId("lin"), machineCount: 0, ...values }])
      toast.success(`Linha "${values.name}" criada`, { description: "Agora cadastre as máquinas desta linha." })
    }
    close()
  }

  const totalMachines = lines.reduce((s, l) => s + l.machineCount, 0)
  const gatewayCount = units.reduce((s, u) => s + u.gateways.length, 0)
  const emptyLines = lines.filter((l) => l.machineCount === 0).length

  return (
    <>
      <PageTitle
        title={title}
        description={description}
        actions={
          canEdit && (
            <>
              <EngemaseOnlyChip />
              <Button onClick={() => openDialog({ kind: "unit" })}>
                <PlusIcon />
                Nova unidade
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Building2Icon}
          tone="blue"
          label="Unidades"
          value={units.length}
          hint={gatewayCount > 0 ? plural(gatewayCount, "gateway instalado", "gateways instalados") : "Nenhum gateway instalado"}
        />
        <StatCard icon={LayersIcon} tone="teal" label="Áreas" value={areas.length} hint="Setores que agrupam as linhas" />
        <StatCard
          icon={WorkflowIcon}
          tone="navy"
          label="Linhas"
          value={lines.length}
          hint={emptyLines > 0 ? `${plural(emptyLines, "linha", "linhas")} sem máquina` : "Todas com máquinas"}
        />
        <StatCard
          icon={FactoryIcon}
          tone="orange"
          label="Máquinas"
          value={
            <>
              {totalMachines}
              <span className="text-base font-semibold text-muted-foreground"> / {machineLimit}</span>
            </>
          }
          hint="Em uso · máquinas contratadas"
        />
      </div>

      {summary}

      {units.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2Icon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma unidade cadastrada</EmptyTitle>
            <EmptyDescription>
              A unidade é a planta física (endereço e fuso horário). Dentro dela ficam as áreas, as linhas e as máquinas.
            </EmptyDescription>
          </EmptyHeader>
          {canEdit && (
            <EmptyContent>
              <Button onClick={() => openDialog({ kind: "unit" })}>
                <PlusIcon />
                Cadastrar unidade
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {units.map((unit) => (
            <UnitCard
              key={unit.id}
              unit={unit}
              areas={areas.filter((a) => a.unitId === unit.id)}
              lines={lines.filter((l) => l.unitId === unit.id)}
              clientSlug={clientSlug}
              onEditUnit={() => openDialog({ kind: "unit", unit })}
              onAddArea={() => openDialog({ kind: "area", unitId: unit.id })}
              onEditArea={(area) => openDialog({ kind: "area", unitId: unit.id, area })}
              onAddLine={(areaId) => openDialog({ kind: "line", unitId: unit.id, areaId })}
              onEditLine={(line) => openDialog({ kind: "line", unitId: unit.id, line })}
            />
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {dialog?.kind === "unit" && <UnitForm unit={dialog.unit} onCancel={close} onSave={saveUnit} />}
          {dialog?.kind === "area" && (
            <AreaForm
              area={dialog.area}
              unitId={dialog.unitId}
              units={units}
              siblings={areas.filter((a) => a.unitId === dialog.unitId)}
              onCancel={close}
              onSave={saveArea}
            />
          )}
          {dialog?.kind === "line" && (
            <LineForm
              line={dialog.line}
              unit={units.find((u) => u.id === dialog.unitId)!}
              defaultAreaId={dialog.areaId}
              areas={areas.filter((a) => a.unitId === dialog.unitId)}
              allLines={lines}
              onCancel={close}
              onSave={saveLine}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Cartão da unidade (árvore)
// ---------------------------------------------------------------------------

function UnitCard({
  unit,
  areas,
  lines,
  clientSlug,
  onEditUnit,
  onAddArea,
  onEditArea,
  onAddLine,
  onEditLine,
}: {
  unit: UnitNode
  areas: AreaNode[]
  lines: LineNode[]
  clientSlug: string
  onEditUnit: () => void
  onAddArea: () => void
  onEditArea: (a: AreaNode) => void
  onAddLine: (areaId?: string) => void
  onEditLine: (l: LineNode) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const machines = lines.reduce((s, l) => s + l.machineCount, 0)
  const canEdit = useCanEdit()

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <section className="flex flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="-ml-1 shrink-0" aria-label={expanded ? "Recolher unidade" : "Expandir unidade"}>
              <ChevronDownIcon className={cn("transition-transform", !expanded && "-rotate-90")} />
            </Button>
          </CollapsibleTrigger>
          <IconCircle icon={Building2Icon} tone="blue" className="hidden sm:inline-flex" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="truncate text-[15px] font-semibold">{unit.name}</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Unidade</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <MapPinIcon className="size-3.5" />
                {unit.city}/{unit.state}
              </span>
              <span className="inline-flex items-center gap-1">
                <ClockIcon className="size-3.5" />
                {timezoneShort(unit.timezone)}
              </span>
              <span className="inline-flex items-center gap-1">
                <FactoryIcon className="size-3.5" />
                {plural(machines, "máquina", "máquinas")}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {unit.gateways.length === 0 ? (
                <Link
                  href={`/${clientSlug}/config/gateways`}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  <RouterIcon className="size-3.5" />
                  Sem gateway · provisionar
                </Link>
              ) : (
                unit.gateways.map((g) => (
                  <Link
                    key={g.id}
                    href={`/${clientSlug}/config/gateways/${g.id}`}
                    title={GATEWAY_STATUS_LABEL[g.status]}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs transition-colors hover:bg-muted/70 hover:text-foreground"
                  >
                    <span className={cn("size-1.5 rounded-full", GATEWAY_STATUS_DOT[g.status])} />
                    {g.name}
                    <span className="sr-only"> ({GATEWAY_STATUS_LABEL[g.status]})</span>
                  </Link>
                ))
              )}
            </div>
          </div>
          {canEdit && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className={cn(
                "hidden h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 md:inline-flex",
                SOFT_TONES.blue,
              )}
              onClick={() => onAddLine()}
              disabled={areas.length === 0}
            >
              <PlusIcon className="size-4" />
              Nova linha
            </button>
            <SoftIconButton label={`Editar ${unit.name}`} tone="slate" onClick={onEditUnit}>
              <PencilIcon />
            </SoftIconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Ações da ${unit.name}`}
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    SOFT_TONES.slate,
                  )}
                >
                  <MoreHorizontalIcon className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={onEditUnit}>
                  <PencilIcon />
                  Editar unidade
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onAddArea}>
                  <LayersIcon />
                  Nova área
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAddLine()} disabled={areas.length === 0}>
                  <PlusIcon />
                  Nova linha
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          )}
        </div>

        <CollapsibleContent>
          <div className="flex flex-col gap-3 border-t bg-muted/40 p-3 sm:p-4">
            {areas.length === 0 ? (
              <Empty className="rounded-xl border border-dashed bg-card py-6 md:py-8">
                <EmptyHeader>
                  <EmptyTitle className="text-sm">Nenhuma área nesta unidade</EmptyTitle>
                  <EmptyDescription>Áreas agrupam as linhas por setor (ex.: Injeção, Sopro, Envase).</EmptyDescription>
                </EmptyHeader>
                {canEdit && (
                  <EmptyContent>
                    <Button size="sm" variant="outline" onClick={onAddArea}>
                      <PlusIcon />
                      Nova área
                    </Button>
                  </EmptyContent>
                )}
              </Empty>
            ) : (
              areas.map((area) => (
                <AreaBlock
                  key={area.id}
                  area={area}
                  lines={lines.filter((l) => l.areaId === area.id)}
                  onEdit={() => onEditArea(area)}
                  onAddLine={() => onAddLine(area.id)}
                  onEditLine={onEditLine}
                />
              ))
            )}
            {canEdit && areas.length > 0 && (
              <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={onAddArea}>
                <PlusIcon />
                Nova área em {unit.name}
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

function AreaBlock({
  area,
  lines,
  onEdit,
  onAddLine,
  onEditLine,
}: {
  area: AreaNode
  lines: LineNode[]
  onEdit: () => void
  onAddLine: () => void
  onEditLine: (l: LineNode) => void
}) {
  const machines = lines.reduce((s, l) => s + l.machineCount, 0)
  const canEdit = useCanEdit()
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <IconCircle icon={LayersIcon} tone="teal" soft size="sm" />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="truncate text-sm font-semibold">{area.name}</span>
          <span className="text-xs text-muted-foreground">
            Área · {plural(lines.length, "linha", "linhas")} · {plural(machines, "máquina", "máquinas")}
          </span>
        </div>
        {canEdit && (
          <>
            <SoftIconButton label={`Editar área ${area.name}`} tone="slate" onClick={onEdit}>
              <PencilIcon />
            </SoftIconButton>
            <SoftIconButton label={`Nova linha em ${area.name}`} onClick={onAddLine}>
              <PlusIcon />
            </SoftIconButton>
          </>
        )}
      </div>
      {lines.length === 0 ? (
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2.5 pl-12 text-xs text-muted-foreground">
          <span>Nenhuma linha nesta área.</span>
          {canEdit && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onAddLine}>
              Cadastrar linha
            </Button>
          )}
        </div>
      ) : (
        <ul>
          {lines.map((line) => (
            <li key={line.id} className="flex items-center gap-2 border-t px-3 py-2 sm:gap-3">
              <CornerDownRightIcon className="ml-2.5 size-4 shrink-0 text-muted-foreground/60" />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="truncate text-sm">{line.name}</span>
                <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">{line.code}</span>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 text-xs tabular-nums",
                  line.machineCount === 0 ? "text-muted-foreground" : "text-foreground",
                )}
              >
                <FactoryIcon className="size-3.5 text-muted-foreground" />
                {line.machineCount}
                <span className="hidden text-muted-foreground sm:inline">{line.machineCount === 1 ? "máquina" : "máquinas"}</span>
              </span>
              {canEdit && (
                <SoftIconButton label={`Editar ${line.name}`} tone="slate" onClick={() => onEditLine(line)}>
                  <PencilIcon />
                </SoftIconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Formulários (dentro do diálogo)
// ---------------------------------------------------------------------------

function UnitForm({
  unit,
  onCancel,
  onSave,
}: {
  unit?: UnitNode
  onCancel: () => void
  onSave: (values: Omit<UnitNode, "id" | "gateways">, id?: string) => void
}) {
  const [name, setName] = useState(unit?.name ?? "")
  const [city, setCity] = useState(unit?.city ?? "")
  const [uf, setUf] = useState(unit?.state ?? "SC")
  const [timezone, setTimezone] = useState(unit?.timezone ?? "America/Sao_Paulo")
  const [submitted, setSubmitted] = useState(false)

  const errors = {
    name: name.trim().length < 3 ? "Informe o nome da unidade (mín. 3 caracteres)." : null,
    city: city.trim().length < 2 ? "Informe a cidade." : null,
  }
  const valid = !errors.name && !errors.city

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setSubmitted(true)
        if (!valid) return
        onSave({ name: name.trim(), city: city.trim(), state: uf, timezone }, unit?.id)
      }}
      className="flex flex-col gap-5"
    >
      <DialogHeader>
        <DialogTitle>{unit ? "Editar unidade" : "Nova unidade"}</DialogTitle>
        <DialogDescription>A unidade define o fuso horário usado no cálculo dos turnos e nos relatórios.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Field data-invalid={submitted && !!errors.name}>
          <FieldLabel htmlFor="unit-name">Nome</FieldLabel>
          <Input id="unit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Unidade Joinville" autoFocus aria-invalid={submitted && !!errors.name} />
          {submitted && <FieldError>{errors.name}</FieldError>}
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field data-invalid={submitted && !!errors.city}>
            <FieldLabel htmlFor="unit-city">Cidade</FieldLabel>
            <Input id="unit-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex.: Joinville" aria-invalid={submitted && !!errors.city} />
            {submitted && <FieldError>{errors.city}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="unit-uf">UF</FieldLabel>
            <Select value={uf} onValueChange={setUf}>
              <SelectTrigger id="unit-uf" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {UFS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="unit-tz">Fuso horário</FieldLabel>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="unit-tz" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>Fuso IANA. O Brasil não tem horário de verão hoje, mas o cálculo não presume isso.</FieldDescription>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">{unit ? "Salvar alterações" : "Criar unidade"}</Button>
      </DialogFooter>
    </form>
  )
}

function AreaForm({
  area,
  unitId,
  units,
  siblings,
  onCancel,
  onSave,
}: {
  area?: AreaNode
  unitId: string
  units: UnitNode[]
  siblings: AreaNode[]
  onCancel: () => void
  onSave: (values: { name: string; unitId: string }, id?: string) => void
}) {
  const [name, setName] = useState(area?.name ?? "")
  const [submitted, setSubmitted] = useState(false)
  const unit = units.find((u) => u.id === unitId)
  const duplicate = siblings.some((a) => a.id !== area?.id && norm(a.name) === norm(name.trim()))
  const error = name.trim().length < 2 ? "Informe o nome da área." : duplicate ? "Já existe uma área com esse nome nesta unidade." : null

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setSubmitted(true)
        if (error) return
        onSave({ name: name.trim(), unitId }, area?.id)
      }}
      className="flex flex-col gap-5"
    >
      <DialogHeader>
        <DialogTitle>{area ? "Editar área" : "Nova área"}</DialogTitle>
        <DialogDescription>{unit?.name}: áreas agrupam linhas do mesmo setor para filtros e relatórios.</DialogDescription>
      </DialogHeader>
      <Field data-invalid={submitted && !!error}>
        <FieldLabel htmlFor="area-name">Nome da área</FieldLabel>
        <Input id="area-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Injeção, Sopro, Montagem" autoFocus aria-invalid={submitted && !!error} />
        {submitted && <FieldError>{error}</FieldError>}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">{area ? "Salvar alterações" : "Criar área"}</Button>
      </DialogFooter>
    </form>
  )
}

function LineForm({
  line,
  unit,
  defaultAreaId,
  areas,
  allLines,
  onCancel,
  onSave,
}: {
  line?: LineNode
  unit: UnitNode
  defaultAreaId?: string
  areas: AreaNode[]
  allLines: LineNode[]
  onCancel: () => void
  onSave: (values: { name: string; code: string; unitId: string; areaId: string }, id?: string) => void
}) {
  const [name, setName] = useState(line?.name ?? "")
  const [code, setCode] = useState(line?.code ?? "")
  const [areaId, setAreaId] = useState(line?.areaId ?? defaultAreaId ?? areas[0]?.id ?? "")
  const [submitted, setSubmitted] = useState(false)

  const codeClean = code.trim().toUpperCase()
  const codeTaken = allLines.some((l) => l.id !== line?.id && l.code.toUpperCase() === codeClean)
  const errors = {
    name: name.trim().length < 3 ? "Informe o nome da linha." : null,
    code: !/^[A-Z0-9][A-Z0-9-]{1,11}$/.test(codeClean)
      ? "Use de 2 a 12 caracteres: letras, números e hífen."
      : codeTaken
        ? "Este código já é usado por outra linha do cliente."
        : null,
    area: !areaId ? "Escolha a área." : null,
  }
  const valid = !errors.name && !errors.code && !errors.area

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setSubmitted(true)
        if (!valid) return
        onSave({ name: name.trim(), code: codeClean, unitId: unit.id, areaId }, line?.id)
      }}
      className="flex flex-col gap-5"
    >
      <DialogHeader>
        <DialogTitle>{line ? "Editar linha" : "Nova linha"}</DialogTitle>
        <DialogDescription>
          {unit.name}
          {line && line.machineCount > 0 ? ` · ${plural(line.machineCount, "máquina vinculada", "máquinas vinculadas")}` : ""}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Field data-invalid={submitted && !!errors.name}>
          <FieldLabel htmlFor="line-name">Nome</FieldLabel>
          <Input id="line-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Linha Injeção C" autoFocus aria-invalid={submitted && !!errors.name} />
          {submitted && <FieldError>{errors.name}</FieldError>}
        </Field>
        <Field data-invalid={submitted && !!errors.code}>
          <FieldLabel htmlFor="line-code">Código</FieldLabel>
          <Input
            id="line-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Ex.: INJ-C"
            className="font-mono uppercase"
            maxLength={12}
            aria-invalid={submitted && !!errors.code}
          />
          {submitted && errors.code ? (
            <FieldError>{errors.code}</FieldError>
          ) : (
            <FieldDescription>Aparece na TV/Andon e nas exportações. Único no cliente.</FieldDescription>
          )}
        </Field>
        <Field data-invalid={submitted && !!errors.area}>
          <FieldLabel htmlFor="line-area">Área</FieldLabel>
          <Select value={areaId} onValueChange={setAreaId}>
            <SelectTrigger id="line-area" className="w-full" aria-invalid={submitted && !!errors.area}>
              <SelectValue placeholder="Escolha a área" />
            </SelectTrigger>
            <SelectContent>
              {areas.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {submitted && <FieldError>{errors.area}</FieldError>}
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">{line ? "Salvar alterações" : "Criar linha"}</Button>
      </DialogFooter>
    </form>
  )
}
