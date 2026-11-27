"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"

import { consultarComandoAction, enviarComandoAction } from "@/app/(shell)/[cliente]/config/actions"
import type { CommandVM } from "./gateway-detail-data"
import type { Resultado } from "@/lib/data/admin/acesso"
import { COMMAND_TYPE_LABEL, type CommandType } from "./labels"

export interface CommandOutcome {
  ok: boolean
  result: string
  durationMs: number
}

/**
 * Executa um comando; `null` = ficou na fila (gateway offline). Sem banco, `exec` simula a resposta;
 * com banco, o comando vai para a fila de verdade (`payload` no formato do contrato) e a tela
 * acompanha até o gateway responder.
 */
export type RunCommand = (type: CommandType, target: string, exec: () => CommandOutcome, payload?: Record<string, unknown>) => Promise<CommandOutcome | null>

/** Atraso simulado até o gateway buscar o comando no /sync e responder. */
const DELAY: Record<CommandType, number> = { "tag.read": 900, "device.test": 1300, "config.reload": 1800, "agent.restart": 2400, "agent.update": 3000 }

/** Envia o comando (com banco) e devolve o id criado. */
export type SendCommand = () => Promise<Resultado<{ commandId: string }>>

/** Com banco: quanto tempo a tela espera a resposta antes de deixar o comando "Enviado" na lista. */
const ESPERA_MS = 45_000
const INTERVALO_MS = 1500

const pausa = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

/**
 * Histórico de comandos do gateway + execução (simulada no protótipo; real com banco).
 * Comandos novos entram no topo da lista com status "Enviado" e terminam como "Concluído"/"Falhou";
 * com o gateway offline ficam "Na fila".
 */
export function useCommandRunner({
  initial,
  offline,
  me,
  nowLabel,
  real,
}: {
  initial: CommandVM[]
  offline: boolean
  me: string
  nowLabel: string
  /** Com banco: cliente e gateway dos comandos. */
  real?: { slug: string; gatewayId: string }
}) {
  const [commands, setCommands] = useState(initial)
  const seq = useRef(0)

  const runReal = async (r: { slug: string; gatewayId: string }, type: CommandType, target: string, payload: Record<string, unknown>, send?: SendCommand) => {
    const sent = send ? await send() : await enviarComandoAction({ slug: r.slug, gatewayId: r.gatewayId, type, payload })
    if (!sent.ok) {
      toast.error(`${COMMAND_TYPE_LABEL[type]}: não enviado`, { description: sent.problemas?.[0]?.mensagem ?? sent.mensagem })
      return null
    }
    const id = sent.dados.commandId
    setCommands((cs) => [
      { id, type, target, requestedBy: me, createdLabel: nowLabel, createdAgo: "agora", status: "queued", result: "Na fila: entregue no próximo sincronismo do gateway", durationMs: null },
      ...cs,
    ])
    if (offline) {
      toast.info(`${COMMAND_TYPE_LABEL[type]} na fila`, { description: "O gateway está offline. O comando é entregue quando ele voltar a sincronizar (ou expira)." })
      return null
    }
    const inicio = Date.now()
    while (Date.now() - inicio < ESPERA_MS) {
      await pausa(INTERVALO_MS)
      const st = await consultarComandoAction({ slug: r.slug, commandId: id })
      if (!st.ok) continue
      const s = st.dados
      setCommands((cs) => cs.map((c) => (c.id === id ? { ...c, status: s.status, result: s.result, durationMs: s.durationMs } : c)))
      if (s.ok !== null) return { ok: s.ok, result: s.result, durationMs: s.durationMs ?? Date.now() - inicio }
    }
    toast.info(`${COMMAND_TYPE_LABEL[type]} ainda sem resposta`, { description: "O resultado aparece no histórico de comandos quando o gateway responder." })
    return null
  }

  const run: RunCommand = (type, target, exec, payload) => {
    if (real) return runReal(real, type, target, payload ?? {})
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

  /** Com banco: comando enviado por outra ação (ex.: agent.update), acompanhado como os demais. */
  const runWith = (type: CommandType, target: string, send: SendCommand) => (real ? runReal(real, type, target, {}, send) : Promise.resolve(null))

  return { commands, run, runWith }
}
