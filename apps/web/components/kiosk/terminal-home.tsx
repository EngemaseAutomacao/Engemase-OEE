/**
 * Tela do APARELHO pareado (sistema real): o que abre depende do terminal, nunca da URL (docs/15).
 * TV → Andon da (primeira) linha do terminal; tablet com uma máquina → tela do operador; tablet com várias →
 * "Escolha a máquina" (cada máquina em /terminal/maquina/<id>, conferida de novo contra o terminal).
 * Os dados vêm do contexto do aparelho (`getClientDataForContext`), com o escopo do terminal.
 */
import { Suspense } from "react"
import Link from "next/link"
import { ChevronRightIcon, TabletIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { STATE_META } from "@/lib/states"
import { getClientDataForContext } from "@/lib/data/cliente"
import type { TerminalSession } from "@/lib/server/terminal/terminals"
import { AndonBoard, AndonSkeleton } from "@/components/kiosk/andon-board"
import { OperatorScreen, OperatorSkeleton } from "@/components/kiosk/operator-screen"
import { BrandLogo } from "@/components/shell/brand"

export async function TerminalHome({ session, machineId }: { session: TerminalSession; machineId?: string }) {
  const { ctx, terminal } = session
  const params = (maquinaId: string) => Promise.resolve({ cliente: ctx.slug, maquinaId })

  if (terminal.kind === "tv") {
    const linhaId = terminal.lineIds[0]
    if (linhaId === undefined) return <SemConteudo nome={terminal.name} />
    return (
      <Suspense fallback={<AndonSkeleton />}>
        <AndonBoard params={Promise.resolve({ cliente: ctx.slug, linhaId })} terminal={{ name: terminal.name }} ctx={ctx} />
      </Suspense>
    )
  }

  const multiple = terminal.machineIds.length > 1
  const target = machineId ?? (multiple ? undefined : terminal.machineIds[0])
  if (target !== undefined && terminal.machineIds.includes(target)) {
    return (
      <Suspense fallback={<OperatorSkeleton />}>
        <OperatorScreen params={params(target)} terminal={{ name: terminal.name, switchHref: multiple ? "/terminal" : undefined }} ctx={ctx} />
      </Suspense>
    )
  }

  // Tablet com várias máquinas: o operador escolhe em qual vai apontar.
  const data = await getClientDataForContext(ctx)
  const machines = terminal.machineIds.map((id) => data.getMachine(id)).filter((m) => m !== undefined)
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-8">
      <header className="flex items-center gap-3">
        <BrandLogo width={96} />
        <div className="ml-auto flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
          <TabletIcon className="size-4 text-muted-foreground" />
          <span className="font-medium">{terminal.name}</span>
        </div>
      </header>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Escolha a máquina</h1>
        <p className="mt-1 text-muted-foreground">Toque na máquina em que você vai apontar paradas, refugo e troca de produto.</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {machines.map((m) => {
          const live = data.getMachineLive(m.id)
          const state = live?.state ?? "NO_COMM"
          const meta = STATE_META[state]
          return (
            <li key={m.id}>
              <Link
                href={`/terminal/maquina/${m.id}`}
                className={cn(
                  "flex min-h-28 touch-manipulation items-center gap-4 rounded-2xl border-2 bg-card p-5 shadow-xs transition-colors hover:bg-accent active:scale-[0.99]",
                  meta.border,
                )}
              >
                <span className={cn("size-4 shrink-0 rounded-full", meta.dot, state === "NO_COMM" && "bg-stripes")} aria-hidden />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-2xl font-bold">{m.name}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {data.getLine(m.lineId)?.name} · <span className={meta.text}>{meta.label}</span>
                  </span>
                </span>
                <ChevronRightIcon className="size-7 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          )
        })}
      </ul>
    </main>
  )
}

function SemConteudo({ nome }: { nome: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-2xl font-bold">{nome}</h1>
      <p className="text-muted-foreground">Este terminal ainda não tem uma linha para mostrar. Avise a Engemase.</p>
    </main>
  )
}
