"use client"

import { useState } from "react"
import { BanIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useRemote } from "./remote-provider"
import type { RemoteSessionVM } from "./remote-types"

const QUICK_REASONS = [
  "Fora do horário combinado com a TI",
  "Linha em produção crítica agora",
  "Sem contato na planta disponível",
  "Escopo maior que o necessário",
  "Preferimos atendimento presencial",
]

function RejectForm({ session, onClose }: { session: RemoteSessionVM; onClose: () => void }) {
  const { reject } = useRemote()
  const [reason, setReason] = useState("")
  const [tried, setTried] = useState(false)
  const invalid = reason.trim().length < 5

  return (
    <>
      <DialogHeader>
        <DialogTitle>Recusar pedido de acesso remoto</DialogTitle>
        <DialogDescription>
          {session.requestedBy} recebe o motivo e pode pedir de novo com outro horário ou escopo. Nada é aberto no {session.gatewayName}.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition hover:bg-muted",
                reason === r && "border-primary bg-primary/10 text-primary hover:bg-primary/10",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ra-reject">Motivo da recusa</Label>
          <Textarea
            id="ra-reject"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={240}
            placeholder="Ex.: pode ser no sábado entre 8h e 12h, com o Pedro acompanhando."
            aria-invalid={tried && invalid}
          />
          {tried && invalid && <p className="text-xs text-destructive">Informe o motivo (mínimo 5 caracteres).</p>}
        </div>
      </div>
      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            setTried(true)
            if (invalid) return
            reject(session.id, reason.trim())
            onClose()
          }}
        >
          <BanIcon />
          Recusar pedido
        </Button>
      </DialogFooter>
    </>
  )
}

export function RejectDialog({ session, open, onOpenChange }: { session: RemoteSessionVM | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">{session && <RejectForm key={session.id} session={session} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}
