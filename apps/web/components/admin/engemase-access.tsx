"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { BadgeCheckIcon, CircleStopIcon, HardHatIcon, KeyRoundIcon, LifeBuoyIcon, PlusIcon, ShieldCheckIcon, UserXIcon } from "lucide-react"

import type { RemoteAccessStatus } from "@/lib/mock"
import { date } from "@/lib/format"
import { cn } from "@/lib/utils"
import { SectionCard } from "@/components/dashboard/section-card"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Assignment, RemoteSessionRow, SupportGrant } from "./admin-data"
import { SoftBadge, TD, TH, squareClass } from "./bits"
import type { SoftTone } from "./labels"

const GRANT_STATUS: Record<SupportGrant["status"], { label: string; tone: SoftTone }> = {
  active: { label: "Ativa", tone: "green" },
  ended: { label: "Encerrada", tone: "slate" },
  revoked: { label: "Revogada", tone: "red" },
}

const ASSIGNMENT_STATUS: Record<Assignment["status"], { label: string; tone: SoftTone }> = {
  active: { label: "Válida", tone: "green" },
  expired: { label: "Expirada", tone: "slate" },
  revoked: { label: "Revogada", tone: "red" },
}

const REMOTE_STATUS: Record<RemoteAccessStatus, { label: string; tone: SoftTone }> = {
  requested: { label: "Aguardando o cliente", tone: "violet" },
  approved: { label: "Aprovada", tone: "blue" },
  active: { label: "Em andamento", tone: "green" },
  ended: { label: "Encerrada", tone: "slate" },
  rejected: { label: "Recusada", tone: "red" },
  expired_unapproved: { label: "Expirou sem aprovação", tone: "slate" },
  revoked: { label: "Revogada", tone: "red" },
}

const GRANT_DURATIONS = [
  { value: "30", label: "30 minutos" },
  { value: "60", label: "1 hora" },
  { value: "120", label: "2 horas" },
  { value: "240", label: "4 horas (máximo)" },
]

const ASSIGNMENT_DAYS = [
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "180", label: "6 meses" },
  { value: "365", label: "12 meses" },
]

