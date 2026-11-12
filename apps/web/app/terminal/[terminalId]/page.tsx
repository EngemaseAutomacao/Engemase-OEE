import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronRightIcon, TabletIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { STATE_META } from "@/lib/states"
import { getClientById, getLine, getMachine, getMachineLive, getTerminal, terminalParams } from "@/lib/mock"
import { AndonBoard, AndonSkeleton } from "@/components/kiosk/andon-board"
import { OperatorScreen, OperatorSkeleton } from "@/components/kiosk/operator-screen"
import { TerminalBranding } from "@/components/kiosk/terminal-branding"
import { BrandLogo } from "@/components/shell/brand"

export function generateStaticParams() {
  return terminalParams()
}

export async function generateMetadata({ params }: PageProps<"/terminal/[terminalId]">): Promise<Metadata> {
  const { terminalId } = await params
  return { title: getTerminal(terminalId)?.name ?? "Terminal" }
}

/**
 * Tela de um terminal pareado. Na versão real o `terminalId` vem do token do aparelho, não da URL;
 * aqui a URL só simula "qual aparelho está aberto".
 */
export default async function Page({ params }: PageProps<"/terminal/[terminalId]">) {
  const { terminalId } = await params
  const terminal = getTerminal(terminalId)
  if (!terminal) notFound()
  const client = getClientById(terminal.clientId)
  if (!client) notFound()

  if (terminal.kind === "andon_tv") {
    const linhaId = terminal.scope.lineIds?.[0]
    if (!linhaId) notFound()
    return (
      <>
        <TerminalBranding clientId={client.id} />
        <Suspense fallback={<AndonSkeleton />}>
          <AndonBoard params={Promise.resolve({ cliente: client.slug, linhaId })} terminal={{ name: terminal.name }} />
        </Suspense>
      </>
    )
  }

  const machineIds = terminal.scope.machineIds ?? []
  if (machineIds.length === 1) {
    return (
      <>
        <TerminalBranding clientId={client.id} />
        <Suspense fallback={<OperatorSkeleton />}>
          <OperatorScreen params={Promise.resolve({ cliente: client.slug, maquinaId: machineIds[0] })} terminal={{ name: terminal.name }} />
        </Suspense>
      </>
    )
  }

  // Tablet com várias máquinas: o operador escolhe em qual vai apontar.
  const machines = machineIds.map((id) => getMachine(id)).filter((m) => m !== undefined)
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-8">
      <TerminalBranding clientId={client.id} />
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
          const live = getMachineLive(m.id)
          const state = live?.state ?? "NO_COMM"
          const meta = STATE_META[state]
          return (
            <li key={m.id}>
              <Link
                href={`/terminal/${terminal.id}/${m.id}`}
                className={cn(
                  "flex min-h-28 touch-manipulation items-center gap-4 rounded-2xl border-2 bg-card p-5 shadow-xs transition-colors hover:bg-accent active:scale-[0.99]",
                  meta.border,
                )}
              >
                <span className={cn("size-4 shrink-0 rounded-full", meta.dot, state === "NO_COMM" && "bg-stripes")} aria-hidden />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-2xl font-bold">{m.name}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {getLine(m.lineId)?.name} · <span className={meta.text}>{meta.label}</span>
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
