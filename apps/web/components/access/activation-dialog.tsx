"use client"

import { KeyRoundIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ActivationSteps, useActivationCode } from "./activation-steps"

/** Instruções de ativação de um gateway já criado (status "aguardando ativação"). */
export function ActivationDialog({
  gatewayName,
  code: initialCode,
  expired = false,
  expiresLabel,
  freshExpiresLabel,
  triggerLabel = "Instruções de ativação",
  triggerVariant = "outline",
}: {
  gatewayName: string
  code: string
  expired?: boolean
  expiresLabel: string
  /** Validade de um código gerado agora. */
  freshExpiresLabel: string
  triggerLabel?: string
  triggerVariant?: "outline" | "default" | "secondary"
}) {
  const act = useActivationCode(gatewayName, { code: initialCode, expired, expiresLabel }, freshExpiresLabel)

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
        <ActivationSteps code={act.code} expired={act.expired} expiresLabel={act.expiresLabel} onRegenerate={act.regenerate} />
      </DialogContent>
    </Dialog>
  )
}
