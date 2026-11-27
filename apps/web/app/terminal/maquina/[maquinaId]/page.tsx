import type { Metadata } from "next"
import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"
import { TerminalHome } from "@/components/kiosk/terminal-home"
import { usarBanco } from "@/lib/data/fonte"
import { currentTerminal } from "@/lib/server/terminal/cookie"

export const metadata: Metadata = { title: "Tela do operador" }

/**
 * Tablet pareado com várias máquinas: a máquina escolhida. Só vale máquina do PRÓPRIO terminal (conferida em
 * `TerminalHome`); sem aparelho pareado, volta para /terminal. Só no sistema real.
 */
export default function Page({ params }: PageProps<"/terminal/maquina/[maquinaId]">) {
  if (!usarBanco()) notFound()
  return (
    <Suspense fallback={null}>
      <Maquina params={params} />
    </Suspense>
  )
}

async function Maquina({ params }: { params: PageProps<"/terminal/maquina/[maquinaId]">["params"] }) {
  const { maquinaId } = await params
  const session = await currentTerminal()
  if (session === null) redirect("/terminal")
  if (session.terminal.kind !== "tablet" || !session.terminal.machineIds.includes(maquinaId)) redirect("/terminal")
  return <TerminalHome session={session} machineId={maquinaId} />
}
