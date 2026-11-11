"use client"

import { useState } from "react"
import { CheckIcon, MailIcon } from "lucide-react"
import { toast } from "sonner"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { squareClass } from "./bits"

/** Reenvia o e-mail "Definir senha" para quem ainda não entrou (protótipo: só toast). */
export function ResendEmailButton({ name, email }: { name: string; email: string }) {
  const [sent, setSent] = useState(false)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Reenviar e-mail “Definir senha” para ${name}`}
          className={squareClass(sent ? "teal" : "blue")}
          onClick={() => {
            setSent(true)
            toast.success("E-mail reenviado", { description: `Novo link “Definir senha” enviado para ${email}. O link anterior deixa de valer.` })
          }}
        >
          {sent ? <CheckIcon aria-hidden /> : <MailIcon aria-hidden />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{sent ? "Reenviado agora" : "Reenviar e-mail “Definir senha”"}</TooltipContent>
    </Tooltip>
  )
}
