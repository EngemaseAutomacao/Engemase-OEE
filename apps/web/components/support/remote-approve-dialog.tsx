"use client"

import { useState } from "react"
import { ArrowLeftIcon, CheckIcon, KeyRoundIcon, MinusCircleIcon, ShieldCheckIcon, SmartphoneIcon, TerminalIcon, UserRoundIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { MfaCodeInput } from "./mfa-code-input"
import { DURATION_STEPS, minutesLabel } from "./remote-labels"
import { useRemote } from "./remote-provider"
import type { RemoteSessionVM } from "./remote-types"

export type ApproveMode = "approve" | "modify"

function ScopeRow({ icon: Icon, label, detail, removed }: { icon: typeof TerminalIcon; label: string; detail?: string; removed?: boolean }) {
  return (
    <li className={cn("flex items-start gap-2.5", removed && "text-muted-foreground")}>
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          removed ? "bg-muted text-muted-foreground" : "bg-state-running/12 text-state-running",
        )}
      >
        {removed ? <MinusCircleIcon className="size-3.5" /> : <CheckIcon className="size-3.5" />}
      </span>
      <span className="min-w-0 text-sm leading-snug">
        <span className={cn("font-medium", removed && "line-through")}>
          <Icon className="mr-1 inline size-3.5 -translate-y-px" aria-hidden />
          {label}
        </span>
        {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
      </span>
    </li>
  )
}

