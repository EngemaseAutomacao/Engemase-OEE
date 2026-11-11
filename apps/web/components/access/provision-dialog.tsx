"use client"

import { useState } from "react"
import { ArrowRightIcon, PlusIcon, RouterIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ActivationSteps } from "./activation-steps"
import type { GatewayRow } from "./gateway-view"
import { activationCode } from "./labels"

/** Diálogo "Novo gateway": cadastro + código de ativação e comandos de instalação. */
export function ProvisionGatewayDialog({
  units,
  used,
  limit,
  expiresLabel,
  onCreated,
}: {
  units: { id: string; name: string }[]
  used: number
  limit: number
  expiresLabel: string
  onCreated?: (row: GatewayRow) => void
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<"form" | "activate">("form")
  const [name, setName] = useState("")
  const [unitId, setUnitId] = useState(units.length === 1 ? units[0]!.id : "")
  const [location, setLocation] = useState("")
  const [touched, setTouched] = useState(false)
  const [code, setCode] = useState("")

  const atLimit = used >= limit
  const nameError = name.trim().length < 3 ? "Informe um nome com pelo menos 3 caracteres." : null
  const unitError = !unitId ? "Escolha a unidade onde o gateway será instalado." : null

  const reset = () => {
    setStep("form")
    setName("")
    setUnitId(units.length === 1 ? units[0]!.id : "")
    setLocation("")
    setTouched(false)
    setCode("")
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (nameError || unitError || atLimit) return
    const c = activationCode(`${name.trim()}|${unitId}|${used}`)
    setCode(c)
    setStep("activate")
    const unitName = units.find((u) => u.id === unitId)?.name ?? ""
    onCreated?.({
      id: `gw_novo_${c}`,
      name: name.trim(),
      hostname: "—",
      unitId,
      unitName,
      hardware: location.trim() ? `Local: ${location.trim()}` : "Hardware identificado na ativação",
      status: "pending",
      lastSeenAgo: "nunca conectou",
      lastSeenAt: null,
      agentVersion: null,
      configText: "v1 · não aplicada",
      configTone: "none",
      configVersion: 1,
      configApplied: null,
      bufferPending: 0,
      cpuPct: null,
      memMb: null,
      diskFreePct: null,
      clockText: "—",
      clockAlert: false,
      devices: 0,
      devicesError: 0,
      machines: 0,
      enrollmentCode: c,
      codeExpired: false,
      codeExpiresLabel: expiresLabel,
      issues: [{ kind: "pending", tone: "info", text: "Aguardando a instalação e ativação do agente no local" }],
      local: true,
    })
    toast.success("Gateway criado", { description: `${name.trim()} · código de ativação ${c} (válido até ${expiresLabel})` })
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
        <Button>
          <PlusIcon />
          Novo gateway
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        {step === "form" ? (
          <form onSubmit={submit} className="grid gap-5" noValidate>
            <DialogHeader>
              <DialogTitle>Novo gateway</DialogTitle>
              <DialogDescription>
                Cadastre o gateway e gere o código de ativação. A instalação é feita no local, em um computador industrial com Debian.
              </DialogDescription>
            </DialogHeader>

            {atLimit && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Limite do plano atingido</AlertTitle>
                <AlertDescription>Este cliente já usa {used} de {limit} gateways. Fale com a Engemase para ampliar o plano.</AlertDescription>
              </Alert>
            )}

            <FieldGroup className="gap-5">
              <Field data-invalid={touched && !!nameError}>
                <FieldLabel htmlFor="gw-name">Nome do gateway</FieldLabel>
                <Input
                  id="gw-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: GW Joinville Extrusão"
                  aria-invalid={touched && !!nameError}
                  autoComplete="off"
                />
                {touched && nameError ? <FieldError>{nameError}</FieldError> : <FieldDescription>Use o local ou a linha atendida.</FieldDescription>}
              </Field>
              <Field data-invalid={touched && !!unitError}>
                <FieldLabel htmlFor="gw-unit">Unidade</FieldLabel>
                <Select value={unitId} onValueChange={setUnitId}>
                  <SelectTrigger id="gw-unit" className="w-full" aria-invalid={touched && !!unitError}>
                    <SelectValue placeholder="Selecione a unidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {touched && unitError ? (
                  <FieldError>{unitError}</FieldError>
                ) : (
                  <FieldDescription>O gateway só poderá alimentar máquinas desta unidade.</FieldDescription>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="gw-location">Local de instalação (opcional)</FieldLabel>
                <Input id="gw-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ex.: painel elétrico da linha de sopro" />
              </Field>
            </FieldGroup>

            <div className="flex items-start gap-3 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
              <RouterIcon className="mt-px size-4 shrink-0" />
              <span>
                Recomendado: computador industrial ARM64 ou x86 com 2 interfaces Ethernet (rede de TI e rede OT) e portas RS-485 para Modbus RTU.
                Uso do plano: {used} de {limit} gateways.
              </span>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={atLimit}>
                Gerar código de ativação
                <ArrowRightIcon />
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Ative o {name.trim()}</DialogTitle>
              <DialogDescription>Execute os comandos no terminal do gateway. Deixe esta janela aberta para conferir o status ao final.</DialogDescription>
            </DialogHeader>
            <ActivationSteps code={code} expiresLabel={expiresLabel} />
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Concluir
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
