"use client"

/** Tela de acesso remoto no sistema real: liga o provider às Server Actions e recarrega depois de cada ação. */
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { aprovarAcessoAction, emitirCertificadoSshAction, encerrarAcessoAction, recusarAcessoAction, salvarPoliticaAcessoAction } from "@/app/(shell)/[cliente]/config/actions"
import { RemoteAccessProvider, type RemoteServer } from "@/components/support/remote-provider"
import type { RemoteData } from "@/components/support/remote-types"

export function RemoteAccessBanco({ data, children }: { data: RemoteData; children: React.ReactNode }) {
  const router = useRouter()
  const slug = data.clientSlug
  const run = async (fn: () => Promise<{ ok: true } | { ok: false; mensagem: string }>): Promise<boolean> => {
    try {
      const r = await fn()
      if (!r.ok) {
        toast.error(r.mensagem)
        return false
      }
      router.refresh()
      return true
    } catch {
      toast.error("Não foi possível gravar agora. Tente de novo.")
      return false
    }
  }
  const server: RemoteServer = {
    approve: (id, durationMin, note) => run(() => aprovarAcessoAction({ slug, id, durationMin, note })),
    reject: (id, reason) => run(() => recusarAcessoAction({ slug, id, reason })),
    end: (id) => run(() => encerrarAcessoAction({ slug, id })),
    savePolicy: (p) =>
      run(() => salvarPoliticaAcessoAction({ slug, mode: p.mode === "disabled" ? "disabled" : "approval", maxDurationMin: p.maxDurationMin, idleTimeoutMin: p.idleTimeoutMin })),
    issueSshCert: async (id, publicKey) => {
      try {
        return await emitirCertificadoSshAction({ slug, id, publicKey })
      } catch {
        return { ok: false, mensagem: "Sem conexão com o servidor. Tente de novo." }
      }
    },
  }
  return (
    <RemoteAccessProvider data={data} server={server}>
      {children}
    </RemoteAccessProvider>
  )
}
