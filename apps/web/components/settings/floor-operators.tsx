"use client"

/**
 * Operadores do chão (D18): quem aparece na lista "Quem está operando?" dos tablets de cada unidade.
 * Não são contas de login (sem e-mail nem senha). Cadastro pela equipe Engemase (`config.write`); desativar
 * tira da lista do tablet e mantém o nome nos apontamentos antigos.
 */
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { PencilIcon, PlusIcon, UserRoundCheckIcon, UserRoundXIcon, UsersRoundIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SectionCard } from "@/components/dashboard/section-card"
import { ConfirmAction, InitialsAvatar, SoftBadge, SquareAction, plural } from "@/components/settings/bits"
import { useCanEdit } from "@/components/config/engemase-managed"
import { definirOperadorAtivoAction, salvarOperadorAction } from "@/app/(shell)/[cliente]/config/actions"
import type { SettingsUnit } from "@/components/settings/types"

export interface FloorOperatorRow {
  id: string
  unitId: string
  name: string
  employeeCode: string | null
  active: boolean
}

type Form = { id?: string; unitId: string; name: string; employeeCode: string }

export function FloorOperators({
  clientSlug,
  units,
  initialOperators,
  banco,
}: {
  clientSlug: string
  units: SettingsUnit[]
  initialOperators: FloorOperatorRow[]
  /** Sistema real: grava no banco. Sem banco: demonstração local. */
  banco: boolean
}) {
  const router = useRouter()
  const canEdit = useCanEdit()
  const [busy, startBusy] = useTransition()
  const [local, setLocal] = useState(initialOperators)
  const operators = banco ? initialOperators : local
  const [form, setForm] = useState<Form | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [disabling, setDisabling] = useState<FloorOperatorRow | null>(null)
  const multiUnit = units.length > 1
  const unitName = new Map(units.map((u) => [u.id, u.name]))
  const active = operators.filter((o) => o.active).length

  const open = (f: Form) => {
    setError(null)
    setForm(f)
  }

  const submit = () => {
    if (form === null) return
    const name = form.name.trim()
    if (name.length < 2) return setError("Informe o nome do operador.")
    const employeeCode = form.employeeCode.trim() || null
    if (!banco) {
      setLocal((list) =>
        form.id
          ? list.map((o) => (o.id === form.id ? { ...o, name, employeeCode } : o))
          : [...list, { id: `op_new_${list.length + 1}`, unitId: form.unitId, name, employeeCode, active: true }],
      )
      setForm(null)
      toast.success(form.id ? "Operador atualizado" : `${name} na lista do tablet`)
      return
    }
    startBusy(async () => {
      try {
        const r = await salvarOperadorAction({ slug: clientSlug, id: form.id, unitId: form.unitId, name, employeeCode })
        if (!r.ok) return setError(r.mensagem)
        setForm(null)
        toast.success(form.id ? "Operador atualizado" : `${name} na lista do tablet`, { description: "Registrado na auditoria." })
        router.refresh()
      } catch {
        setError("Não foi possível gravar agora. Tente de novo.")
      }
    })
  }

  const setActive = (o: FloorOperatorRow, value: boolean) => {
    if (!banco) {
      setLocal((list) => list.map((x) => (x.id === o.id ? { ...x, active: value } : x)))
      return
    }
    startBusy(async () => {
      try {
        const r = await definirOperadorAtivoAction({ slug: clientSlug, id: o.id, active: value })
        if (!r.ok) return void toast.error(r.mensagem)
        toast.success(value ? `${o.name} voltou para a lista` : `${o.name} saiu da lista do tablet`)
        router.refresh()
      } catch {
        toast.error("Não foi possível gravar agora. Tente de novo.")
      }
    })
  }

  const sorted = [...operators].sort((a, b) => Number(b.active) - Number(a.active) || a.unitId.localeCompare(b.unitId) || a.name.localeCompare(b.name, "pt-BR"))

  return (
    <SectionCard
      title="Operadores do chão"
      description={`${plural(active, "operador ativo", "operadores ativos")} · aparecem na lista "Quem está operando?" do tablet`}
      bodyClassName="px-0 pb-2"
      action={
        canEdit && units.length > 0 ? (
          <Button size="sm" onClick={() => open({ unitId: units[0]!.id, name: "", employeeCode: "" })}>
            <PlusIcon />
            Novo operador
          </Button>
        ) : undefined
      }
    >
      {sorted.length === 0 ? (
        <Empty className="py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersRoundIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum operador cadastrado</EmptyTitle>
            <EmptyDescription>
              Sem operadores, o tablet aponta sem pedir o nome. Cadastre quem opera as máquinas para saber quem fez cada apontamento.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y">
          {sorted.map((o) => (
            <li key={o.id} className={cn("flex items-center gap-3 px-5 py-2.5", !o.active && "opacity-60")}>
              <InitialsAvatar name={o.name} tone={o.active ? "blue" : "slate"} />
              <div className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-sm font-medium">{o.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[o.employeeCode ? `Matrícula ${o.employeeCode}` : null, multiUnit ? unitName.get(o.unitId) : null].filter(Boolean).join(" · ") || "Sem matrícula"}
                </span>
              </div>
              {!o.active && <SoftBadge tone="slate">Desativado</SoftBadge>}
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <SquareAction icon={PencilIcon} label={`Editar ${o.name}`} onClick={() => open({ id: o.id, unitId: o.unitId, name: o.name, employeeCode: o.employeeCode ?? "" })} />
                  {o.active ? (
                    <SquareAction icon={UserRoundXIcon} label={`Desativar ${o.name}`} onClick={() => setDisabling(o)} />
                  ) : (
                    <SquareAction icon={UserRoundCheckIcon} label={`Reativar ${o.name}`} onClick={() => setActive(o, true)} />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={form !== null} onOpenChange={(v) => !v && !busy && setForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar operador" : "Novo operador"}</DialogTitle>
            <DialogDescription>Aparece na lista do tablet da unidade. Não cria login: o operador só toca no próprio nome.</DialogDescription>
          </DialogHeader>
          {form && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              {multiUnit && (
                <div className="grid gap-2">
                  <Label htmlFor="op-unit">Unidade</Label>
                  <Select value={form.unitId} onValueChange={(v) => setForm({ ...form, unitId: v })} disabled={form.id !== undefined}>
                    <SelectTrigger id="op-unit" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {units.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="op-name">Nome</Label>
                <Input
                  id="op-name"
                  value={form.name}
                  maxLength={80}
                  autoComplete="off"
                  autoFocus
                  placeholder="Como aparece no tablet"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="op-code">Matrícula (opcional)</Label>
                <Input id="op-code" value={form.employeeCode} maxLength={30} autoComplete="off" onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)} disabled={busy}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Salvando…" : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmAction
        open={disabling !== null}
        onOpenChange={(v) => !v && setDisabling(null)}
        title={`Desativar ${disabling?.name ?? ""}?`}
        description="Sai da lista do tablet na próxima atualização da tela. Os apontamentos já feitos continuam com o nome. Dá para reativar depois."
        confirmLabel="Desativar"
        onConfirm={() => {
          if (disabling) setActive(disabling, false)
          setDisabling(null)
        }}
      />
    </SectionCard>
  )
}
