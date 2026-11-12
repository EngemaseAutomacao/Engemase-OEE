import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { getClientById, getMachine, getTerminal, terminalParams } from "@/lib/mock"
import { OperatorScreen, OperatorSkeleton } from "@/components/kiosk/operator-screen"
import { TerminalBranding } from "@/components/kiosk/terminal-branding"

export function generateStaticParams() {
  return terminalParams().flatMap(({ terminalId }) =>
    (getTerminal(terminalId)?.scope.machineIds ?? []).map((maquinaId) => ({ terminalId, maquinaId })),
  )
}

export async function generateMetadata({ params }: PageProps<"/terminal/[terminalId]/[maquinaId]">): Promise<Metadata> {
  const { maquinaId } = await params
  return { title: getMachine(maquinaId)?.name ?? "Tela do operador" }
}

/** Tela do operador aberta por um tablet pareado; só aceita máquinas do escopo do terminal. */
export default async function Page({ params }: PageProps<"/terminal/[terminalId]/[maquinaId]">) {
  const { terminalId, maquinaId } = await params
  const terminal = getTerminal(terminalId)
  if (!terminal || terminal.kind !== "operator_tablet" || !terminal.scope.machineIds?.includes(maquinaId)) notFound()
  const client = getClientById(terminal.clientId)
  if (!client) notFound()
  const multiple = (terminal.scope.machineIds?.length ?? 0) > 1
  return (
    <>
      <TerminalBranding clientId={client.id} />
      <Suspense fallback={<OperatorSkeleton />}>
        <OperatorScreen
          params={Promise.resolve({ cliente: client.slug, maquinaId })}
          terminal={{ name: terminal.name, switchHref: multiple ? `/terminal/${terminal.id}` : undefined }}
        />
      </Suspense>
    </>
  )
}
