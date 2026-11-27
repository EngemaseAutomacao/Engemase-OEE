"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import type { Resultado } from "@/lib/data/admin/acesso"
import { useTeam } from "./team-context"

/**
 * Ações da tela da equipe: com banco, grava pela Server Action, avisa o erro e recarrega os dados;
 * sem banco (demonstração), roda só a versão da tela.
 */
export function useTeamAction() {
  const { banco } = useTeam()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  function run<T>(action: () => Promise<Resultado<T>>, onOk: (dados: T) => void, demo: () => void): void {
    if (!banco) return demo()
    startTransition(async () => {
      const r = await action()
      if (!r.ok) {
        toast.error(r.mensagem)
        return
      }
      onOk(r.dados)
      router.refresh()
    })
  }
  return { run, pending, banco: banco === true }
}
