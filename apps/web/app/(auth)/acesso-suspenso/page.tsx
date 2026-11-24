import type { Metadata } from "next"
import Link from "next/link"

import { BrandLogo } from "@/components/shell/brand"

export const metadata: Metadata = { title: "Acesso suspenso" }

/** Cliente suspenso ou encerrado (docs/15, seção 6): mensagem clara, sem dados do cliente. */
export default function Page() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-8">
        <BrandLogo width={112} className="mx-auto mb-6" />
        <h1 className="text-2xl font-bold tracking-tight">Acesso suspenso</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          O acesso da sua empresa à plataforma está suspenso no momento. Os dados das máquinas continuam sendo guardados. Fale com o
          administrador da sua empresa ou com o suporte Engemase.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
          Voltar para o login
        </Link>
      </div>
    </main>
  )
}