function RowAction({ label, icon: Icon, onClick }: { label: string; icon: typeof UserXIcon; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} className={squareClass("red")} onClick={onClick}>
          <Icon aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Aba "Acesso Engemase": concessões de suporte, atribuições de campo e acesso remoto (docs/15 §3). */
export function EngemaseAccess({
  clientName,
  now,
  grants: initialGrants,
  assignments: initialAssignments,
  supportPeople,
  fieldPeople,
  units,
  remoteSessions,
  remotePolicy,
}: {
  clientName: string
  now: string
  grants: SupportGrant[]
  assignments: Assignment[]
  supportPeople: string[]
  fieldPeople: string[]
  units: { id: string; name: string }[]
  remoteSessions: RemoteSessionRow[]
  remotePolicy: string
}) {
  const [grants, setGrants] = useState(initialGrants)
  const [assignments, setAssignments] = useState(initialAssignments)
  const [grantOpen, setGrantOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  // muda a cada abertura para zerar os formulários (sem esvaziar o diálogo durante a animação de saída)
  const [formKey, setFormKey] = useState(0)
  const openGrant = () => {
    setFormKey((k) => k + 1)
    setGrantOpen(true)
  }
  const openAssign = () => {
    setFormKey((k) => k + 1)
    setAssignOpen(true)
  }

  const endGrant = (g: SupportGrant) => {
    setGrants((list) => list.map((x) => (x.id === g.id ? { ...x, status: "revoked", end: "agora" } : x)))
    toast.success("Concessão encerrada", { description: `${g.userName} perdeu o acesso a ${clientName}. Registro mantido na auditoria.` })
  }
  const revokeAssignment = (a: Assignment) => {
    setAssignments((list) => list.map((x) => (x.id === a.id ? { ...x, status: "revoked" } : x)))
    toast.success("Atribuição revogada", { description: `${a.userName} não acessa mais ${clientName}.` })
  }

  const activeGrants = grants.filter((g) => g.status === "active").length
  const activeAssignments = assignments.filter((a) => a.status === "active").length

  return (
    <div className="flex flex-col gap-4">
      {/* Como a Engemase entra no cliente */}
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { icon: ShieldCheckIcon, tone: "navy" as const, title: "Super admin", text: "Acesso a todos os clientes, sempre auditado; ações destrutivas pedem motivo." },
          { icon: LifeBuoyIcon, tone: "blue" as const, title: "Suporte", text: `Concessão interna da Engemase (chamado e prazo de até 4 h), sem depender de aprovação do cliente (D5). ${activeGrants === 0 ? "Nenhuma ativa agora." : `${activeGrants} ativa${activeGrants === 1 ? "" : "s"} agora.`}` },
          { icon: HardHatIcon, tone: "teal" as const, title: "Engenheiro de campo", text: `Configura o cliente (D13) nos clientes atribuídos, com validade. ${activeAssignments === 0 ? "Nenhuma atribuição válida." : activeAssignments === 1 ? "1 atribuição válida." : `${activeAssignments} atribuições válidas.`}` },
        ].map((c) => (
          <div key={c.title} className="flex items-start gap-3 rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <IconCircle icon={c.icon} tone={c.tone} soft size="sm" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">{c.title}</div>
              <p className="text-xs text-muted-foreground">{c.text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Concessões de suporte"
          description="Leitura de cadastros, configurações, saúde e painéis + comandos de diagnóstico"
          action={
            <Button size="sm" onClick={openGrant} aria-label="Nova concessão" className="shrink-0">
              <PlusIcon />
              <span className="hidden sm:inline">Nova concessão</span>
            </Button>
          }
        >
          {grants.length === 0 ? (
            <Empty className="border border-dashed p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LifeBuoyIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhuma concessão</EmptyTitle>
                <EmptyDescription>Cada entrada do suporte em {clientName} fica registrada como concessão ligada a um chamado, visível ao cliente na auditoria.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[500px] text-sm">
                <thead className="border-b">
                  <tr>
                    <th className={TH}>Pessoa · chamado</th>
                    <th className={TH}>Período</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {grants.map((g) => (
                    <tr key={g.id} className="align-top">
                      <td className={TD}>
                        <div className="font-semibold">
                          {g.userName} <span className="font-normal text-muted-foreground">· {g.ticket}</span>
                        </div>
                        <div className="line-clamp-2 max-w-72 text-xs text-muted-foreground">{g.reason}</div>
                      </td>
                      <td className={cn(TD, "text-xs whitespace-nowrap tabular-nums")}>
                        <div>{g.start}</div>
                        <div className="text-muted-foreground">até {g.end}</div>
                      </td>
                      <td className={TD}>
                        <SoftBadge tone={GRANT_STATUS[g.status].tone} dot>
                          {GRANT_STATUS[g.status].label}
                        </SoftBadge>
                      </td>
                      <td className={cn(TD, "text-right")}>{g.status === "active" && <RowAction label={`Encerrar concessão de ${g.userName}`} icon={CircleStopIcon} onClick={() => endGrant(g)} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Atribuições de engenheiros de campo"
          description="Configuram unidades, linhas, máquinas, gateways e tags; não mexem em usuários"
          action={
            <Button size="sm" onClick={openAssign} aria-label="Nova atribuição" className="shrink-0">
              <PlusIcon />
              <span className="hidden sm:inline">Nova atribuição</span>
            </Button>
          }
        >
          {assignments.length === 0 ? (
            <Empty className="border border-dashed p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HardHatIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhuma atribuição</EmptyTitle>
                <EmptyDescription>Atribua um engenheiro de campo para comissionar gateways e máquinas deste cliente.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[500px] text-sm">
                <thead className="border-b">
                  <tr>
                    <th className={TH}>Pessoa · unidades</th>
                    <th className={TH}>Validade</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {assignments.map((a) => (
                    <tr key={a.id} className="align-top">
                      <td className={TD}>
                        <div className="font-semibold">
                          {a.userName} <span className="font-normal text-muted-foreground">· {a.units}</span>
                        </div>
                        <div className="line-clamp-2 max-w-64 text-xs text-muted-foreground">{a.reason}</div>
                      </td>
                      <td className={cn(TD, "text-xs whitespace-nowrap tabular-nums")}>
                        <div>{a.start}</div>
                        <div className="text-muted-foreground">até {a.end}</div>
                      </td>
                      <td className={TD}>
                        <SoftBadge tone={ASSIGNMENT_STATUS[a.status].tone} dot>
                          {ASSIGNMENT_STATUS[a.status].label}
                        </SoftBadge>
                      </td>
                      <td className={cn(TD, "text-right")}>{a.status === "active" && <RowAction label={`Revogar atribuição de ${a.userName}`} icon={UserXIcon} onClick={() => revokeAssignment(a)} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Acesso remoto aos gateways (VPN)" description={`Política do cliente: ${remotePolicy.toLowerCase()}`} href="/admin/acesso-remoto" linkLabel="Ver todos os pedidos">
        {remoteSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pedido de acesso remoto para este cliente.</p>
        ) : (
          <ul className="divide-y">
            {remoteSessions.map((s) => (
              <li key={s.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <IconCircle icon={KeyRoundIcon} tone={s.status === "active" ? "green" : s.status === "requested" ? "violet" : "slate"} soft size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold">{s.gateway}</span>
                    <SoftBadge tone={REMOTE_STATUS[s.status].tone} dot>
                      {REMOTE_STATUS[s.status].label}
                    </SoftBadge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.requestedBy} · chamado {s.ticket} · {s.reason}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{s.when}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <BadgeCheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Toda entrada da Engemase aparece com faixa na tela e fica na auditoria visível ao cliente. A VPN só abre com aprovação do admin do cliente.{" "}
          <Link href="/admin/auditoria" className="font-semibold text-primary hover:underline">
            Auditoria
          </Link>
        </p>
      </SectionCard>

      <GrantDialog
        formKey={formKey}
        open={grantOpen}
        onOpenChange={setGrantOpen}
        people={supportPeople}
        clientName={clientName}
        onCreate={(g) => {
          setGrants((list) => [{ ...g, id: `grt-new-${list.length + 1}` }, ...list])
          setGrantOpen(false)
        }}
      />
      <AssignDialog
        formKey={formKey}
        open={assignOpen}
        onOpenChange={setAssignOpen}
        people={fieldPeople}
        units={units}
        clientName={clientName}
        now={now}
        onCreate={(a) => {
          setAssignments((list) => [{ ...a, id: `asg-new-${list.length + 1}` }, ...list])
          setAssignOpen(false)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diálogos
// ---------------------------------------------------------------------------
function GrantDialog({
  formKey,
  open,
  onOpenChange,
  people,
  clientName,
  onCreate,
}: {
  formKey: number
  open: boolean
  onOpenChange: (o: boolean) => void
  people: string[]
  clientName: string
  onCreate: (g: Omit<SupportGrant, "id">) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova concessão de suporte</DialogTitle>
          <DialogDescription>Libera o suporte para atuar em {clientName} por tempo limitado, ligado a um chamado.</DialogDescription>
        </DialogHeader>
        <GrantForm key={formKey} people={people} clientName={clientName} onCreate={onCreate} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function GrantForm({ people, clientName, onCreate, onCancel }: { people: string[]; clientName: string; onCreate: (g: Omit<SupportGrant, "id">) => void; onCancel: () => void }) {
  const [person, setPerson] = useState(people[0] ?? "")
  const [ticket, setTicket] = useState("")
  const [reason, setReason] = useState("")
  const [minutes, setMinutes] = useState("60")
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (!person) return setError("Escolha a pessoa do suporte.")
    if (!/^#?\d{3,6}$/.test(ticket.trim())) return setError("Informe o número do chamado (ex.: #1060).")
    if (reason.trim().length < 10) return setError("Descreva o motivo (pelo menos 10 caracteres).")
    const label = GRANT_DURATIONS.find((d) => d.value === minutes)!.label.replace(" (máximo)", "")
    const t = ticket.trim().startsWith("#") ? ticket.trim() : `#${ticket.trim()}`
    onCreate({ userName: person, ticket: t, reason: reason.trim(), start: "agora", end: `em ${label}`, status: "active" })
    toast.success("Concessão criada", { description: `${person} pode atuar em ${clientName} por ${label}. O admin do cliente recebe um aviso.` })
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="gr-person">Pessoa do suporte</Label>
          <Select value={person} onValueChange={setPerson}>
            <SelectTrigger id="gr-person" className="w-full">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {people.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="gr-ticket">Chamado</Label>
            <Input id="gr-ticket" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="#1060" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gr-minutes">Prazo</Label>
            <Select value={minutes} onValueChange={setMinutes}>
              <SelectTrigger id="gr-minutes" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRANT_DURATIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="gr-reason">Motivo</Label>
          <Textarea id="gr-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: Conferir mapeamento das tags da Injetora 04 a pedido do cliente" rows={3} />
        </div>
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={submit}>Criar concessão</Button>
      </DialogFooter>
    </>
  )
}

function AssignDialog({
  formKey,
  open,
  onOpenChange,
  people,
  units,
  clientName,
  now,
  onCreate,
}: {
  formKey: number
  open: boolean
  onOpenChange: (o: boolean) => void
  people: string[]
  units: { id: string; name: string }[]
  clientName: string
  now: string
  onCreate: (a: Omit<Assignment, "id">) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova atribuição de campo</DialogTitle>
          <DialogDescription>O engenheiro de campo passa a configurar {clientName} até a data de validade.</DialogDescription>
        </DialogHeader>
        <AssignForm key={formKey} people={people} units={units} clientName={clientName} now={now} onCreate={onCreate} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function AssignForm({
  people,
  units,
  clientName,
  now,
  onCreate,
  onCancel,
}: {
  people: string[]
  units: { id: string; name: string }[]
  clientName: string
  now: string
  onCreate: (a: Omit<Assignment, "id">) => void
  onCancel: () => void
}) {
  const [person, setPerson] = useState(people[0] ?? "")
  const [allUnits, setAllUnits] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [days, setDays] = useState("90")
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)))

  const submit = () => {
    if (!person) return setError("Escolha o engenheiro de campo.")
    if (!allUnits && selected.length === 0) return setError("Selecione ao menos uma unidade (nenhuma unidade = nenhum acesso).")
    if (reason.trim().length < 5) return setError("Descreva o motivo.")
    const end = date(new Date(Date.parse(now) + Number(days) * 24 * 60 * 60 * 1000).toISOString())
    const unitsLabel = allUnits ? "Todas as unidades" : units.filter((u) => selected.includes(u.id)).map((u) => u.name).join(", ")
    onCreate({ userName: person, units: unitsLabel, start: date(now), end, reason: reason.trim(), status: "active" })
    toast.success("Atribuição criada", { description: `${person} pode configurar ${clientName} até ${end}.` })
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="as-person">Engenheiro de campo</Label>
            <Select value={person} onValueChange={setPerson}>
              <SelectTrigger id="as-person" className="w-full">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="as-days">Validade</Label>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger id="as-days" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNMENT_DAYS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Unidades</legend>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allUnits} onCheckedChange={(v) => setAllUnits(v === true)} />
            Todas as unidades do cliente
          </label>
          {!allUnits && (
            <div className="grid gap-1.5 rounded-lg border p-3">
              {units.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selected.includes(u.id)} onCheckedChange={(v) => toggle(u.id, v === true)} />
                  {u.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor="as-reason">Motivo</Label>
          <Input id="as-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: Comissionamento da Linha de Envase" />
        </div>
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={submit}>Criar atribuição</Button>
      </DialogFooter>
    </>
  )
}
