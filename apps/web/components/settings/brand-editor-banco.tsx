"use client"

/** Editor de Aparência no sistema real: grava pelas Server Actions e recarrega a página (o menu ganha as cores). */
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { restaurarAparenciaAction, salvarAparenciaAction } from "@/app/(shell)/[cliente]/config/actions"
import { BrandEditor, type BrandRemote } from "@/components/settings/brand-editor"
import type { BrandingInitial, PreviewMachine } from "@/components/settings/types"

export function BrandEditorBanco(props: { clientSlug: string; clientName: string; initial: BrandingInitial; presets: { name: string; hex: string }[]; machine: PreviewMachine }) {
  const router = useRouter()
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
  const remote: BrandRemote = {
    save: (v) => run(() => salvarAparenciaAction({ slug: props.clientSlug, ...v })),
    restore: () => run(() => restaurarAparenciaAction({ slug: props.clientSlug })),
  }
  return <BrandEditor clientName={props.clientName} initial={props.initial} presets={props.presets} machine={props.machine} remote={remote} />
}
