"use client"

import { useState } from "react"
import { KeyRoundIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ActivationSteps } from "./activation-steps"
import { activationCode } from "./labels"

/** Instruções de ativação de um gateway já criado (status "aguardando ativação"). */
export function ActivationDialog({
  gatewayName,
  code: initialCode,
  expiresLabel,
  triggerLabel = "Instruções de ativação",
  triggerVariant = "outline",
}: {
  gatewayName: string
  code: string
  expiresLabel: string
  triggerLabel?: string
  triggerVariant?: "outline" | "default" | "secondary"
}) {
  const [code, setCode] = useState(initialCode)
  const [round, setRound] = useState(0)

  const regenerate = () => {
    const next = activationCode(`${gatewayName}:${code}:${round + 1}`)
    setRound((r) => r + 1)
    setCode(next)
    toast.success("Novo código de ativação gerado", { description: `${next} · o código anterior (${code}) deixou de valer.` })
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          <KeyRoundIcon />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ativar {gatewayName}</DialogTitle>
          <DialogDescription>Execute os comandos no terminal do gateway, na fábrica. O código vale para uma única ativação.</DialogDescription>
        </DialogHeader>
        <ActivationSteps code={code} expiresLabel={expiresLabel} />
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={regenerate}>
            <RefreshCwIcon />
            Gerar novo código
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
