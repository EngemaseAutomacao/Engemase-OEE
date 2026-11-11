"use client"

import { useState } from "react"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ReasonCategory } from "@/lib/mock/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { REASON_CATEGORIES, REASON_CATEGORY_META, REASON_PALETTE, norm } from "@/components/config/labels"

export interface ReasonNode {
  id: string
  parentId: string | null
  name: string
  category: ReasonCategory
  /** Só grupos (nível 1) têm cor; os motivos herdam. */
  color: string
  active: boolean
  /** Uso nos últimos 7 dias (Pareto). */
  minutes: number
  occurrences: number
}

export type ReasonEdit =
  | { mode: "group"; node: ReasonNode | null }
  | { mode: "child"; parent: ReasonNode; node: ReasonNode | null }

/** Paleta de cores do grupo (bolinhas). */
export function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cor do grupo">
      {REASON_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn("flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition", value === c && "ring-2 ring-foreground/40")}
          style={{ background: c }}
        >
          {value === c && <CheckIcon className="size-3.5 text-white" />}
        </button>
      ))}
    </div>
  )
}

/** Bolinha de cor que abre a paleta (troca rápida na árvore). */
export function ColorPopover({ color, label, onChange }: { color: string; label: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Cor de ${label}`}
          className="size-4 shrink-0 rounded-full ring-2 ring-background outline-none focus-visible:ring-ring"
          style={{ background: color, boxShadow: `0 0 0 1px ${color}` }}
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="mb-2 text-xs font-medium">Cor no Pareto e na tela do operador</div>
        <ColorSwatches
          value={color}
          onChange={(c) => {
            onChange(c)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export function ReasonDialog({
  edit,
  onOpenChange,
  siblings,
  onSave,
}: {
  edit: ReasonEdit | null
  onOpenChange: (open: boolean) => void
  /** Nomes já usados no mesmo nível (para evitar duplicados). */
  siblings: string[]
  onSave: (data: { name: string; category: ReasonCategory; color: string }) => void
}) {
  return (
    <Dialog open={edit !== null} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        {edit && (
          <ReasonForm
            key={`${edit.mode}-${edit.node?.id ?? "new"}-${edit.mode === "child" ? edit.parent.id : ""}`}
            edit={edit}
            siblings={siblings}
            onSave={onSave}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReasonForm({
  edit,
  siblings,
  onSave,
  onCancel,
}: {
  edit: ReasonEdit
  siblings: string[]
  onSave: (data: { name: string; category: ReasonCategory; color: string }) => void
  onCancel: () => void
}) {
  const isGroup = edit.mode === "group"
  const parent = edit.mode === "child" ? edit.parent : null
  const [name, setName] = useState(edit.node?.name ?? "")
  const [category, setCategory] = useState<ReasonCategory>(edit.node?.category ?? parent?.category ?? "unplanned")
  const [color, setColor] = useState(edit.node?.color ?? parent?.color ?? REASON_PALETTE[0])
  const [show, setShow] = useState(false)

  const dup = siblings.some((s) => norm(s) === norm(name.trim()) && norm(s) !== norm(edit.node?.name ?? "\u0000"))
  const error = name.trim().length < 3 ? "Use ao menos 3 caracteres." : name.trim().length > 40 ? "Use até 40 caracteres (cabe no botão do operador)." : dup ? "Já existe um motivo com este nome aqui." : null

  const title = isGroup ? (edit.node ? `Editar grupo ${edit.node.name}` : "Novo grupo de motivos") : edit.node ? `Editar ${edit.node.name}` : `Novo motivo em ${parent?.name}`

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setShow(true)
        if (!error) onSave({ name: name.trim(), category, color })
      }}
    >
      <DialogHeader className="border-b px-6 pt-6 pb-4">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {isGroup
            ? "Grupos são o 1º nível na tela do operador. A categoria vale para todos os motivos do grupo."
            : `2º nível (último): é o que o operador toca para classificar. Categoria: ${REASON_CATEGORY_META[category].label.toLowerCase()}.`}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-5 px-6 py-5">
        <Field data-invalid={show && !!error}>
          <FieldLabel htmlFor="rs-name">Nome</FieldLabel>
          <Input id="rs-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={isGroup ? "Ex.: Qualidade" : "Ex.: Ajuste de dosagem"} autoFocus maxLength={48} />
          {show && error ? <FieldError>{error}</FieldError> : <FieldDescription className="text-xs">Curto e claro: aparece em botão grande no tablet do operador.</FieldDescription>}
        </Field>

        {isGroup && (
          <>
            <Field>
              <FieldLabel>Categoria</FieldLabel>
              <RadioGroup value={category} onValueChange={(v) => setCategory(v as ReasonCategory)} className="gap-2">
                {REASON_CATEGORIES.map((c) => (
                  <FieldLabel key={c} htmlFor={`rs-cat-${c}`}>
                    <Field orientation="horizontal">
                      <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", REASON_CATEGORY_META[c].dot)} />
                      <FieldContent>
                        <FieldTitle>{REASON_CATEGORY_META[c].label}</FieldTitle>
                        <FieldDescription className="text-xs">{REASON_CATEGORY_META[c].effect}</FieldDescription>
                      </FieldContent>
                      <RadioGroupItem value={c} id={`rs-cat-${c}`} />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </Field>
            <Field>
              <FieldLabel>Cor</FieldLabel>
              <ColorSwatches value={color} onChange={setColor} />
            </Field>
          </>
        )}
      </div>
      <DialogFooter className="border-t px-6 py-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">{edit.node ? "Salvar" : isGroup ? "Criar grupo" : "Adicionar motivo"}</Button>
      </DialogFooter>
    </form>
  )
}
