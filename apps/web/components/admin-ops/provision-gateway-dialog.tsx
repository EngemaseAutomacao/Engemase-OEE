"use client"

import { useState } from "react"
import { toast } from "sonner"
import { CopyIcon, PlusIcon, RouterIcon, TerminalIcon } from "lucide-react"

import { IconCircle } from "@/components/dashboard/icon-circle"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFleet } from "./fleet-context"

const HARDWARE = [
  "Gateway industrial ARM64 · 4 GB · 2× Ethernet · 2× RS-485",
  "Gateway industrial ARM64 · 2 GB · 2× Ethernet · 1× RS-485",
  "Mini PC x86-64 · 8 GB · 2× Ethernet · conversor USB/RS-485",
]
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function newCode(): string {
  const pick = () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return `${Array.from({ length: 4 }, pick).join("")}-${Array.from({ length: 4 }, pick).join("")}`
}

/** Botão + diálogo "Provisionar gateway": gera o código de ativação (expira em 24 h). */
export function ProvisionGatewayButton() {
  const { clients, addGateway } = useFleet()
  const [open, setOpen] = useState(false)
  const [clientId, setClientId] = useState("")
  const [unitId, setUnitId] = useState("")
  const [name, setName] = useState("")
  const [hardware, setHardware] = useState(HARDWARE[0]!)
  const [tried, setTried] = useState(false)
  const [done, setDone] = useState<{ code: string; name: string } | null>(null)

  const client = clients.find((c) => c.id === clientId)
  const units = client?.units ?? []
  const errors = { client: !clientId, unit: !unitId, name: name.trim().length < 3 }
  const invalid = errors.client || errors.unit || errors.name

  const reset = () => {
    setClientId("")
    setUnitId("")
    setName("")
    setHardware(HARDWARE[0]!)
    setTried(false)
    setDone(null)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (invalid || !client) return
    const code = newCode()
    const unit = units.find((u) => u.id === unitId)
    const id = `gw_new_${code.replace("-", "").toLowerCase()}`
    addGateway({
      id,
      name: name.trim(),
      hostname: "—",
      hardware,
      clientId: client.id,
      clientName: client.name,
      clientSlug: "",
      clientStatus: client.status,
      unitId,
      unitName: unit?.name ?? "—",
      status: "pending",
      lastSeen: null,
      lastSeenAgo: "nunca",
      lastSeenAt: "—",
      agentVersion: null,
      versionState: "none",
      channel: "stable",
      configVersion: 1,
      configApplied: null,
      configState: "none",
      bufferPending: 0,
      bufferState: "ok",
      clockOffsetMs: null,
      clockState: "none",
      machines: 0,
      devices: 0,
      ipIt: null,
      ipOt: null,
      uptime: null,
      enrollmentCode: code,
      href: "/admin/gateways",
      issues: 0,
    })
    setDone({ code, name: name.trim() })
    toast.success("Gateway provisionado", { description: `${name.trim()} · ${client.name} · código ${code} válido por 24 h` })
  }

  const copy = () => {
    if (!done) return
    void navigator.clipboard?.writeText(done.code).catch(() => undefined)
    toast.success("Código copiado")
  }

  return (
    <>
      <Button
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        <PlusIcon />
        Provisionar gateway
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{done ? "Código de ativação gerado" : "Provisionar gateway"}</DialogTitle>
            <DialogDescription>
              {done
                ? "Entregue o código ao técnico em campo. Ele expira em 24 h e só pode ser usado uma vez."
                : "Cadastre o gateway na unidade do cliente. O agente se registra na nuvem com um código de ativação de uso único."}
            </DialogDescription>
          </DialogHeader>

          {done ? (
            <div className="grid gap-4">
              <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-4">
                <IconCircle icon={RouterIcon} tone="teal" soft />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-muted-foreground">{done.name}</div>
                  <div className="font-mono text-2xl font-bold tracking-widest">{done.code}</div>
                </div>
                <Button size="icon" variant="outline" onClick={copy} aria-label="Copiar código">
                  <CopyIcon />
                </Button>
              </div>
              <div className="grid gap-1.5 text-xs">
                <div className="flex items-center gap-1.5 font-semibold">
                  <TerminalIcon className="size-3.5" aria-hidden />
                  No gateway (como root)
                </div>
                <code className="rounded-lg bg-muted px-3 py-2 font-mono text-[12px] break-all">sudo oee-gateway enroll --code {done.code}</code>
                <p className="text-muted-foreground">Requisitos: saída TCP 443 liberada e relógio sincronizado (NTP). O gateway aparece como online na frota após o primeiro /sync.</p>
              </div>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Concluir</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-4" noValidate>
              <div className="grid gap-1.5">
                <Label htmlFor="pg-client">Cliente</Label>
                <Select
                  value={clientId}
                  onValueChange={(v) => {
                    setClientId(v)
                    const c = clients.find((x) => x.id === v)
                    setUnitId(c && c.units.length === 1 ? c.units[0]!.id : "")
                  }}
                >
                  <SelectTrigger id="pg-client" className="w-full" aria-invalid={tried && errors.client}>
                    <SelectValue placeholder="Selecione o cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id} disabled={c.status === "suspended"}>
                        {c.name}
                        {c.status === "suspended" ? " · suspenso" : c.status === "onboarding" ? " · em implantação" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tried && errors.client && <p className="text-xs text-destructive">Escolha o cliente.</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pg-unit">Unidade</Label>
                <Select value={unitId} onValueChange={setUnitId} disabled={!client}>
                  <SelectTrigger id="pg-unit" className="w-full" aria-invalid={tried && errors.unit}>
                    <SelectValue placeholder={client ? "Selecione a unidade" : "Escolha o cliente primeiro"} />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tried && errors.unit && <p className="text-xs text-destructive">Escolha a unidade onde o gateway será instalado.</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pg-name">Nome do gateway</Label>
                <Input id="pg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: GW Joinville Extrusão" aria-invalid={tried && errors.name} />
                {tried && errors.name ? (
                  <p className="text-xs text-destructive">Informe um nome com pelo menos 3 caracteres.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Use a unidade e o setor; o hostname é definido na ativação.</p>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pg-hw">Hardware</Label>
                <Select value={hardware} onValueChange={setHardware}>
                  <SelectTrigger id="pg-hw" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HARDWARE.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit">Gerar código de ativação</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
