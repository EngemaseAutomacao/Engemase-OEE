"use client"

import { useState } from "react"
import {
  BlocksIcon,
  CheckIcon,
  CopyIcon,
  LayoutTemplateIcon,
  PlusIcon,
  ScanLineIcon,
  TagsIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { ByteOrder, DataType, ModbusArea, StateMode, TagRole } from "@/lib/mock/types"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  BYTE_ORDERS,
  DATA_TYPES,
  MODBUS_AREAS,
  MODBUS_AREA_FC,
  MODBUS_AREA_LABEL,
  POLL_INTERVALS,
  REQUIRED_ROLES,
  ROLE_DEFAULTS,
  STATE_MODE_LABEL,
  TAG_ROLE_LABEL,
  WIZARD_TAG_ROLES,
  is32,
  isBitArea,
  modbusRef,
  pollLabel,
} from "@/components/config/labels"
import { IconCircle } from "@/components/dashboard/icon-circle"
import {
  BLOCK_REGISTERS,
  DEFAULT_BLOCK_BASE,
  ENGEMASE_BLOCK_LAYOUT,
  MAX_BLOCK_BASE,
  engemaseBlock,
  refRange,
  type MachineTemplate,
  type TagDraft,
} from "@/components/config/wizard-model"

const COVERAGE_ROLES: TagRole[] = ["state.running", "state.fault", "state.code", "fault.code", "count.total", "count.reject", "product.code"]

