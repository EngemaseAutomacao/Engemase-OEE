"use client"

import { useState } from "react"
import { InfoIcon } from "lucide-react"
import { toast } from "sonner"

import type { ClientPlan } from "@/lib/mock/types"
import { PLAN_LABEL } from "@/lib/roles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useClientDetail, type EditableClient } from "./client-detail-context"
import { BILLING_NOTE, ENGEMASE_CONFIG_NOTE, PLATFORM_HOST, isEmail, type PlanLimits } from "./labels"

/** Edição dos dados do cliente que só a plataforma grava (nome, contato, plano e máquinas contratadas, limites). */
export function ClientEditSheet({
  open,
  formKey,
  onOpenChange,
  slug,
  cnpj,
}: {
  open: boolean
  /** Muda a cada abertura para recarregar o formulário com os dados atuais. */
  formKey: number
  onOpenChange: (o: boolean) => void
  slug: string
  cnpj: string
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Editar cliente</SheetTitle>
          <SheetDescription>Plano, limites e estado são gravados só pela plataforma; o admin do cliente não altera.</SheetDescription>
        </SheetHeader>
        <EditForm key={formKey} slug={slug} cnpj={cnpj} onDone={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  )
}

function EditForm({ slug, cnpj, onDone }: { slug: string; cnpj: string; onDone: () => void }) {
  const { info, setInfo, addEvent } = useClientDetail()
  const [form, setForm] = useState<EditableClient>(info)
  const [error, setError] = useState<string | null>(null)
  const set = (p: Partial<EditableClient>) => setForm((f) => ({ ...f, ...p }))
  const setLimit = (k: keyof PlanLimits, v: string) => set({ limits: { ...form.limits, [k]: v === "" ? 0 : Math.max(0, Math.floor(Number(v))) } })

  const save = () => {
    if (form.name.trim().length < 2 || form.legalName.trim().length < 3) return setError("Informe o nome fantasia e a razão social.")
    if (!isEmail(form.contactEmail)) return setError("E-mail do contato inválido.")
    if (form.limits.machines < 1 || form.limits.gateways < 1 || form.limits.users < 1 || form.limits.retentionMonths < 6) return setError("Revise os limites do plano.")
    const changes: string[] = []
    if (form.plan !== info.plan) changes.push(`plano ${PLAN_LABEL[info.plan]} → ${PLAN_LABEL[form.plan]}`)
    if (form.limits.machines !== info.limits.machines) changes.push(`máquinas contratadas ${info.limits.machines} → ${form.limits.machines}`)
    else if (JSON.stringify(form.limits) !== JSON.stringify(info.limits)) changes.push("limites")
    if (form.name !== info.name || form.legalName !== info.legalName) changes.push("dados cadastrais")
    if (form.contactName !== info.contactName || form.contactEmail !== info.contactEmail) changes.push("contato")
    setInfo({ ...form, name: form.name.trim(), legalName: form.legalName.trim() })
    if (changes.length) addEvent({ title: "Cadastro alterado", subtitle: `Ana Ribeiro · ${changes.join(", ")}`, at: "agora" })
    toast.success("Alterações salvas", { description: changes.length ? `Alterado: ${changes.join(", ")}.` : "Nada mudou." })
    onDone()
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ed-name">Nome fantasia</Label>
            <Input id="ed-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-legal">Razão social</Label>
            <Input id="ed-legal" value={form.legalName} onChange={(e) => set({ legalName: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">CNPJ</div>
              <div className="font-mono font-medium">{cnpj}</div>
            </div>
            <div className="min-w-0">
              <div className="text-muted-foreground">Identificador (fixo)</div>
              <div className="truncate font-mono font-medium">
                {PLATFORM_HOST}/{slug}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Contato principal</h3>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-cname">Nome</Label>
            <Input id="ed-cname" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-cemail">E-mail</Label>
            <Input id="ed-cemail" type="email" value={form.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} />
          </div>
        </div>

        <div className="grid gap-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Plano e máquinas contratadas</h3>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-plan">Plano</Label>
            <Select value={form.plan} onValueChange={(v) => set({ plan: v as ClientPlan })}>
              <SelectTrigger id="ed-plan" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PLAN_LABEL) as ClientPlan[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PLAN_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["machines", "Máquinas contratadas"],
                ["gateways", "Gateways"],
                ["users", "Usuários"],
                ["retentionMonths", "Retenção (meses)"],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="grid gap-1.5">
                <Label htmlFor={`ed-${k}`}>{label}</Label>
                <Input id={`ed-${k}`} type="number" inputMode="numeric" min={1} value={form.limits[k] || ""} onChange={(e) => setLimit(k, e.target.value)} className="tabular-nums" />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{BILLING_NOTE}</p>
        </div>

        <div className="flex items-start gap-3 rounded-xl border p-3">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Configurado pela Engemase</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{ENGEMASE_CONFIG_NOTE}</span>
          </span>
        </div>

        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      </div>
      <SheetFooter className="flex-row justify-end border-t px-5 py-3">
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button onClick={save}>Salvar alterações</Button>
      </SheetFooter>
    </>
  )
}
