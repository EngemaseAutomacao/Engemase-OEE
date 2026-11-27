"use client"

import { useState } from "react"
import { toast } from "sonner"
import { KeyRoundIcon } from "lucide-react"

import { abrirConcessaoAction } from "@/app/(admin)/admin/equipe-actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useTeam } from "./team-context"
import { useTeamAction } from "./use-team-action"

const DURATIONS = [
  { value: "30", label: "30 minutos" },
  { value: "60", label: "1 hora" },
  { value: "120", label: "2 horas" },
  { value: "240", label: "4 horas (máximo)" },
] as const

/**
 * "Abrir concessão de suporte" (com banco): o técnico abre para si mesmo; o super admin escolhe o técnico.
 * Cliente, chamado, motivo e prazo de até 4 h. Vale na hora, sem aprovação do cliente, e fica na auditoria
 * visível a ele (D5).
 */
export function OpenGrantButton() {
  const { clients, members, meId, meRole } = useTeam()
  const { run, pending, banco } = useTeamAction()
  const technicians = members.filter((m) => m.role === "technician" && m.status === "active")
  const [open, setOpen] = useState(false)
  const [clientId, setClientId] = useState("")
  const [userId, setUserId] = useState("")
  const [ticket, setTicket] = useState("")
  const [reason, setReason] = useState("")
  const [minutes, setMinutes] = useState("60")
  const [error, setError] = useState<string | null>(null)

  if (!banco || (meRole !== "technician" && meRole !== "super_admin")) return null
  const forOther = meRole === "super_admin"

  const openDialog = () => {
    setClientId("")
    setUserId(forOther ? (technicians[0]?.id ?? "") : meId)
    setTicket("")
    setReason("")
    setMinutes("60")
    setError(null)
    setOpen(true)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientId) return setError("Escolha o cliente.")
    if (forOther && !userId) return setError("Escolha o técnico.")
    if (!/^#?\d{1,8}$/.test(ticket.trim())) return setError("Informe o número do chamado (ex.: #1060).")
    if (reason.trim().length < 10) return setError("Descreva o motivo (pelo menos 10 caracteres).")
    setError(null)
    const client = clients.find((c) => c.id === clientId)
    run(
      () => abrirConcessaoAction({ clientId, userId: forOther ? userId : null, ticket: ticket.trim(), reason: reason.trim(), minutes: Number(minutes) }),
      () => {
        toast.success("Concessão de suporte aberta", {
          description: `${forOther ? (technicians.find((t) => t.id === userId)?.name ?? "O técnico") : "Você"} pode atuar em ${client?.name ?? "o cliente"} agora. O cliente vê na auditoria.`,
        })
        setOpen(false)
      },
      () => undefined,
    )
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={openDialog} disabled={clients.length === 0}>
        <KeyRoundIcon />
        Abrir concessão
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Abrir concessão de suporte</DialogTitle>
            <DialogDescription>
              Vale na hora, sem aprovação do cliente, por até 4 h. O cliente vê na auditoria quem entrou, o chamado e o motivo.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <div className="grid gap-1.5">
              <Label htmlFor="og-client">Cliente</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="og-client" className="w-full">
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {forOther && (
              <div className="grid gap-1.5">
                <Label htmlFor="og-user">Técnico</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger id="og-user" className="w-full">
                    <SelectValue placeholder="Selecione o técnico" />
                  </SelectTrigger>
                  <SelectContent>
                    {technicians.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="og-ticket">Chamado</Label>
                <Input id="og-ticket" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="#1060" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="og-minutes">Prazo</Label>
                <Select value={minutes} onValueChange={setMinutes}>
                  <SelectTrigger id="og-minutes" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="og-reason">Motivo</Label>
              <Textarea id="og-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Ex.: Conferir o mapeamento das tags da Injetora 04 a pedido do cliente" />
            </div>
            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Abrindo…" : "Abrir concessão"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