/** Etapa 3: sinais por papel (tabela editável), templates e leitura de teste. */
export function TagsStep({
  tags,
  stateMode,
  builtinTemplates,
  machineTemplates,
  machineType,
  rowErrors,
  globalError,
  show,
  canRead,
  readingKeys,
  onChangeTag,
  onAdd,
  onRemove,
  onApplyTemplate,
  onRead,
  onReadAll,
}: {
  tags: TagDraft[]
  stateMode: StateMode
  builtinTemplates: MachineTemplate[]
  machineTemplates: MachineTemplate[]
  machineType: string
  rowErrors: Record<string, string>
  globalError: string | null
  show: boolean
  canRead: boolean
  readingKeys: string[]
  onChangeTag: (key: string, patch: Partial<TagDraft>) => void
  onAdd: () => void
  onRemove: (key: string) => void
  onApplyTemplate: (tpl: MachineTemplate) => void
  onRead: (key: string) => void
  onReadAll: () => void
}) {
  const sameType = machineTemplates.filter((t) => t.machineType === machineType)
  const otherType = machineTemplates.filter((t) => t.machineType !== machineType)
  const required = REQUIRED_ROLES[stateMode]

  const changeRole = (t: TagDraft, role: TagRole) => {
    const d = ROLE_DEFAULTS[role]
    const prevDefault = ROLE_DEFAULTS[t.role].name
    onChangeTag(t.key, {
      role,
      area: d.area,
      dataType: d.dataType,
      pollMs: d.pollMs,
      byteOrder: is32(d.dataType) ? "CDAB" : t.byteOrder,
      name: !t.name.trim() || t.name === prevDefault ? d.name : t.name,
      lastValue: null,
      lastLatencyMs: null,
    })
  }
  const changeArea = (t: TagDraft, area: ModbusArea) => {
    const dataType: DataType = isBitArea(area) ? "bool" : t.dataType === "bool" ? "uint16" : t.dataType
    onChangeTag(t.key, { area, dataType, lastValue: null, lastLatencyMs: null })
  }

  const templateMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline">
          <LayoutTemplateIcon />
          Aplicar template
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Outros templates Engemase</DropdownMenuLabel>
        <DropdownMenuGroup>
          {builtinTemplates.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => onApplyTemplate(t)} className="flex-col items-start gap-0.5">
              <span className="font-medium">{t.label}</span>
              <span className="text-xs text-muted-foreground">{t.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {machineTemplates.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Copiar de máquina igual{machineType ? ` (${machineType})` : ""}
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {[...sameType, ...otherType].map((t) => (
                <DropdownMenuItem key={t.id} onSelect={() => onApplyTemplate(t)}>
                  <CopyIcon />
                  <span className="flex-1 truncate">{t.label}</span>
                  <span className="text-xs text-muted-foreground">{t.tags.length} sinais</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex flex-col gap-4">
      <EngemaseBlockCard tags={tags} onApply={(base) => onApplyTemplate(engemaseBlock(base))} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {templateMenu}
          <Button type="button" variant="outline" onClick={onAdd}>
            <PlusIcon />
            Adicionar sinal
          </Button>
        </div>
        <Button type="button" variant="secondary" onClick={onReadAll} disabled={!canRead || tags.length === 0 || readingKeys.length > 0}>
          {readingKeys.length > 0 ? <Spinner /> : <ScanLineIcon />}
          Ler todos agora
        </Button>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2.5">
        <div className="text-xs text-muted-foreground">
          Modo de estado (etapa 4): <span className="font-medium text-foreground">{STATE_MODE_LABEL[stateMode]}</span> · obrigatórios:{" "}
          {required.map((r) => TAG_ROLE_LABEL[r]).join(" e ")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COVERAGE_ROLES.map((r) => {
            const mapped = tags.some((t) => t.role === r)
            const req = required.includes(r)
            return (
              <span
                key={r}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                  mapped
                    ? "border-state-running/40 bg-state-running/10 text-state-running"
                    : req
                      ? "border-state-fault/40 text-state-fault"
                      : "text-muted-foreground",
                )}
              >
                {mapped ? <CheckIcon className="size-3" /> : <span className="size-1.5 rounded-full bg-current opacity-60" />}
                {TAG_ROLE_LABEL[r]}
                {req && !mapped && " *"}
              </span>
            )
          })}
        </div>
      </div>

      {show && globalError && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertDescription>{globalError}</AlertDescription>
        </Alert>
      )}

      {tags.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TagsIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum sinal mapeado</EmptyTitle>
            <EmptyDescription>
              Aplique o bloco OEE padrão acima (resolve tudo em uma leitura), use outro template ou copie os sinais de uma máquina igual já cadastrada.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center">
            {templateMenu}
            <Button type="button" onClick={onAdd}>
              <PlusIcon />
              Adicionar sinal
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table className="min-w-[1240px]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-40 pl-3">Papel</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead className="w-44">Área Modbus</TableHead>
                <TableHead className="w-44">Endereço (base 0)</TableHead>
                <TableHead className="w-28">Tipo</TableHead>
                <TableHead className="w-28">Ordem das words</TableHead>
                <TableHead className="w-24">Intervalo</TableHead>
                <TableHead className="w-36">Ler agora</TableHead>
                <TableHead className="w-12 pr-3">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tags.map((t) => {
                const error = show ? rowErrors[t.key] : undefined
                const reading = readingKeys.includes(t.key)
                const bit = isBitArea(t.area)
                return (
                  <TagRows
                    key={t.key}
                    t={t}
                    error={error}
                    reading={reading}
                    bit={bit}
                    canRead={canRead}
                    onRole={(r) => changeRole(t, r)}
                    onArea={(a) => changeArea(t, a)}
                    onChange={(patch) => onChangeTag(t.key, patch)}
                    onRead={() => onRead(t.key)}
                    onRemove={() => onRemove(t.key)}
                  />
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Endereços em <strong>base 0</strong>, como no protocolo. A convenção clássica (0xxxx coil, 1xxxx discrete input, 3xxxx input register, 4xxxx holding register)
        aparece ao lado para conferir com o manual do CLP: o holding register 40001 é o endereço 0. Valores de 32 bits ocupam 2 registradores; teste a ordem das words com um
        valor conhecido (ex.: contador = 100.000).
      </p>
    </div>
  )
}

/** Cartão do bloco OEE padrão Engemase: escolhe o endereço base e preenche os 14 registradores. */
function EngemaseBlockCard({ tags, onApply }: { tags: TagDraft[]; onApply: (base: number) => void }) {
  const [base, setBase] = useState(String(DEFAULT_BLOCK_BASE))
  const n = base.trim() === "" ? NaN : Number(base)
  const valid = Number.isInteger(n) && n >= 0 && n <= MAX_BLOCK_BASE
  const first = valid ? modbusRef("holding_register", n) : "—"
  const last = valid ? modbusRef("holding_register", n + BLOCK_REGISTERS - 1) : "—"

  // Bloco já aplicado? (mesmos papéis e endereços a partir de algum base)
  const appliedBase = (() => {
    if (tags.length !== ENGEMASE_BLOCK_LAYOUT.length) return null
    const b = Number(tags[0]?.address) - ENGEMASE_BLOCK_LAYOUT[0].offset
    const tpl = engemaseBlock(b).tags
    const same = tpl.every((t, i) => tags[i] && tags[i].role === t.role && Number(tags[i].address) === t.address && tags[i].area === t.area)
    return same ? b : null
  })()

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-primary/25 bg-primary/[0.04] p-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <IconCircle icon={BlocksIcon} tone="blue" soft />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Aplicar bloco OEE padrão Engemase</span>
            {appliedBase !== null && (
              <Badge variant="secondary" className="bg-state-running/12 text-state-running">
                <CheckIcon />
                Aplicado em HR {appliedBase}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Preenche {BLOCK_REGISTERS} holding registers contíguos numa única leitura FC03 a cada 0,5 s. Use quando o programa do CLP segue o padrão Engemase
            (estado, falha, contadores de 32 bits em CDAB, produto e status).
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {ENGEMASE_BLOCK_LAYOUT.map((f) => (
              <span key={f.field} className="rounded-md bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border">
                +{f.offset}
                {is32(f.dataType) ? `–${f.offset + 1}` : ""} {f.field}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-end gap-2 lg:flex-col lg:items-stretch">
        <div className="flex flex-col gap-1">
          <label htmlFor="wz-block-base" className="text-xs font-medium">
            Endereço base (HR, base 0)
          </label>
          <InputGroup className="w-48">
            <InputGroupInput
              id="wz-block-base"
              value={base}
              onChange={(e) => setBase(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              className="font-mono"
              aria-invalid={!valid}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText className="font-mono text-[11px]">{valid ? `${first}–${last}` : "inválido"}</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <Button type="button" onClick={() => valid && onApply(n)} disabled={!valid}>
          <BlocksIcon />
          {appliedBase !== null ? "Reaplicar bloco" : "Aplicar bloco"}
        </Button>
      </div>
    </div>
  )
}

function TagRows({
  t,
  error,
  reading,
  bit,
  canRead,
  onRole,
  onArea,
  onChange,
  onRead,
  onRemove,
}: {
  t: TagDraft
  error: string | undefined
  reading: boolean
  bit: boolean
  canRead: boolean
  onRole: (r: TagRole) => void
  onArea: (a: ModbusArea) => void
  onChange: (patch: Partial<TagDraft>) => void
  onRead: () => void
  onRemove: () => void
}) {
  return (
    <>
      <TableRow className={cn("align-top hover:bg-transparent", error && "border-b-0")}>
        <TableCell className="pl-3">
          <Select value={t.role} onValueChange={(v) => onRole(v as TagRole)}>
            <SelectTrigger size="sm" className="w-full" aria-label="Papel do sinal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WIZARD_TAG_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {TAG_ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell>
          <Input
            value={t.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Descrição do sinal"
            className="h-8 min-w-52"
            aria-label="Nome do sinal"
            aria-invalid={!!error && !t.name.trim()}
          />
        </TableCell>
        <TableCell>
          <Select value={t.area} onValueChange={(v) => onArea(v as ModbusArea)}>
            <SelectTrigger size="sm" className="w-full" aria-label="Área Modbus">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODBUS_AREAS.map((a) => (
                <SelectItem key={a} value={a}>
                  {MODBUS_AREA_LABEL[a]}
                  <span className="font-mono text-xs text-muted-foreground">{MODBUS_AREA_FC[a]}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Input
              value={t.address}
              onChange={(e) => onChange({ address: e.target.value.replace(/\D/g, ""), lastValue: null, lastLatencyMs: null })}
              inputMode="numeric"
              className="h-8 w-20 font-mono"
              aria-label="Endereço base 0"
              aria-invalid={!!error}
            />
            <span className="font-mono text-xs whitespace-nowrap text-muted-foreground" title="Convenção 0xxxx/1xxxx/3xxxx/4xxxx">
              {refRange(t)}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <Select value={t.dataType} onValueChange={(v) => onChange({ dataType: v as DataType, lastValue: null })} disabled={bit}>
            <SelectTrigger size="sm" className="w-full font-mono" aria-label="Tipo de dado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATA_TYPES.filter((d) => (bit ? d === "bool" : d !== "bool")).map((d) => (
                <SelectItem key={d} value={d} className="font-mono">
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell>
          {is32(t.dataType) ? (
            <Select value={t.byteOrder} onValueChange={(v) => onChange({ byteOrder: v as ByteOrder, lastValue: null })}>
              <SelectTrigger size="sm" className="w-full font-mono" aria-label="Ordem das words">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BYTE_ORDERS.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="font-mono">{b.id}</span>
                    <span className="text-xs text-muted-foreground">{b.hint}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="inline-flex h-8 items-center text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell>
          <Select value={String(t.pollMs)} onValueChange={(v) => onChange({ pollMs: Number(v) })}>
            <SelectTrigger size="sm" className="w-full" aria-label="Intervalo de leitura">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POLL_INTERVALS.map((p) => (
                <SelectItem key={p} value={String(p)}>
                  {pollLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" className="h-8 px-2" onClick={onRead} disabled={!canRead || reading} title="Ler agora">
              {reading ? <Spinner /> : <ScanLineIcon />}
              <span className="sr-only sm:not-sr-only">Ler</span>
            </Button>
            {t.lastValue !== null && (
              <div className="min-w-0 leading-tight">
                <div className="truncate font-mono text-xs font-medium">{t.lastValue}</div>
                <div className="text-[10px] text-muted-foreground">{t.lastLatencyMs} ms</div>
              </div>
            )}
          </div>
        </TableCell>
        <TableCell className="pr-3">
          <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remover ${t.name || "sinal"}`}>
            <Trash2Icon />
          </Button>
        </TableCell>
      </TableRow>
      {error && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={9} className="pt-0 pb-2 pl-3 text-xs text-destructive">
            {error}
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
