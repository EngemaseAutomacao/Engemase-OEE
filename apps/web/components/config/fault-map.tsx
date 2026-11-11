"use client"

import { useState } from "react"
import { CircleHelpIcon, PlusIcon, SaveIcon, Trash2Icon, ZapIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SectionCard } from "@/components/dashboard/section-card"
import { REASON_CATEGORIES, REASON_CATEGORY_META, plural } from "@/components/config/labels"
import type { ReasonNode } from "@/components/config/reason-dialogs"
import { IconAction } from "@/components/config/ui-bits"

export interface FaultMapRow {
  code: number
  /** Texto do alarme como vem do CLP / IHM. */
  text: string
  /** Motivo de 2º nível; null = o operador escolhe. */
  reasonId: string | null
  /** "all" ou um tipo de máquina. */
  machineType: string
}

const ASK = "__ask"

/** Mapa "código de falha do CLP → motivo": a parada em falha já nasce classificada (o operador pode corrigir). */
export function FaultMap({
  rows,
  onChange,
  reasons,
  machineTypes,
}: {
  rows: FaultMapRow[]
  onChange: (rows: FaultMapRow[]) => void
  reasons: ReasonNode[]
  machineTypes: string[]
}) {
  const [code, setCode] = useState("")
  const [text, setText] = useState("")
  const [showNew, setShowNew] = useState(false)

  const groups = reasons.filter((r) => !r.parentId)
  const leaves = reasons.filter((r) => r.parentId)
  const byId = new Map(reasons.map((r) => [r.id, r]))
  const mapped = rows.filter((r) => r.reasonId && byId.get(r.reasonId)?.active).length

  const n = Number(code)
  const codeError =
    code.trim() === ""
      ? "Informe o código."
      : !Number.isInteger(n) || n < 1 || n > 65535
        ? "Código de 1 a 65535."
        : rows.some((r) => r.code === n)
          ? "Código já mapeado."
          : null
  const textError = text.trim().length < 3 ? "Descreva o alarme." : null

  const update = (c: number, patch: Partial<FaultMapRow>) => onChange(rows.map((r) => (r.code === c ? { ...r, ...patch } : r)))

  const add = () => {
    setShowNew(true)
    if (codeError || textError) return
    onChange([...rows, { code: n, text: text.trim(), reasonId: null, machineType: "all" }].sort((a, b) => a.code - b.code))
    setCode("")
    setText("")
    setShowNew(false)
    toast.success(`Código ${n} adicionado`, { description: "Escolha o motivo automático na tabela." })
  }

  return (
    <SectionCard
      title="Mapa de códigos de falha → motivo"
      description="Quando o CLP sinaliza falha com um código conhecido, a parada já nasce classificada. O operador ainda pode corrigir."
      action={
        <Button
          size="sm"
          onClick={() =>
            toast.success("Mapa de falhas salvo", {
              description: `${mapped} de ${rows.length} códigos com motivo automático. Vale para as próximas paradas em falha.`,
            })
          }
        >
          <SaveIcon />
          Salvar mapa
        </Button>
      }
    >
      {rows.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ZapIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum código de falha mapeado</EmptyTitle>
            <EmptyDescription>Cadastre os códigos de alarme do CLP para classificar as falhas automaticamente.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-20 text-xs">Código</TableHead>
              <TableHead className="text-xs">Alarme no CLP</TableHead>
              <TableHead className="w-64 text-xs">Motivo automático</TableHead>
              <TableHead className="w-48 text-xs">Máquinas</TableHead>
              <TableHead className="w-12 text-xs">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const reason = r.reasonId ? byId.get(r.reasonId) : undefined
              const group = reason?.parentId ? byId.get(reason.parentId) : undefined
              const inactive = reason && !reason.active
              return (
                <TableRow key={r.code}>
                  <TableCell>
                    <span className="inline-flex min-w-10 justify-center rounded-md bg-state-fault/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-state-fault">{r.code}</span>
                  </TableCell>
                  <TableCell className="text-sm">{r.text}</TableCell>
                  <TableCell>
                    <Select value={reason ? reason.id : ASK} onValueChange={(v) => update(r.code, { reasonId: v === ASK ? null : v })}>
                      <SelectTrigger size="sm" className={cn("w-full", !reason && "text-muted-foreground", inactive && "border-state-stopped")} aria-label={`Motivo do código ${r.code}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ASK}>
                          <CircleHelpIcon />
                          Perguntar ao operador
                        </SelectItem>
                        <SelectSeparator />
                        {REASON_CATEGORIES.flatMap((c) =>
                          groups
                            .filter((g) => g.category === c)
                            .map((g) => (
                              <SelectGroup key={g.id}>
                                <SelectLabel className="flex items-center gap-1.5">
                                  <span className="size-2 rounded-full" style={{ background: g.color }} />
                                  {g.name} · {REASON_CATEGORY_META[c].label.toLowerCase()}
                                </SelectLabel>
                                {leaves
                                  .filter((l) => l.parentId === g.id && (l.active || l.id === r.reasonId))
                                  .map((l) => (
                                    <SelectItem key={l.id} value={l.id}>
                                      {l.name}
                                      {!l.active && <span className="text-xs text-muted-foreground">(desativado)</span>}
                                    </SelectItem>
                                  ))}
                              </SelectGroup>
                            )),
                        )}
                      </SelectContent>
                    </Select>
                    {group && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="size-1.5 rounded-full" style={{ background: group.color }} />
                        {group.name}
                        {inactive && <span className="text-amber-700 dark:text-state-stopped">· motivo desativado</span>}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select value={r.machineType} onValueChange={(v) => update(r.code, { machineType: v })}>
                      <SelectTrigger size="sm" className="w-full" aria-label={`Máquinas do código ${r.code}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as máquinas</SelectItem>
                        {machineTypes.map((t) => (
                          <SelectItem key={t} value={t}>
                            Só {t.toLowerCase()}s
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <IconAction
                      icon={Trash2Icon}
                      label={`Remover código ${r.code}`}
                      tone="red"
                      onClick={() => {
                        onChange(rows.filter((x) => x.code !== r.code))
                        toast.success(`Código ${r.code} removido do mapa`, {
                          action: { label: "Desfazer", onClick: () => onChange(rows) },
                        })
                      }}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <div className="mt-4 flex flex-col gap-2 rounded-xl bg-muted/50 p-3">
        <div className="text-xs font-medium">Adicionar código de alarme</div>
        <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="Código"
            inputMode="numeric"
            className="h-8 bg-background font-mono"
            aria-label="Código do alarme"
            aria-invalid={showNew && !!codeError}
          />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            placeholder="Texto do alarme (ex.: Termopar da zona 3 aberto)"
            className="h-8 bg-background"
            aria-label="Texto do alarme"
            aria-invalid={showNew && !!textError}
          />
          <Button type="button" size="sm" variant="outline" onClick={add}>
            <PlusIcon />
            Adicionar
          </Button>
        </div>
        {showNew && (codeError || textError) && <p className="text-xs text-destructive">{codeError ?? textError}</p>}
        <p className="text-[11px] text-muted-foreground">
          {plural(rows.length - mapped, "código pergunta", "códigos perguntam")} ao operador. O código vem do registrador “Código de falha” mapeado em cada máquina.
        </p>
      </div>
    </SectionCard>
  )
}