function ApproveForm({ session, mode, onClose }: { session: RemoteSessionVM; mode: ApproveMode; onClose: () => void }) {
  const { policy, contacts, approve } = useRemote()
  const maxAllowed = Math.min(session.requestedDurationMin, policy.maxDurationMin)
  const options = [...new Set([...DURATION_STEPS.filter((d) => d <= maxAllowed), maxAllowed])].sort((a, b) => a - b)
  const plcAllowed = policy.allowPlcForward

  const [step, setStep] = useState<"edit" | "confirm">(mode === "modify" ? "edit" : "confirm")
  const [duration, setDuration] = useState(maxAllowed)
  const [keepPlc, setKeepPlc] = useState(Boolean(session.plc) && plcAllowed)
  const [contactId, setContactId] = useState<string | null>(policy.onsiteContactId)
  const [note, setNote] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const contact = contacts.find((c) => c.id === contactId)
  const needsContact = policy.requireOnsiteContact
  const contactMissing = needsContact && !contact
  const codeOk = /^\d{6}$/.test(code)

  const changes = [
    ...(duration < session.requestedDurationMin ? [`Duração reduzida de ${minutesLabel(session.requestedDurationMin)} para ${minutesLabel(duration)}`] : []),
    ...(session.plc && !keepPlc ? [`Acesso ao ${session.plc.deviceName} (${session.plc.target}) removido`] : []),
    ...(note.trim() ? [`Observação ao técnico: ${note.trim()}`] : []),
  ]
  const policyNotes = [
    ...(session.requestedDurationMin > policy.maxDurationMin
      ? [`Duração limitada a ${minutesLabel(policy.maxDurationMin)} pela sua política (pedido: ${minutesLabel(session.requestedDurationMin)}).`]
      : []),
    ...(session.plc && !plcAllowed ? ["Acesso ao CLP removido: sua política não permite encaminhamento para CLP."] : []),
  ]

  function confirm() {
    if (!codeOk || contactMissing) return
    setVerifying(true)
    setError(null)
    window.setTimeout(() => {
      setVerifying(false)
      if (code === "000000") {
        setError("Código inválido ou expirado. Confira o horário do celular e tente de novo.")
        setCode("")
        return
      }
      approve(session.id, { durationMin: duration, keepPlc, onsiteContactId: contactId, note: note.trim(), changes })
      onClose()
    }, 900)
  }

  const contactField = needsContact && (
    <div className="grid gap-1.5">
      <Label htmlFor="ra-contact">Contato na planta durante a sessão</Label>
      <Select value={contactId ?? undefined} onValueChange={setContactId}>
        <SelectTrigger id="ra-contact" className="w-full" aria-invalid={contactMissing}>
          <SelectValue placeholder="Quem acompanha no local" />
        </SelectTrigger>
        <SelectContent>
          {contacts.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name} <span className="text-xs text-muted-foreground">· {c.role}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Sua política exige alguém da fábrica disponível enquanto a Engemase estiver conectada.</p>
    </div>
  )

  if (step === "edit") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Aprovar com alterações</DialogTitle>
          <DialogDescription>
            Reduza o prazo ou o escopo antes de aprovar. {session.requestedBy} recebe a aprovação já com as alterações.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ra-duration">Duração da sessão</Label>
            <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
              <SelectTrigger id="ra-duration" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {minutesLabel(d)}
                    {d === session.requestedDurationMin && <span className="text-xs text-muted-foreground"> · pedido</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Pedido: {minutesLabel(session.requestedDurationMin)} · máximo da sua política: {minutesLabel(policy.maxDurationMin)}. A sessão também cai após{" "}
              {policy.idleTimeoutMin} min sem uso.
            </p>
          </div>

          <div className="grid gap-2">
            <span className="text-sm font-medium">Escopo</span>
            <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3">
              <Checkbox checked disabled className="mt-0.5" aria-label="SSH no gateway" />
              <span className="grid gap-0.5 text-sm">
                <span className="font-medium">SSH no gateway {session.gatewayName}</span>
                <span className="text-xs text-muted-foreground">Sempre incluído: é o motivo da sessão. Certificado válido só durante o prazo.</span>
              </span>
            </div>
            {session.plc ? (
              <label className={cn("flex items-start gap-3 rounded-xl border p-3", !plcAllowed && "opacity-60")}>
                <Checkbox checked={keepPlc} disabled={!plcAllowed} onCheckedChange={(v) => setKeepPlc(v === true)} className="mt-0.5" />
                <span className="grid gap-0.5 text-sm">
                  <span className="font-medium">
                    Acesso ao {session.plc.deviceName} · <span className="font-mono text-xs">{session.plc.target}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {plcAllowed
                      ? "Encaminhamento de um único IP:porta. Desmarque para remover o CLP e liberar só o gateway."
                      : "Bloqueado pela sua política de acesso remoto."}
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-muted-foreground">O pedido não inclui acesso a CLP: o gateway não roteia para a rede das máquinas.</p>
            )}
          </div>

          {contactField}

          <div className="grid gap-1.5">
            <Label htmlFor="ra-note">Observação para o técnico (opcional)</Label>
            <Textarea
              id="ra-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={240}
              placeholder="Ex.: não reiniciar o gateway antes das 14h; ligar para o Pedro ao terminar."
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => setStep("confirm")} disabled={contactMissing}>
            Continuar
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-5 text-primary" />
          Confirmar aprovação
        </DialogTitle>
        <DialogDescription>
          {session.requestedBy} terá acesso ao {session.gatewayName} por {minutesLabel(duration)} a partir da conexão. Você pode encerrar a qualquer momento.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-3 rounded-xl border p-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">
              {session.gatewayName} <span className="font-mono text-xs font-normal text-muted-foreground">{session.hostname}</span>
            </span>
            <span className="text-xs text-muted-foreground">Chamado {session.ticket}</span>
          </div>
          <ul className="grid gap-2">
            <ScopeRow icon={TerminalIcon} label={`SSH no gateway · ${minutesLabel(duration)}`} detail={duration < session.requestedDurationMin ? `Pedido: ${minutesLabel(session.requestedDurationMin)}` : undefined} />
            {session.plc && (
              <ScopeRow
                icon={KeyRoundIcon}
                label={`${session.plc.deviceName} · ${session.plc.target}`}
                detail={keepPlc ? "Encaminhamento de um único IP:porta" : "Removido desta aprovação"}
                removed={!keepPlc}
              />
            )}
            {needsContact && contact && <ScopeRow icon={UserRoundIcon} label={`Contato na planta: ${contact.name}`} detail={contact.role} />}
          </ul>
          {(policyNotes.length > 0 || (mode === "modify" && changes.length > 0)) && (
            <ul className="grid gap-1 border-t pt-2.5 text-xs text-muted-foreground">
              {policyNotes.map((n) => (
                <li key={n}>• {n}</li>
              ))}
              {mode === "modify" && changes.map((c) => <li key={c}>• {c}</li>)}
            </ul>
          )}
        </div>

        {mode === "approve" && contactField}

        <div className="grid gap-3 rounded-xl bg-muted/50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <SmartphoneIcon className="size-4 text-primary" />
            Código do seu aplicativo autenticador
          </div>
          <MfaCodeInput value={code} onChange={(v) => { setCode(v); setError(null) }} invalid={Boolean(error)} disabled={verifying} />
          {error ? (
            <p className="text-center text-xs font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : (
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              A aprovação é assinada e enviada ao gateway; sem ela, a VPN não liga.
              <br />
              Protótipo: qualquer código de 6 dígitos é aceito (000000 simula erro).
            </p>
          )}
        </div>
      </div>

      <DialogFooter className="gap-2 sm:gap-2">
        {mode === "modify" ? (
          <Button variant="outline" onClick={() => setStep("edit")} disabled={verifying}>
            <ArrowLeftIcon />
            Voltar
          </Button>
        ) : (
          <Button variant="outline" onClick={onClose} disabled={verifying}>
            Cancelar
          </Button>
        )}
        <Button onClick={confirm} disabled={!codeOk || contactMissing || verifying}>
          {verifying ? <Spinner /> : <ShieldCheckIcon />}
          {verifying ? "Verificando…" : "Confirmar e aprovar"}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Diálogo de aprovação (com MFA). Em "modify", primeiro permite reduzir duração e remover o CLP. */
export function ApproveDialog({
  session,
  mode,
  open,
  onOpenChange,
}: {
  session: RemoteSessionVM | null
  mode: ApproveMode
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {session && <ApproveForm key={`${session.id}-${mode}`} session={session} mode={mode} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}
