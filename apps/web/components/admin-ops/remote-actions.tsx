"use client"

import { useState } from "react"
import { toast } from "sonner"
import { InfoIcon, KeyRoundIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"

import { dateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { MODE_LABEL, PLC_PORTS } from "./labels"
import { useRemote } from "./remote-context"

const DURATIONS = [30, 60, 120, 240]
const durationLabel = (m: number) => (m >= 60 ? `${m / 60} h` : `${m} min`)

/** Botão + diálogo "Solicitar acesso" (cliente → gateway, motivo, chamado, duração e escopo). */
export function RequestAccessButton() {
  const { targets, sessions, me, killSwitch, read, request } = useRemote()
  const [open, setOpen] = useState(false)
  const [clientId, setClientId] = useState("")
  const [gatewayId, setGatewayId] = useState("")
  const [reason, setReason] = useState("")
  const [ticket, setTicket] = useState("")
  const [minutes, setMinutes] = useState("60")
  const [plc, setPlc] = useState(false)
  const [deviceId, setDeviceId] = useState("")
  const [port, setPort] = useState("502")
  const [contact, setContact] = useState("")
  const [tried, setTried] = useState(false)

  const target = targets.find((t) => t.id === clientId)
  const policy = target?.policy ?? null
  const gateway = target?.gateways.find((g) => g.id === gatewayId)
  const maxMin = policy?.maxDurationMin ?? 240
  const tcpDevices = gateway?.devices.filter((d) => d.protocol === "modbus-tcp" && d.host) ?? []
  const device = tcpDevices.find((d) => d.id === deviceId)
  const contactRequired = !!policy?.requireOnsiteContact || plc
  const blocked = (t: (typeof targets)[number]) => t.status === "suspended" || t.policy?.mode === "disabled"
  const duplicate = sessions.some((s) => s.gatewayId === gatewayId && s.requestedBy === me.name && (s.status === "requested" || s.status === "active" || s.status === "approved"))

  const errors = {
    client: !clientId ? "Escolha o cliente." : null,
    gateway: !gatewayId ? "Escolha o gateway." : duplicate ? "Você já tem um pedido ou sessão aberta neste gateway." : null,
    reason: reason.trim().length < 10 ? "Descreva o motivo (mín. 10 caracteres): o cliente decide com base nele." : null,
    ticket: !/^#?\d{3,}$/.test(ticket.trim()) ? "Informe o número do chamado (ex.: #1060)." : null,
    plc: plc && (!device || !port) ? "Escolha o CLP e a porta." : null,
    contact: contactRequired && contact.trim().length < 3 ? "Informe quem acompanha na planta." : null,
  }
  const invalid = Object.values(errors).some(Boolean)

  const reset = () => {
    setClientId("")
    setGatewayId("")
    setReason("")
    setTicket("")
    setMinutes("60")
    setPlc(false)
    setDeviceId("")
    setPort("502")
    setContact("")
    setTried(false)
  }

  const chooseClient = (id: string) => {
    setClientId(id)
    const t = targets.find((x) => x.id === id)
    const usable = t?.gateways.filter((g) => g.status !== "pending") ?? []
    setGatewayId(usable.length === 1 ? usable[0]!.id : "")
    const max = t?.policy?.maxDurationMin ?? 240
    setMinutes(String(Math.min(60, max)))
    setPlc(false)
    setDeviceId("")
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (invalid || !target || !gateway) return
    const at = new Date(read()).toISOString()
    const t = ticket.trim().startsWith("#") ? ticket.trim() : `#${ticket.trim()}`
    request({
      id: `ras_new_${read()}`,
      clientId: target.id,
      clientName: target.name,
      gatewayId: gateway.id,
      gatewayName: gateway.name,
      hostname: gateway.hostname,
      unitName: gateway.unitName,
      gatewayStatus: gateway.status,
      requestedBy: me.name,
      requestedByRole: me.role,
      reason: reason.trim(),
      ticket: t,
      durationMin: Number(minutes),
      ssh: true,
      plc: plc && device ? { deviceName: device.name, target: `${device.host}:${port}` } : null,
      onsiteContact: contact.trim() || null,
      status: "requested",
      requestedAt: at,
      requestedLabel: dateTime(at),
      approvedBy: null,
      approvedLabel: null,
      startedAt: null,
      expiresAt: null,
      endedAt: null,
      endedLabel: null,
      endedReason: null,
      realDuration: null,
      connection: null,
      bytes: null,
      approvers: policy?.approvers ?? [],
    })
    toast.success("Pedido enviado para aprovação", {
      description: `${policy?.approvers.join(" ou ") || "O admin do cliente"} recebeu o aviso no app, por push e por e-mail. ${t} · ${gateway.name} · ${durationLabel(Number(minutes))}.`,
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
        disabled={killSwitch !== null}
        title={killSwitch ? "Bloqueado pelo kill switch global" : undefined}
      >
        <KeyRoundIcon />
        Solicitar acesso
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Solicitar acesso remoto</DialogTitle>
            <DialogDescription>A VPN só abre depois da aprovação do admin do cliente e expira sozinha no prazo. Tudo fica na auditoria do cliente.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ra-client">Cliente</Label>
                <Select value={clientId} onValueChange={chooseClient}>
                  <SelectTrigger id="ra-client" className="w-full" aria-invalid={tried && !!errors.client}>
                    <SelectValue placeholder="Selecione o cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((t) => (
                      <SelectItem key={t.id} value={t.id} disabled={blocked(t)}>
                        {t.name}
                        {t.status === "suspended" ? " · suspenso" : t.policy?.mode === "disabled" ? " · acesso remoto desativado" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tried && errors.client && <p className="text-xs text-destructive">{errors.client}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ra-gateway">Gateway</Label>
                <Select
                  value={gatewayId}
                  onValueChange={(v) => {
                    setGatewayId(v)
                    setDeviceId("")
                  }}
                  disabled={!target}
                >
                  <SelectTrigger id="ra-gateway" className="w-full" aria-invalid={tried && !!errors.gateway}>
                    <SelectValue placeholder={target ? "Selecione o gateway" : "Escolha o cliente primeiro"} />
                  </SelectTrigger>
                  <SelectContent>
                    {target?.gateways.map((g) => (
                      <SelectItem key={g.id} value={g.id} disabled={g.status === "pending"}>
                        {g.name}
                        {g.status === "pending" ? " · aguardando ativação" : g.status === "offline" ? " · offline" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tried && errors.gateway ? (
                  <p className="text-xs text-destructive">{errors.gateway}</p>
                ) : (
                  target &&
                  target.gateways.every((g) => g.status === "pending") && <p className="text-xs text-muted-foreground">Nenhum gateway ativado neste cliente ainda.</p>
                )}
              </div>
            </div>

            {policy && (
              <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                <span>
                  Política de {policy.clientName}: <strong className="font-semibold">{MODE_LABEL[policy.mode]}</strong>
                  {policy.approvers.length > 0 ? ` (${policy.approvers.join(", ")})` : ""} · máx. {durationLabel(policy.maxDurationMin)} · inatividade {policy.idleTimeoutMin} min ·
                  CLP {policy.allowPlcForward ? "permitido" : "não permitido"}
                  {policy.windows.length > 0 && ` · janela pré-aprovada: ${policy.windows.join(", ")} (fora dela, o pedido segue para aprovação)`}
                </span>
              </div>
            )}
            {gateway?.status === "offline" && (
              <p className="-mt-2 flex items-start gap-2 rounded-lg bg-state-stopped/15 px-3 py-2 text-xs text-amber-800 dark:text-state-stopped">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Gateway offline: a VPN só abre quando ele voltar a sincronizar. Se o problema for de rede, prefira o checklist de “Gateway offline” com o cliente.
              </p>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="ra-reason">Motivo</Label>
              <Textarea
                id="ra-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Ex.: Ajustar timeout do CLP da Injetora 04 (sem resposta do escravo)"
                aria-invalid={tried && !!errors.reason}
              />
              {tried && errors.reason && <p className="text-xs text-destructive">{errors.reason}</p>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ra-ticket">Chamado</Label>
                <Input id="ra-ticket" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="#1060" inputMode="numeric" aria-invalid={tried && !!errors.ticket} />
                {tried && errors.ticket && <p className="text-xs text-destructive">{errors.ticket}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ra-duration">Duração</Label>
                <Select value={minutes} onValueChange={setMinutes}>
                  <SelectTrigger id="ra-duration" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map((m) => (
                      <SelectItem key={m} value={String(m)} disabled={m > maxMin}>
                        {durationLabel(m)}
                        {m > maxMin ? " · acima do limite do cliente" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <fieldset className="grid gap-2 rounded-xl border p-3">
              <legend className="px-1 text-sm font-medium">Escopo</legend>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked disabled className="mt-0.5" aria-label="SSH ao gateway" />
                <span>
                  SSH ao gateway
                  <span className="block text-xs text-muted-foreground">Sempre incluído · certificado de curta duração, OpenSSH só em 127.0.0.1</span>
                </span>
              </label>
              <label className={cn("flex items-start gap-2 text-sm", policy && !policy.allowPlcForward && "opacity-60")}>
                <Checkbox
                  checked={plc}
                  onCheckedChange={(v) => setPlc(v === true)}
                  disabled={!gateway || (policy !== null && !policy.allowPlcForward) || tcpDevices.length === 0}
                  className="mt-0.5"
                  aria-label="Encaminhar porta de um CLP"
                />
                <span>
                  Encaminhar a porta de um CLP
                  <span className="block text-xs text-muted-foreground">
                    {policy && !policy.allowPlcForward
                      ? "A política deste cliente não permite acesso a CLP."
                      : gateway && tcpDevices.length === 0
                        ? "Este gateway não tem CLP em Modbus TCP (RS-485 não tem IP para encaminhar)."
                        : "Um único IP:porta de dispositivo cadastrado. O gateway não roteia para a rede OT."}
                  </span>
                </span>
              </label>
              {plc && (
                <div className="grid gap-3 pl-6 sm:grid-cols-[1fr_auto]">
                  <Select value={deviceId} onValueChange={setDeviceId}>
                    <SelectTrigger className="w-full" aria-label="CLP" aria-invalid={tried && !!errors.plc}>
                      <SelectValue placeholder="Escolha o CLP" />
                    </SelectTrigger>
                    <SelectContent>
                      {tcpDevices.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name} · {d.host}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={port} onValueChange={setPort}>
                    <SelectTrigger className="w-full sm:w-48" aria-label="Porta">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLC_PORTS.map((p) => (
                        <SelectItem key={p.port} value={String(p.port)}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {tried && errors.plc && <p className="text-xs text-destructive sm:col-span-2">{errors.plc}</p>}
                </div>
              )}
            </fieldset>

            <div className="grid gap-1.5">
              <Label htmlFor="ra-contact">Contato na planta {contactRequired ? "" : "(opcional)"}</Label>
              <Input id="ra-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Ex.: Pedro Alves · ramal 2214" aria-invalid={tried && !!errors.contact} />
              {tried && errors.contact ? (
                <p className="text-xs text-destructive">{errors.contact}</p>
              ) : (
                contactRequired && <p className="text-xs text-muted-foreground">{plc ? "Obrigatório para acesso a CLP." : "Exigido pela política do cliente."}</p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit">Enviar pedido</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** "Kill switch global": derruba todas as sessões e bloqueia novos pedidos em todos os clientes. */
export function KillSwitchButton() {
  const { sessions, killSwitch, activateKill } = useRemote()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [rejectPending, setRejectPending] = useState(true)
  const [tried, setTried] = useState(false)
  const active = sessions.filter((s) => s.status === "active" || s.status === "approved").length
  const pending = sessions.filter((s) => s.status === "requested").length
  const invalid = reason.trim().length < 10

  const confirm = (e: React.MouseEvent) => {
    if (invalid) {
      e.preventDefault()
      setTried(true)
      return
    }
    const r = activateKill(reason.trim(), rejectPending)
    toast.error("Kill switch global ativado", {
      description: `${r.revoked} sessão(ões) revogada(s)${rejectPending ? ` e ${r.rejected} pedido(s) recusado(s)` : ""}. Os gateways recebem vpn.disable no próximo /sync; a coleta de OEE segue normal.`,
    })
  }

  return (
    <>
      <Button
        variant="outline"
        className="border-state-fault/40 text-state-fault hover:bg-state-fault/10 hover:text-state-fault"
        disabled={killSwitch !== null}
        onClick={() => {
          setReason("")
          setRejectPending(true)
          setTried(false)
          setOpen(true)
        }}
      >
        <OctagonXIcon />
        {killSwitch ? "Kill switch ativo" : "Kill switch global"}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-state-fault/10 text-state-fault">
              <OctagonXIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>Ativar o kill switch global?</AlertDialogTitle>
            <AlertDialogDescription>
              Encerra agora {active === 1 ? "a sessão ativa" : `as ${active} sessões ativas`} de todos os clientes e bloqueia novos pedidos até ser desligado. Use em incidente de
              segurança (ex.: suspeita de credencial vazada). A coleta de OEE não é afetada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ks-reason">Motivo (vai para a auditoria de todos os clientes afetados)</Label>
              <Textarea
                id="ks-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Ex.: Suspeita de chave de VPN exposta; revogação preventiva"
                aria-invalid={tried && invalid}
              />
              {tried && invalid && <p className="text-xs text-destructive">Descreva o motivo (mín. 10 caracteres).</p>}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={rejectPending} onCheckedChange={(v) => setRejectPending(v === true)} />
              Recusar também {pending === 1 ? "o pedido pendente" : `os ${pending} pedidos pendentes`}
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirm}>
              Ativar kill switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
