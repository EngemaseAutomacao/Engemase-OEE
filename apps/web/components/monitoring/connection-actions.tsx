"use client"

import { PlayIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { SoftIconButton } from "@/components/refresh/soft-action"

type Quality = "good" | "bad" | "stale"

interface ReadContext {
  /** Gateway sem conexão: o comando fica na fila e expira em 2 min (docs/04). */
  gatewayOffline: boolean
  deviceError?: string
  latencyMs: number | null
}

function notifyRead(tagName: string, value: string, quality: Quality, ctx: ReadContext) {
  if (ctx.gatewayOffline || quality === "stale") {
    toast.warning("Gateway sem conexão", {
      description: `A leitura de "${tagName}" ficou na fila. Se o gateway não sincronizar em 2 min, ela expira e não é executada.`,
    })
    return
  }
  if (quality === "bad") {
    toast.error(`Falha ao ler "${tagName}"`, { description: ctx.deviceError ?? "O CLP não respondeu à requisição Modbus." })
    return
  }
  toast.success(`Leitura de teste: ${value}`, {
    description: `${tagName}${ctx.latencyMs !== null ? ` · resposta em ${ctx.latencyMs} ms` : ""}`,
  })
}

/** Botão "testar leitura" de uma tag (simulado: só mostra um toast). */
export function TagReadButton({ tagName, value, quality, ...ctx }: { tagName: string; value: string; quality: Quality } & ReadContext) {
  return (
    <SoftIconButton label={`Testar leitura de ${tagName}`} tone="teal" onClick={() => notifyRead(tagName, value, quality, ctx)}>
      <PlayIcon />
    </SoftIconButton>
  )
}

/** Testa todas as tags da máquina de uma vez (simulado). */
export function ReadAllTagsButton({
  total,
  good,
  ...ctx
}: {
  total: number
  good: number
} & ReadContext) {
  const run = () => {
    if (ctx.gatewayOffline) {
      toast.warning("Gateway sem conexão", { description: `Leitura de ${total} tags na fila. Expira em 2 min se o gateway não sincronizar.` })
      return
    }
    const id = toast.loading(`Lendo ${total} tags no CLP…`)
    window.setTimeout(() => {
      if (good === total) {
        toast.success(`${total} de ${total} tags lidas com sucesso`, {
          id,
          description: ctx.latencyMs !== null ? `Tempo médio de resposta: ${ctx.latencyMs} ms` : undefined,
        })
      } else {
        toast.error(`${good} de ${total} tags lidas`, { id, description: ctx.deviceError ?? "Algumas tags não responderam." })
      }
    }, 900)
  }
  return (
    <Button variant="outline" size="sm" onClick={run} disabled={total === 0}>
      <RefreshCwIcon />
      Testar leitura
    </Button>
  )
}
