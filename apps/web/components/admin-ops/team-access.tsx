"use client"

import { useState } from "react"
import { toast } from "sonner"
import { CalendarPlusIcon, CalendarRangeIcon, HardHatIcon, KeyRoundIcon, PlusIcon, TicketIcon, XIcon } from "lucide-react"

import { date, dateTime, duration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { SectionCard } from "@/components/dashboard/section-card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PersonAvatar, SoftBadge, TD, TH, squareClass } from "./bits"
import { useTeam } from "./team-context"
import { SUPPORT_MAX_HOURS } from "./labels"
import type { AssignmentRow } from "./team-data"
import { countdown, useOpsClock } from "./use-ops-clock"

const DAY = 86_400_000
const VALIDITY = [30, 60, 90, 180] as const

/** Atribuições de engenheiros de campo (cliente, unidades e validade). */
export function FieldAssignments({ className }: { className?: string }) {
  const { members, clients, assignments, addAssignment, patchAssignment, removeAssignment } = useTeam()
  const { now, read } = useOpsClock(60_000)
  const [open, setOpen] = useState(false)
  const [userId, setUserId] = useState("")
  const [clientId, setClientId] = useState("")
  const [allUnits, setAllUnits] = useState(true)
  const [units, setUnits] = useState<string[]>([])
  const [days, setDays] = useState("90")
  const [reason, setReason] = useState("")
  const [tried, setTried] = useState(false)

  const engineers = members.filter((m) => m.role === "field_engineer" && m.status !== "disabled")
  const client = clients.find((c) => c.id === clientId)
  const me = members.find((m) => m.isMe)?.name ?? "Super admin"
  const errors = {
    user: !userId,
    client: !clientId,
    units: !allUnits && units.length === 0,
    reason: reason.trim().length < 5,
    duplicate: assignments.some((a) => a.userId === userId && a.clientId === clientId && Date.parse(a.validUntil) > now),
  }

  const openDialog = () => {
    setUserId(engineers[0]?.id ?? "")
    setClientId("")
    setAllUnits(true)
    setUnits([])
    setDays("90")
    setReason("")
    setTried(false)
    setOpen(true)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (errors.user || errors.client || errors.units || errors.reason || errors.duplicate || !client) return
    const user = engineers.find((m) => m.id === userId)!
    const t = read()
    const until = t + Number(days) * DAY
    const scope = allUnits || units.length === client.units.length ? "all" : units
    addAssignment({
      id: `asg_${user.id}_${client.id}_${t}`,
      userId: user.id,
      userName: user.name,
      clientId: client.id,
      clientName: client.name,
      clientStatus: client.status,
      units: scope,
      unitLabel: scope === "all" ? (client.units.length === 1 ? client.units[0]!.name : "Todas as unidades") : client.units.filter((u) => units.includes(u.id)).map((u) => u.name).join(", "),
      validFrom: new Date(t).toISOString(),
      validUntil: new Date(until).toISOString(),
      validFromLabel: date(new Date(t).toISOString()),
      validUntilLabel: date(new Date(until).toISOString()),
      daysLeft: Number(days),
      reason: reason.trim(),
      createdBy: me,
    })
    toast.success(`${user.name} atribuído a ${client.name}`, { description: `Válido até ${date(new Date(until).toISOString())}. Registrado na auditoria visível ao cliente.` })
    setOpen(false)
  }

  const renew = (a: AssignmentRow) => {
    const until = Math.max(Date.parse(a.validUntil), now) + 90 * DAY
    patchAssignment(a.id, { validUntil: new Date(until).toISOString(), validUntilLabel: date(new Date(until).toISOString()) })
    toast.success("Atribuição renovada por 90 dias", { description: `${a.userName} · ${a.clientName} · até ${date(new Date(until).toISOString())}` })
  }
  const revoke = (a: AssignmentRow) => {
    removeAssignment(a.id)
    toast.success("Atribuição revogada", { description: `${a.userName} perdeu o acesso a ${a.clientName} imediatamente.` })
  }

  return (
    <SectionCard
      title="Atribuições de engenheiros de campo"
      description="Acesso só aos clientes atribuídos, com unidades e validade"
      className={className}
      action={
        <Button size="sm" variant="outline" onClick={openDialog} disabled={engineers.length === 0}>
          <PlusIcon />
          Nova atribuição
        </Button>
      }
      bodyClassName="px-0 pb-2"
    >
      {assignments.length === 0 ? (
        <div className="px-5 pb-3">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HardHatIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhuma atribuição</EmptyTitle>
              <EmptyDescription>Engenheiros de campo só acessam clientes atribuídos por um super admin.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <div className="overflow-x-auto px-5">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b">
              <tr>
                <th className={TH}>Engenheiro</th>
                <th className={TH}>Cliente e unidades</th>
                <th className={TH}>Validade</th>
                <th className={TH}>Motivo</th>
                <th className={cn(TH, "text-right")}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {assignments.map((a) => {
                const left = Math.ceil((Date.parse(a.validUntil) - now) / DAY)
                return (
                  <tr key={a.id} className="transition-colors hover:bg-muted/40">
                    <td className={TD}>
                      <div className="flex items-center gap-2.5">
                        <PersonAvatar name={a.userName} tone="orange" size="sm" />
                        <span className="truncate font-medium">{a.userName}</span>
                      </div>
                    </td>
                    <td className={TD}>
                      <div className="leading-tight">
                        <div className="truncate">{a.clientName}</div>
                        <div className="truncate text-xs text-muted-foreground">{a.unitLabel}</div>
                      </div>
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      <div className="text-xs tabular-nums">
                        {a.validFromLabel} → {a.validUntilLabel}
                      </div>
                      <SoftBadge tone={left <= 0 ? "slate" : left <= 15 ? "red" : left <= 30 ? "amber" : "green"} className="mt-1">
                        {left <= 0 ? "Vencida" : `vence em ${left} dia${left === 1 ? "" : "s"}`}
                      </SoftBadge>
                    </td>
                    <td className={cn(TD, "max-w-56 text-xs text-muted-foreground")}>
                      <span className="line-clamp-2">{a.reason}</span>
                      <span className="block text-[11px]">por {a.createdBy}</span>
                    </td>
                    <td className={TD}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button type="button" onClick={() => renew(a)} className={squareClass("teal")} aria-label={`Renovar atribuição de ${a.userName} em ${a.clientName}`} title="Renovar por 90 dias">
                          <CalendarPlusIcon aria-hidden />
                        </button>
                        <button type="button" onClick={() => revoke(a)} className={squareClass("red")} aria-label={`Revogar atribuição de ${a.userName} em ${a.clientName}`} title="Revogar">
                          <XIcon aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova atribuição</DialogTitle>
            <DialogDescription>O engenheiro de campo passa a configurar unidades, máquinas, gateways e tags do cliente até a data de validade.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="na-user">Engenheiro de campo</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger id="na-user" className="w-full" aria-invalid={tried && errors.user}>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {engineers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="na-client">Cliente</Label>
                <Select
                  value={clientId}
                  onValueChange={(v) => {
                    setClientId(v)
                    setUnits([])
                    setAllUnits(true)
                  }}
                >
                  <SelectTrigger id="na-client" className="w-full" aria-invalid={tried && errors.client}>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id} disabled={c.status === "suspended"}>
                        {c.name}
                        {c.status === "suspended" ? " · suspenso" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tried && errors.client && <p className="text-xs text-destructive">Escolha o cliente.</p>}
              </div>
            </div>
            {tried && errors.duplicate && <p className="-mt-2 text-xs text-destructive">Este engenheiro já tem uma atribuição vigente neste cliente. Use “Renovar”.</p>}

            {client && (
              <div className="grid gap-2 rounded-xl bg-muted/60 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={allUnits} onCheckedChange={(v) => setAllUnits(v === true)} />
                  Todas as unidades de {client.name}
                </label>
                {!allUnits && (
                  <div className="grid gap-1.5 pl-6">
                    {client.units.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={units.includes(u.id)}
                          onCheckedChange={(v) => setUnits((list) => (v === true ? [...list, u.id] : list.filter((x) => x !== u.id)))}
                        />
                        {u.name}
                      </label>
                    ))}
                    {tried && errors.units && <p className="text-xs text-destructive">Marque ao menos uma unidade (nenhuma unidade = nenhum acesso).</p>}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-1.5">
                <Label htmlFor="na-reason">Motivo</Label>
                <Input id="na-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: Comissionamento da Linha de Envase" aria-invalid={tried && errors.reason} />
                {tried && errors.reason && <p className="text-xs text-destructive">Descreva o motivo (aparece na auditoria do cliente).</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="na-days">Validade</Label>
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger id="na-days" className="w-full sm:w-32">
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit">
                <CalendarRangeIcon />
                Atribuir
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}

/** Concessões de suporte: ativas (com contagem regressiva) e encerradas recentemente. */
export function SupportGrants({ className }: { className?: string }) {
  const { grants, patchGrant } = useTeam()
  const { now, read } = useOpsClock(1000)
  const active = grants.filter((g) => g.endedAt === null && Date.parse(g.endsAt) > now)
  const recent = grants.filter((g) => !(g.endedAt === null && Date.parse(g.endsAt) > now)).slice(0, 4)

  const end = (id: string, who: string, client: string) => {
    const t = new Date(read()).toISOString()
    patchGrant(id, { endedAt: t, endsAt: t, endsLabel: dateTime(t), active: false })
    toast.success("Concessão de suporte encerrada", { description: `${who} perdeu o acesso a ${client}. O cliente vê o encerramento na auditoria.` })
  }

  return (
    <SectionCard title="Concessões de suporte" description={`Cliente, motivo e chamado · até ${SUPPORT_MAX_HOURS} h · sempre visível ao cliente`} className={className}>
      {active.length === 0 ? (
        <Empty className="border border-dashed p-6 md:p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma concessão ativa</EmptyTitle>
            <EmptyDescription>O suporte abre uma concessão ao atender um chamado; ela expira sozinha.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-3">
          {active.map((g) => {
            const total = Date.parse(g.endsAt) - Date.parse(g.startedAt)
            const left = Date.parse(g.endsAt) - now
            return (
              <li key={g.id} className="rounded-xl border p-3">
                <div className="flex items-start gap-3">
                  <PersonAvatar name={g.userName} tone="teal" />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-sm font-semibold">
                      {g.userName} <span className="font-normal text-muted-foreground">→ {g.clientName}</span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{g.reason}</div>
                  </div>
                  <SoftBadge tone="navy" icon={TicketIcon}>
                    {g.ticket}
                  </SoftBadge>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-[#0e9384]" style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%` }} />
                  </span>
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums">{countdown(left)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    Desde {g.startedLabel} · termina {g.endsLabel}
                  </span>
                  <Button size="xs" variant="outline" onClick={() => end(g.id, g.userName, g.clientName)} className="text-state-fault hover:text-state-fault">
                    Encerrar concessão
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {recent.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">Encerradas recentemente</div>
          <ul className="divide-y">
            {recent.map((g) => (
              <li key={g.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <PersonAvatar name={g.userName} tone="slate" size="sm" />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm">
                    {g.userName} <span className="text-muted-foreground">→ {g.clientName}</span>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {g.ticket} · {g.startedLabel} · {g.endedAt ? duration((Date.parse(g.endedAt) - Date.parse(g.startedAt)) / 1000) : g.durationLabel}
                  </div>
                </div>
                <SoftBadge tone="slate">Encerrada</SoftBadge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  )
}
