"use client"

/** "Pedir acesso remoto" (equipe Engemase, sistema real): gateway, motivo, chamado e duração. Vai para aprovação. */
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { KeyRoundIcon } from "lucide-react"
import { toast } from "sonner"

import { pedirAcessoAction } from "@/app/(shell)/[cliente]/config/actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

const DURACOES = [30, 60, 120, 240, 480]

export function RemoteRequestButton({ clientSlug, gateways, maxDurationMin }: { clientSlug: string; gateways: { id: string; name: string }[]; maxDurationMin: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [gatewayId, setGatewayId] = useState(gateways[0]?.id ?? "")
  const [reason, setReason] = useState("")
  const [ticket, setTicket] = useState("")
  const [duration, setDuration] = useState(String(Math.min(60, maxDurationMin)))
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const options = DURACOES.filter((d) => d <= maxDurationMin)

  const submit = () =>
    start(async () => {
      try {
        const r = await pedirAcessoAction({ slug: clientSlug, gatewayId, reason, ticket, durationMin: Number(duration) })
        if (!r.ok) return setError(r.mensagem)
        setOpen(false)
        setReason("")
        setTicket("")
        toast.success("Pedido enviado para aprovação", { description: "O admin do cliente aprova ou recusa. Sem decisão em 24 h, o pedido expira." })
        router.refresh()
      } catch {
        setError("Não foi possível enviar agora. Tente de novo.")
      }
    })

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={gateways.length === 0} className="w-full md:w-auto">
        <KeyRoundIcon />
        Pedir acesso
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Pedir acesso remoto</DialogTitle>
            <DialogDescription>O admin do cliente precisa aprovar. Você nunca aprova o próprio pedido.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setError(null)
              submit()
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="ra-gw">Gateway</Label>
              <Select value={gatewayId} onValueChange={setGatewayId}>
                <SelectTrigger id="ra-gw" className="w-full">
                  <SelectValue placeholder="Escolha o gateway" />
                </SelectTrigger>
                <SelectContent>
                  {gateways.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ra-reason">Motivo</Label>
              <Textarea id="ra-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="O que vai ser feito e por quê" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ra-ticket">Chamado</Label>
                <Input id="ra-ticket" value={ticket} onChange={(e) => setTicket(e.target.value)} maxLength={40} placeholder="#1042" autoComplete="off" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ra-dur">Duração</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger id="ra-dur" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d < 60 ? `${d} min` : `${d / 60} h`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy || !gatewayId}>
                {busy ? "Enviando…" : "Enviar pedido"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
