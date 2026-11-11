"use client"

import { useId, useState } from "react"
import { CheckIcon, EyeIcon, EyeOffIcon, LockKeyholeIcon, SaveIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { SectionCard } from "@/components/dashboard/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Dados pessoais: nome, e-mail (com confirmação) e celular. */
export function ProfileForm({ name: initialName, email: initialEmail, roleLabel }: { name: string; email: string; roleLabel: string }) {
  const uid = useId()
  const [saved, setSaved] = useState({ name: initialName, email: initialEmail, phone: "" })
  const [form, setForm] = useState(saved)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

  const dirty = form.name !== saved.name || form.email !== saved.email || form.phone !== saved.phone
  const nameError = form.name.trim().length < 3 ? "Informe o nome completo." : null
  const emailError = !EMAIL_RE.test(form.email.trim()) ? "E-mail inválido." : null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (nameError || emailError) {
      toast.error(nameError ?? emailError ?? "Revise os campos.")
      return
    }
    const emailChanged = form.email.trim() !== saved.email
    setSaved({ ...form, email: saved.email })
    setForm((f) => ({ ...f, email: saved.email }))
    if (emailChanged) {
      setPendingEmail(form.email.trim())
      toast.info("Confirme o novo e-mail", {
        description: `Enviamos um link para ${form.email.trim()}. Até confirmar, você continua entrando com ${saved.email}.`,
      })
    } else {
      toast.success("Perfil atualizado")
    }
  }

  return (
    <SectionCard title="Perfil" description="Como você aparece para os clientes e na auditoria">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-name`}>Nome completo</Label>
            <Input
              id={`${uid}-name`}
              value={form.name}
              autoComplete="name"
              aria-invalid={Boolean(nameError)}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-email`}>E-mail de login</Label>
            <Input
              id={`${uid}-email`}
              type="email"
              value={form.email}
              autoComplete="email"
              aria-invalid={Boolean(emailError)}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            {pendingEmail ? (
              <p className="text-xs text-amber-700 dark:text-state-stopped">
                Aguardando confirmação de <b>{pendingEmail}</b>.{" "}
                <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => toast.success(`Link reenviado para ${pendingEmail}`)}>
                  Reenviar
                </button>{" "}
                ·{" "}
                <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => setPendingEmail(null)}>
                  Cancelar
                </button>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Trocar o e-mail exige confirmação pelo link enviado ao novo endereço.</p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-phone`}>
              Celular <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id={`${uid}-phone`}
              type="tel"
              inputMode="tel"
              placeholder="(47) 99999-0000"
              autoComplete="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Usado para alertas por WhatsApp quando o canal for liberado.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-role`}>Papel</Label>
            <Input id={`${uid}-role`} value={roleLabel} readOnly disabled />
            <p className="text-xs text-muted-foreground">Papéis são definidos por um administrador.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={!dirty} onClick={() => setForm(saved)}>
            Descartar
          </Button>
          <Button type="submit" disabled={!dirty}>
            <SaveIcon />
            Salvar perfil
          </Button>
        </div>
      </form>
    </SectionCard>
  )
}

function PasswordInput({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={show ? "text" : "password"} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} className="pr-10" />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        </button>
      </div>
    </div>
  )
}

/** Troca de senha com requisitos visíveis. */
export function PasswordForm({ email, className }: { email: string; className?: string }) {
  const uid = useId()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")

  const rules = [
    { ok: next.length >= 12, label: "Pelo menos 12 caracteres" },
    { ok: /[a-zA-Z]/.test(next) && /\d/.test(next), label: "Letras e números" },
    { ok: next.length > 0 && next !== current, label: "Diferente da senha atual" },
    { ok: confirm.length > 0 && confirm === next, label: "Confirmação igual" },
  ]
  const score = [next.length >= 12, next.length >= 16, /[A-Z]/.test(next) && /[a-z]/.test(next), /[^a-zA-Z0-9]/.test(next)].filter(Boolean).length
  const valid = current.length > 0 && rules.every((r) => r.ok)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setCurrent("")
    setNext("")
    setConfirm("")
    toast.success("Senha alterada", { description: "Use a nova senha no próximo login em outros aparelhos." })
  }

  return (
    <SectionCard title="Senha" description="Troque periodicamente e não reutilize senhas de outros sites" className={className}>
      <form onSubmit={submit} className="grid gap-3" noValidate>
        <PasswordInput id={`${uid}-cur`} label="Senha atual" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordInput id={`${uid}-new`} label="Nova senha" value={next} onChange={setNext} autoComplete="new-password" />
        <div className="grid grid-cols-4 gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                "h-1 rounded-full",
                i < score ? (score <= 1 ? "bg-state-fault" : score === 2 ? "bg-state-stopped" : "bg-state-running") : "bg-muted",
              )}
            />
          ))}
        </div>
        <PasswordInput id={`${uid}-conf`} label="Confirmar nova senha" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {rules.map((r) => (
            <li key={r.label} className={cn("flex items-center gap-1.5", r.ok ? "text-state-running" : "text-muted-foreground")}>
              {r.ok ? <CheckIcon className="size-3.5" aria-hidden /> : <XIcon className="size-3.5 opacity-60" aria-hidden />}
              {r.label}
            </li>
          ))}
        </ul>
        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            className="text-xs font-semibold text-primary hover:underline"
            onClick={() => toast.info("Link de redefinição enviado", { description: `Confira a caixa de entrada de ${email}. O link vale por 30 minutos.` })}
          >
            Esqueci a senha atual
          </button>
          <Button type="submit" disabled={!valid}>
            <LockKeyholeIcon />
            Alterar senha
          </Button>
        </div>
      </form>
    </SectionCard>
  )
}
