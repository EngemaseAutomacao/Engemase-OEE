"use client"

import { useRouter } from "next/navigation"
import { LogInIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

/** Entrar na área do cliente: avisa que a entrada fica registrada e navega para /slug. */
export function useEnterClient() {
  const router = useRouter()
  return (client: { name: string; slug: string }) => {
    toast.info(`Entrando em ${client.name}`, {
      description: "Faixa “Engemase” visível na tela; a entrada fica na auditoria do cliente.",
    })
    router.push(`/${client.slug}`)
  }
}

export function EnterClientButton({ client, size = "default" }: { client: { name: string; slug: string }; size?: "default" | "sm" }) {
  const enter = useEnterClient()
  return (
    <Button size={size} onClick={() => enter(client)}>
      <LogInIcon />
      Entrar como cliente
    </Button>
  )
}
