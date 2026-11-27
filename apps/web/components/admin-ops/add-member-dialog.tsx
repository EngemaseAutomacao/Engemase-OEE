"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CheckCircle2Icon, CopyIcon, FingerprintIcon, LinkIcon, UserPlusIcon } from "lucide-react"

import { adicionarMembroEquipeAction, type MembroAdicionado } from "@/app/(admin)/admin/actions"

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

/** Domínio da demonstração; com banco, vale o domínio de quem convida. */
const DEMO_DOMAIN = "engemase.exemplo.com.br"
const VALIDITY = [30, 60, 90, 180] as const

/**
 * Botão + diálogo "Adicionar membro" da equipe Engemase. Com `banco`, grava de verdade (Server Action, só o
 * super admin) e mostra o link "definir senha" para repassar; sem banco (demonstração), simula na tela.
 */
export function AddMemberButton({ banco = false }: { banco?: boolean }) {
  const { members, clients, addMember, addAssignment, agora } = useTeam()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<{ message: string; field?: string } | null>(null)
  const [result, setResult] = useState<MembroAdicionado | null>(null)
  const [copied, setCopied] = useState(false)
  const DOMAIN = banco ? (members.find((m) => m.isMe)?.email.split("@")[1] ?? "engemase.com.br") : DEMO_DOMAIN
  const { read } = useOpsClock(60_000, agora)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<PlatformRole>("technician")
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
    setRole("technician")
    setClientId("none")
    setDays("90")
    setTried(false)
    setServerError(null)
    setResult(null)
    setCopied(false)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (errors.name || errors.email) return
    if (banco) {
      setServerError(null)
      startTransition(async () => {
        const r = await adicionarMembroEquipeAction({
          name: name.trim(),
          email: mail,
          role,
          clientId: role === "technician" && clientId !== "none" ? clientId : null,
          days: Number(days),
        })
        if (!r.ok) {
          setServerError({ message: r.mensagem, field: r.problemas?.[0]?.campo })
          return
        }
        setResult(r.dados)
        router.refresh()
      })
      return
    }
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
    if (role === "technician" && client) {
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
      description: `${mail} recebe um link de uso único para definir a senha (o 2FA é opcional).${role === "technician" && client ? ` Atribuído a ${client.name} por ${days} dias.` : ""}`,
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
            <DialogDescription>
              {banco
                ? "Gera um link de uso único para a pessoa definir a senha (e envia por e-mail, se o e-mail estiver configurado). Membros da Engemase não viram membros dos clientes."
                : "A pessoa recebe um e-mail para definir a senha. Membros da Engemase não viram membros dos clientes."}
            </DialogDescription>
          </DialogHeader>
          {result ? (
            <MemberCreated result={result} name={name.trim()} copied={copied} onCopy={async () => {
              if (!result.link) return
              try {
                await navigator.clipboard.writeText(result.link)
                setCopied(true)
              } catch {
                toast.error("Não deu para copiar. Selecione o link e copie manualmente.")
              }
            }} onClose={() => setOpen(false)} />
          ) : (
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

            {role === "technician" && (
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
                <strong className="font-semibold text-foreground">2FA opcional.</strong> A pessoa cria a senha pelo link do e-mail e pode ativar a verificação em duas
                etapas depois, em &quot;Segurança da conta&quot;. O convite expira em 72 h.
              </span>
            </p>

            {serverError && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {serverError.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Adicionando…" : banco ? "Adicionar e gerar link" : "Enviar convite"}
              </Button>
            </DialogFooter>
          </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Depois de gravar: o link "definir senha" para o super admin repassar (sem e-mail configurado). */
function MemberCreated({
  result,
  name,
  copied,
  onCopy,
  onClose,
}: {
  result: MembroAdicionado
  name: string
  copied: boolean
  onCopy: () => void
  onClose: () => void
}) {
  const validade = result.expiraEm
    ? new Date(result.expiraEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null
  return (
    <div className="grid gap-4">
      <p className="flex items-start gap-2 text-sm">
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
        <span>
          <strong className="font-semibold">{name}</strong> foi adicionado(a) à equipe.
          {result.clienteAtribuido ? ` Atribuído(a) a ${result.clienteAtribuido}.` : ""}
        </span>
      </p>
      {result.link ? (
        <div className="grid gap-2">
          <Label htmlFor="am-link" className="flex items-center gap-1.5">
            <LinkIcon className="size-3.5" aria-hidden />
            Link para definir a senha
          </Label>
          <div className="flex gap-2">
            <Input id="am-link" readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button type="button" variant="outline" onClick={onCopy} aria-label="Copiar link">
              <CopyIcon />
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {result.emailEnviado ? "Também foi enviado por e-mail. " : "Nenhum e-mail foi enviado (provedor não configurado): "}
            entregue o link por um canal seguro (WhatsApp direto, por exemplo). Ele serve uma vez só
            {validade ? ` e vale até ${validade}` : ""}. Não cole em grupo, chamado ou planilha.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">A pessoa já tinha senha: ela entra com o e-mail e a senha de sempre.</p>
      )}
      <DialogFooter>
        <Button type="button" onClick={onClose}>
          Concluir
        </Button>
      </DialogFooter>
    </div>
  )
}
