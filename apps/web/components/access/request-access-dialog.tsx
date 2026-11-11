"use client"

import { useState } from "react"
import { CalendarClockIcon, KeyRoundIcon, ShieldAlertIcon, TriangleAlertIcon, WifiOffIcon } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { RemoteAccessVM, RemoteSessionVM } from "./gateway-detail-data"
import { minutesLabel } from "./labels"

const DURATIONS = [30, 60, 120, 240, 480]

/** Diálogo "Solicitar acesso" (VPN de manutenção, docs/12): motivo, chamado, duração e escopo. */
export function RequestAccessDialog({
  gatewayName,
  hostname,
  remote,
  offline,
  nowLabel,
  disabled,
  onRequested,
}: {
  gatewayName: string
  hostname: string
  remote: RemoteAccessVM
  offline: boolean
  nowLabel: string
  disabled?: boolean
  onRequested: (s: RemoteSessionVM) => void
}) {
  const { policy } = remote
  const durations = DURATIONS.filter((d) => d <= policy.maxDurationMin)
  const defaultDuration = String(durations.includes(60) ? 60 : (durations[0] ?? 30))

  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [ticket, setTicket] = useState("")
  const [duration, setDuration] = useState(defaultDuration)
  const [plc, setPlc] = useState(false)
  const [plcId, setPlcId] = useState(remote.plcTargets[0]?.id ?? "")
  const [port, setPort] = useState("502")
  const [contact, setContact] = useState("")
  const [touched, setTouched] = useState(false)

  const canPlc = policy.allowPlcForward && remote.plcTargets.length > 0
  const contactRequired = policy.requireOnsiteContact
  const showContact = contactRequired || plc

  const errors = {
    reason: reason.trim().length < 10 ? "Descreva o motivo com pelo menos 10 caracteres." : null,
    ticket: !/^#?\d{3,}$/.test(ticket.trim()) ? "Informe o número do chamado (ex.: #1060)." : null,
    contact: contactRequired && contact.trim().length < 3 ? "A política do cliente exige um contato na planta durante a sessão." : null,
    plc: plc && !plcId ? "Escolha o CLP." : null,
  }
  const invalid = Object.values(errors).some(Boolean)

  const reset = () => {
    setReason("")
    setTicket("")
    setDuration(defaultDuration)
    setPlc(false)
    setPlcId(remote.plcTargets[0]?.id ?? "")
    setPort("502")
    setContact("")
    setTouched(false)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (invalid) return
    const t = ticket.trim().startsWith("#") ? ticket.trim() : `#${ticket.trim()}`
    const target = remote.plcTargets.find((p) => p.id === plcId)
    const approvers = remote.approvers.map((a) => a.name).join(" ou ") || "o admin do cliente"
    onRequested({
      id: `ras_local_${t}_${duration}`,
      requestedBy: remote.me.name,
      reason: reason.trim() + (showContact && contact.trim() ? ` · contato na planta: ${contact.trim()}` : ""),
      ticket: t,
      durationMin: Number(duration),
      status: "requested",
      ssh: true,
      plc: plc && target ? `${target.label.split(" · ")[0]} · ${target.host}:${port}` : null,
      requestedLabel: nowLabel,
      approvedBy: null,
      approvedLabel: null,
      startedLabel: null,
      expiresLabel: null,
      endedLabel: null,
      endedReason: null,
      connection: null,
      bytes: null,
      remainingS: null,
    })
    toast.success("Pedido de acesso enviado", {
      description: `Chamado ${t} · ${minutesLabel(Number(duration))}. Aguardando aprovação de ${approvers} (com MFA).`,
    })
    setOpen(false)
    reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <KeyRoundIcon />
          Solicitar acesso
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>Solicitar acesso remoto</DialogTitle>
            <DialogDescription>
              {gatewayName} · <span className="font-mono">{hostname}</span>. A VPN só liga depois da aprovação do admin do cliente e se desliga sozinha no fim do prazo.
            </DialogDescription>
          </DialogHeader>

          {offline && (
            <Alert>
              <WifiOffIcon />
              <AlertTitle>Gateway offline</AlertTitle>
              <AlertDescription>O pedido pode ser aprovado, mas a VPN só liga quando o gateway voltar a sincronizar.</AlertDescription>
            </Alert>
          )}
          {policy.mode === "preapproved_window" && policy.windows.length > 0 && (
            <Alert>
              <CalendarClockIcon />
              <AlertTitle>Janela pré-aprovada: {policy.windows.join(" · ")}</AlertTitle>
              <AlertDescription>Dentro da janela a sessão inicia sem nova aprovação. Fora dela, o pedido vai para o admin do cliente.</AlertDescription>
            </Alert>
          )}

          <FieldGroup className="gap-5">
            <Field data-invalid={touched && !!errors.reason}>
              <FieldLabel htmlFor="ra-reason">Motivo</FieldLabel>
              <Textarea
                id="ra-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: verificar o barramento RS-485 (CRC intermitente na Prensa 03)"
                rows={3}
                aria-invalid={touched && !!errors.reason}
              />
              {touched && errors.reason ? <FieldError>{errors.reason}</FieldError> : <FieldDescription>Aparece para o cliente na aprovação e na auditoria.</FieldDescription>}
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={touched && !!errors.ticket}>
                <FieldLabel htmlFor="ra-ticket">Chamado</FieldLabel>
                <Input id="ra-ticket" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="#1060" aria-invalid={touched && !!errors.ticket} autoComplete="off" />
                {touched && errors.ticket && <FieldError>{errors.ticket}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="ra-duration">Duração</FieldLabel>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger id="ra-duration" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {durations.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {minutesLabel(d)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Máximo da política: {minutesLabel(policy.maxDurationMin)}.</FieldDescription>
              </Field>
            </div>

            <FieldSet>
              <FieldLegend variant="label">Escopo</FieldLegend>
              <Field orientation="horizontal">
                <Checkbox id="ra-ssh" checked disabled />
                <FieldContent>
                  <FieldLabel htmlFor="ra-ssh" className="font-normal">
                    SSH no gateway
                  </FieldLabel>
                  <FieldDescription>Sempre incluído. Certificado de curta duração, válido só durante a sessão.</FieldDescription>
                </FieldContent>
              </Field>
              <Field orientation="horizontal" data-disabled={!canPlc}>
                <Checkbox id="ra-plc" checked={plc} onCheckedChange={(v) => setPlc(v === true)} disabled={!canPlc} />
                <FieldContent>
                  <FieldLabel htmlFor="ra-plc" className="font-normal">
                    Acesso a um CLP (IP:porta)
                  </FieldLabel>
                  <FieldDescription>
                    {!policy.allowPlcForward
                      ? "Bloqueado pela política do cliente."
                      : remote.plcTargets.length === 0
                        ? "Nenhum CLP Modbus TCP cadastrado neste gateway (escravos RS-485 não têm IP)."
                        : "Encaminhamento de um único IP:porta, com aprovação própria."}
                  </FieldDescription>
                </FieldContent>
              </Field>
            </FieldSet>

            {plc && (
              <div className="grid gap-4 rounded-xl border bg-muted/30 p-4">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <Field data-invalid={touched && !!errors.plc}>
                    <FieldLabel htmlFor="ra-plc-target">CLP</FieldLabel>
                    <Select value={plcId} onValueChange={setPlcId}>
                      <SelectTrigger id="ra-plc-target" className="w-full bg-background">
                        <SelectValue placeholder="Escolha o CLP" />
                      </SelectTrigger>
                      <SelectContent>
                        {remote.plcTargets.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ra-plc-port">Porta</FieldLabel>
                    <Select value={port} onValueChange={setPort}>
                      <SelectTrigger id="ra-plc-port" className="w-full bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {remote.ports.map((p) => (
                          <SelectItem key={p.port} value={String(p.port)}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Alert className="border-state-stopped/40 bg-state-stopped/10">
                  <TriangleAlertIcon className="text-amber-700 dark:text-state-stopped" />
                  <AlertTitle>Acesso à rede industrial</AlertTitle>
                  <AlertDescription>
                    Só este IP:porta fica acessível, por no máximo 30 min e com aprovação própria do cliente. O gateway continua sem rotear a rede OT. Combine com a
                    equipe da planta antes de conectar o software do CLP ou alterar o programa.
                  </AlertDescription>
                </Alert>
              </div>
            )}

            {showContact && (
              <Field data-invalid={touched && !!errors.contact}>
                <FieldLabel htmlFor="ra-contact">Contato na planta{contactRequired ? "" : " (opcional)"}</FieldLabel>
                <Input
                  id="ra-contact"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Nome e telefone de quem acompanha no local"
                  aria-invalid={touched && !!errors.contact}
                />
                {touched && errors.contact && <FieldError>{errors.contact}</FieldError>}
              </Field>
            )}
          </FieldGroup>

          <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            <ShieldAlertIcon className="mt-px size-4 shrink-0" />
            Quem pede nunca aprova. Pedido, aprovação, conexões e encerramento ficam na auditoria visível ao cliente. O kill switch local do gateway prevalece sobre a
            plataforma.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit">Enviar pedido</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
