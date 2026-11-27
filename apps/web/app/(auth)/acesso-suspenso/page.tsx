import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeftIcon, PauseIcon } from "lucide-react"

import { AuthHeading, AuthShell, GlassCard } from "@/components/account/auth-card"

export const metadata: Metadata = { title: "Acesso suspenso" }

/** Cliente suspenso ou encerrado (docs/15, seção 6): mensagem clara, sem dados do cliente. */
export default function Page() {
  return (
    <AuthShell>
      <GlassCard>
        <span
          aria-hidden
          className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-[var(--state-stopped)]/15 text-[var(--state-stopped)] ring-1 ring-[var(--state-stopped)]/30"
        >
          <PauseIcon className="size-6" />
        </span>
        <AuthHeading
          eyebrow="Conta Engemase OEE"
          title="Acesso suspenso"
          description="O acesso da sua empresa à plataforma está suspenso no momento. Os dados das máquinas continuam sendo guardados. Fale com o administrador da sua empresa ou com o suporte Engemase."
        />
        <Link
          href="/login"
          className="au-cta inline-flex h-11 w-full items-center justify-center gap-2 rounded-md text-base font-medium"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Voltar para o login
        </Link>
      </GlassCard>
    </AuthShell>
  )
}
