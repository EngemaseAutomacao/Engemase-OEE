import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense } from "react"

import { SectionCard } from "@/components/dashboard/section-card"
import { TwoFactorSetup } from "@/components/account/two-factor-setup"
import { ThemeToggle } from "@/components/theme-toggle"
import { Skeleton } from "@/components/ui/skeleton"
import { signOutAction } from "@/app/(auth)/login/actions"
import { getCurrentSession } from "@/lib/server/auth/current"

export const metadata: Metadata = { title: "Segurança da conta" }

/** Lê a sessão (pedido): fica dentro do <Suspense> (Cache Components). */
async function SecurityBody() {
  const session = await getCurrentSession()
  if (session === null) redirect("/login?next=/conta/seguranca")
  return (
    <SectionCard
      title="Verificação em duas etapas"
      description="Obrigatória para administradores do cliente e para a equipe Engemase; recomendada para todos."
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Conta: <span className="font-medium text-foreground">{session.user.email}</span>
      </p>
      <TwoFactorSetup enabled={session.user.twoFactorEnabled} />
    </SectionCard>
  )
}

export default function Page() {
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-20 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4 md:px-6">
          <Link href="/inicio" className="flex min-w-0 items-center gap-2" aria-label="Engemase OEE: início">
            <Image src="/brand/engemase-icone.png" alt="" width={32} height={32} className="size-8 shrink-0" priority />
            <span className="hidden truncate text-sm font-semibold sm:inline">Engemase OEE</span>
          </Link>
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
          <span className="truncate text-sm text-muted-foreground">Segurança da conta</span>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <form action={signOutAction}>
              <button type="submit" className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:underline">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Segurança da conta</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Proteja seu acesso com o código do aplicativo autenticador, além da senha.
          </p>
        </div>
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
          <SecurityBody />
        </Suspense>
      </main>
    </div>
  )
}
