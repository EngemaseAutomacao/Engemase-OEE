"use client"

import { useState } from "react"
import { toast } from "sonner"
import { FingerprintIcon, UserPlusIcon } from "lucide-react"

import type { PlatformRole } from "@/lib/mock/types"
import { date } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ROLE_META, useTeam } from "./team-context"
import { useOpsClock } from "./use-ops-clock"

const DOMAIN = "engemase.exemplo.com.br"
const VALIDITY = [30, 60, 90, 180] as const

/** Botão + diálogo "Adicionar membro" da equipe Engemase. */
export function AddMemberButton() {
  const { members, clients, addMember, addAssignment } = useTeam()
  const { read } = useOpsClock(60_000)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<PlatformRole>("field_engineer")
  const [clientId, setClientId] = useState("none")
  const [days, setDays] = useState("90")
  const [tried, setTried] = useState(false)

  const mail = email.trim().toLowerCase()
  const errors = {
    name: name.trim().length < 3 ? "Informe o nome completo." : null,
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)
      ? "Informe um e-mail válido."
      : !mail.endsWith(`@${DOMAIN}`)
        ? `Use o e-mail corporativo (@${DOMAIN}).`
        : members.some((m) => m.email.toLowerCase() === mail)
          ? "Já existe um membro com este e-mail."
          : null,
  }

  const reset = () => {
    setName("")
    setEmail("")
    setRole("field_engineer")
    setClientId("none")
    setDays("90")
    setTried(false)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (errors.name || errors.email) return
    const now = read()
    const id = `usr_new_${now}`
    const fullName = name.trim()
    addMember({
      id,
      name: fullName,
      email: mail,
      role,
      status: "invited",
      twoFactor: false,
      lastLoginAt: null,
      lastLoginAgo: "nunca",
      lastLoginLabel: "—",
      isMe: false,
    })
    const client = clients.find((c) => c.id === clientId)
    if (role === "field_engineer" && client) {
      const until = now + Number(days) * 86_400_000
      addAssignment({
        id: `asg_${id}_${client.id}`,
        userId: id,
        userName: fullName,
        clientId: client.id,
        clientName: client.name,
        clientStatus: client.status,
        units: "all",
        unitLabel: client.units.length === 1 ? client.units[0]!.name : "Todas as unidades",
        validFrom: new Date(now).toISOString(),
        validUntil: new Date(until).toISOString(),
        validFromLabel: date(new Date(now).toISOString()),
        validUntilLabel: date(new Date(until).toISOString()),
        daysLeft: Number(days),
        reason: client.status === "onboarding" ? "Implantação: gateways, máquinas e tags" : "Apoio de campo",
        createdBy: members.find((m) => m.isMe)?.name ?? "Super admin",
      })
    }
    toast.success(`Convite enviado para ${fullName}`, {
      description: `${mail} recebe um link de uso único para definir a senha e cadastrar o 2FA.${role === "field_engineer" && client ? ` Atribuído a ${client.name} por ${days} dias.` : ""}`,
    })
    setOpen(false)
  }

  return (
    <>
      <Button
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        <UserPlusIcon />
        Adicionar membro
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Adicionar membro da equipe</DialogTitle>
            <DialogDescription>A pessoa recebe um e-mail para definir a senha. Membros da Engemase não viram membros dos clientes.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="am-name">Nome completo</Label>
                <Input id="am-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Bruna Martins" aria-invalid={tried && !!errors.name} />
                {tried && errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="am-email">E-mail corporativo</Label>
                <Input
                  id="am-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={`nome@${DOMAIN}`}
                  aria-invalid={tried && !!errors.email}
                />
                {tried && errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Papel</Label>
              <RadioGroup value={role} onValueChange={(v) => setRole(v as PlatformRole)} className="grid gap-2">
                {(Object.keys(ROLE_META) as PlatformRole[]).map((r) => {
                  const meta = ROLE_META[r]
                  return (
                    <label
                      key={r}
                      htmlFor={`am-role-${r}`}
                      className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors", role === r ? "border-primary bg-primary/5" : "hover:bg-muted/50")}
                    >
                      <RadioGroupItem id={`am-role-${r}`} value={r} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{meta.label}</span>
                        <span className="block text-xs text-muted-foreground">{meta.summary}</span>
                      </span>
                    </label>
                  )
                })}
              </RadioGroup>
            </div>

            {role === "field_engineer" && (
              <div className="grid gap-3 rounded-xl bg-muted/60 p-3 sm:grid-cols-[1fr_auto]">
                <div className="grid gap-1.5">
                  <Label htmlFor="am-client" className="text-xs">
                    Primeira atribuição (opcional)
                  </Label>
                  <Select value={clientId} onValueChange={setClientId}>
                    <SelectTrigger id="am-client" className="w-full bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Atribuir depois</SelectItem>
                      {clients
                        .filter((c) => c.status !== "suspended")
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="am-days" className="text-xs">
                    Validade
                  </Label>
                  <Select value={days} onValueChange={setDays} disabled={clientId === "none"}>
                    <SelectTrigger id="am-days" className="w-full bg-background sm:w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VALIDITY.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d} dias
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <p className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              <FingerprintIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                <strong className="font-semibold text-foreground">2FA obrigatório.</strong> O cadastro do 2FA é feito pelo link do e-mail; sem ele, a pessoa não entra na
                plataforma. O convite expira em 72 h.
              </span>
            </p>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit">Enviar convite</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
