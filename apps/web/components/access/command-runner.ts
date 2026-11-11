"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"

import type { CommandVM } from "./gateway-detail-data"
import { COMMAND_TYPE_LABEL, type CommandType } from "./labels"

export interface CommandOutcome {
  ok: boolean
  result: string
  durationMs: number
}

/** Executa um comando simulado; `null` = ficou na fila (gateway offline). */
export type RunCommand = (type: CommandType, target: string, exec: () => CommandOutcome) => Promise<CommandOutcome | null>

/** Atraso simulado até o gateway buscar o comando no /sync e responder. */
const DELAY: Record<CommandType, number> = { "tag.read": 900, "device.test": 1300, "config.reload": 1800, "agent.restart": 2400 }

/**
 * Histórico de comandos do gateway + execução simulada (protótipo).
 * Comandos novos entram no topo da lista com status "Enviado" e terminam como "Concluído"/"Falhou";
 * com o gateway offline ficam "Na fila".
 */
export function useCommandRunner({ initial, offline, me, nowLabel }: { initial: CommandVM[]; offline: boolean; me: string; nowLabel: string }) {
  const [commands, setCommands] = useState(initial)
  const seq = useRef(0)

  const run: RunCommand = (type, target, exec) => {
    seq.current += 1
    const id = `cmd_local_${seq.current}`
    const base: CommandVM = {
      id,
      type,
      target,
      requestedBy: me,
      createdLabel: nowLabel,
      createdAgo: "agora",
      status: offline ? "queued" : "sent",
      result: offline ? "Aguardando o gateway voltar a se conectar" : "Entregue no próximo sincronismo (até 10 s)",
      durationMs: null,
    }
    setCommands((cs) => [base, ...cs])

    if (offline) {
      toast.info(`${COMMAND_TYPE_LABEL[type]} na fila`, {
        description:
          type === "tag.read"
            ? "O gateway está offline. Leituras de tag expiram em 2 min se ele não voltar."
            : "O gateway está offline. O comando será entregue quando ele voltar a sincronizar.",
      })
      return Promise.resolve(null)
    }

    return new Promise((resolve) => {
      window.setTimeout(() => {
        const out = exec()
        setCommands((cs) => cs.map((c) => (c.id === id ? { ...c, status: out.ok ? "done" : "failed", result: out.result, durationMs: out.durationMs } : c)))
        resolve(out)
      }, DELAY[type])
    })
  }

  return { commands, run }
}
