"use client"

import { useState } from "react"
import { InfoIcon, LockIcon, MailCheckIcon, ShieldAlertIcon, TriangleAlertIcon } from "lucide-react"

import type { ClientRole } from "@/lib/mock/types"
import { CLIENT_ROLE_DESCRIPTION, CLIENT_ROLE_LABEL } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { ClientUserRow, SettingsUnit } from "@/components/settings/types"

export const ROLE_ORDER: ClientRole[] = ["client_admin", "engineer", "supervisor", "operator", "viewer"]

/** Observações de docs/15 que complementam a descrição curta de cada papel. */
const ROLE_NOTE: Partial<Record<ClientRole, string>> = {
  client_admin: "Sempre com o cliente inteiro. Só o admin concede papéis.",
  operator: "Para quem aponta no próprio aparelho (ex.: líder de linha). Operadores do chão usam o tablet pareado e não precisam de conta.",
  viewer: "TV e Andon não usam conta de pessoa: pareie um terminal em Configurações › Terminais.",
}

export interface UserFormValue {
  name: string
  email: string
  role: ClientRole
  unitScope: "all" | string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function UserDialog({
  open,
  onOpenChange,
  editing,
  units,
  existingEmails,
  isLastAdmin,
  seatsLeft,
  clientName,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Usuário em edição; `null` = adicionar. */
  editing: ClientUserRow | null
  units: SettingsUnit[]
  existingEmails: string[]
  isLastAdmin: boolean
  seatsLeft: number
  clientName: string
  onSubmit: (value: UserFormValue) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {open && (
          <UserForm
            key={editing?.id ?? "new"}
            editing={editing}
            units={units}
            existingEmails={existingEmails}
            isLastAdmin={isLastAdmin}
            seatsLeft={seatsLeft}
            clientName={clientName}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function UserForm({
  editing,
  units,
  existingEmails,
  isLastAdmin,
  seatsLeft,
  clientName,
  onCancel,
  onSubmit,
}: {
  editing: ClientUserRow | null
  units: SettingsUnit[]
  existingEmails: string[]
  isLastAdmin: boolean
  seatsLeft: number
  clientName: string
  onCancel: () => void
  onSubmit: (value: UserFormValue) => void
}) {
  const [name, setName] = useState(editing?.name ?? "")
  const [email, setEmail] = useState(editing?.email ?? "")
  const [role, setRole] = useState<ClientRole>(editing?.role ?? "supervisor")
  const [scopeMode, setScopeMode] = useState<"all" | "units">(editing && editing.unitScope !== "all" ? "units" : "all")
  const [selected, setSelected] = useState<string[]>(editing && editing.unitScope !== "all" ? editing.unitScope : [])
  const [touched, setTouched] = useState(false)

  const isEdit = editing !== null
  const forcedAll = role === "client_admin"
  const effectiveScope: "all" | string[] = forcedAll || scopeMode === "all" ? "all" : selected
  const emailNorm = email.trim().toLowerCase()

  const errors = {
    name: !isEdit && name.trim().length < 3 ? "Informe o nome completo." : null,
    email: isEdit
      ? null
      : !EMAIL_RE.test(emailNorm)
        ? "Informe um e-mail válido."
        : existingEmails.includes(emailNorm)
          ? "Já existe uma pessoa com esse e-mail neste cliente."
          : null,
    scope: effectiveScope !== "all" && effectiveScope.length === 0 ? "Selecione ao menos uma unidade. Nenhuma unidade = nenhum acesso." : null,
    seats: !isEdit && seatsLeft <= 0 ? "Limite de usuários do plano atingido." : null,
  }
  const valid = !errors.name && !errors.email && !errors.scope && !errors.seats

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!valid) return
    onSubmit({ name: name.trim(), email: emailNorm, role, unitScope: effectiveScope })
  }

  const toggleUnit = (id: string, on: boolean) => setSelected((s) => (on ? [...new Set([...s, id])] : s.filter((x) => x !== id)))

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{isEdit ? `Alterar papel e unidades · ${editing.name}` : "Adicionar usuário"}</DialogTitle>
        <DialogDescription>
          {isEdit ? "A mudança vale no próximo carregamento de página da pessoa e fica registrada na auditoria." : `A pessoa passa a acessar ${clientName} com o papel e as unidades escolhidos.`}
        </DialogDescription>
      </DialogHeader>

      {!isEdit && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="usr-name">Nome completo</Label>
            <Input id="usr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Juliana Costa" autoComplete="off" aria-invalid={touched && !!errors.name} />
            {touched && errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="usr-email">E-mail corporativo</Label>
            <Input
              id="usr-email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@empresa.com.br"
              autoComplete="off"
              aria-invalid={touched && !!errors.email}
            />
            {touched && errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>
        </div>
      )}
      {isEdit && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-muted/60 px-4 py-3 text-sm">
          <span className="font-medium">{editing.name}</span>
          <span className="text-muted-foreground">{editing.email ?? `usuário ${editing.username}`}</span>
        </div>
      )}

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Papel</legend>
        <RadioGroup value={role} onValueChange={(v) => setRole(v as ClientRole)} className="grid gap-2 sm:grid-cols-2">
          {ROLE_ORDER.map((r) => {
            const locked = isEdit && isLastAdmin && r !== "client_admin"
            return (
              <Label
                key={r}
                htmlFor={`role-${r}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal transition hover:bg-muted/50",
                  role === r && "border-primary bg-primary/5 ring-1 ring-primary/30",
                  locked && "cursor-not-allowed opacity-50",
                  r === "client_admin" && "sm:col-span-2",
                )}
              >
                <RadioGroupItem id={`role-${r}`} value={r} disabled={locked} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="text-sm font-semibold">{CLIENT_ROLE_LABEL[r]}</span>
                  <span className="text-xs leading-snug text-muted-foreground">{CLIENT_ROLE_DESCRIPTION[r]}</span>
                  {ROLE_NOTE[r] && <span className="text-[11px] leading-snug text-muted-foreground/90 italic">{ROLE_NOTE[r]}</span>}
                </span>
              </Label>
            )
          })}
        </RadioGroup>
        {isEdit && isLastAdmin && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockIcon className="size-3.5" />
            Esta pessoa é o último admin do cliente. Promova outra pessoa a admin antes de mudar o papel dela.
          </p>
        )}
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Unidades que a pessoa vê</legend>
        {forcedAll ? (
          <p className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
            <LockIcon className="size-3.5 shrink-0" />
            Admin do cliente sempre tem acesso a todas as unidades ({units.length}).
          </p>
        ) : (
          <>
            <RadioGroup value={scopeMode} onValueChange={(v) => setScopeMode(v as "all" | "units")} className="grid gap-2 sm:grid-cols-2">
              {[
                { v: "all", title: "Todas as unidades", hint: "Inclui unidades criadas no futuro" },
                { v: "units", title: "Somente algumas unidades", hint: "Relatórios e totais mostram só essas unidades" },
              ].map((o) => (
                <Label
                  key={o.v}
                  htmlFor={`scope-${o.v}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal transition hover:bg-muted/50",
                    scopeMode === o.v && "border-primary bg-primary/5 ring-1 ring-primary/30",
                  )}
                >
                  <RadioGroupItem id={`scope-${o.v}`} value={o.v} className="mt-0.5" />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-semibold">{o.title}</span>
                    <span className="text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
            {scopeMode === "units" && (
              <div className="grid gap-2 rounded-xl bg-muted/50 p-3 sm:grid-cols-2">
                {units.map((u) => (
                  <Label key={u.id} htmlFor={`unit-${u.id}`} className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-card px-3 py-2 font-normal">
                    <Checkbox id={`unit-${u.id}`} checked={selected.includes(u.id)} onCheckedChange={(c) => toggleUnit(u.id, c === true)} />
                    <span className="text-sm">{u.name}</span>
                  </Label>
                ))}
              </div>
            )}
            {errors.scope && (touched || scopeMode === "units") && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <TriangleAlertIcon className="size-3.5" />
                {errors.scope}
              </p>
            )}
          </>
        )}
      </fieldset>

      {!isEdit && (
        <Alert className="border-primary/25 bg-primary/5">
          <MailCheckIcon />
          <AlertTitle>Como a pessoa entra</AlertTitle>
          <AlertDescription>
            <p>
              Ela recebe um e-mail para <strong>definir a senha</strong>. O link é de uso único, vale por 72 h e também confirma o e-mail. Até lá, aparece aqui como
              “Convite pendente”. Ninguém cria ou envia senha por esta tela.
            </p>
          </AlertDescription>
        </Alert>
      )}
      {errors.seats && (
        <Alert variant="destructive">
          <ShieldAlertIcon />
          <AlertTitle>{errors.seats}</AlertTitle>
          <AlertDescription>Desative quem não usa mais a plataforma ou fale com a Engemase para ampliar o plano.</AlertDescription>
        </Alert>
      )}
      {isEdit && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          Reduzir as unidades remove imediatamente o acesso a dashboards, relatórios e exportações das unidades retiradas.
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={touched && !valid}>
          {isEdit ? "Salvar alterações" : "Adicionar e enviar e-mail"}
        </Button>
      </DialogFooter>
    </form>
  )
}
