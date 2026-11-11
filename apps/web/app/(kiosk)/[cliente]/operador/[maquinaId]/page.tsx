import { Suspense } from "react"
import type { Metadata } from "next"

import { getMachine, machineParams } from "@/lib/mock"
import { OperatorScreen, OperatorSkeleton } from "@/components/kiosk/operator-screen"

export async function generateStaticParams({ params }: { params: { cliente: string } }) {
  return machineParams(params.cliente)
}

export async function generateMetadata({ params }: PageProps<"/[cliente]/operador/[maquinaId]">): Promise<Metadata> {
  const { maquinaId } = await params
  const machine = getMachine(maquinaId)
  return { title: machine ? `Operador · ${machine.name}` : "Tela do operador" }
}

/** Tela do operador (tablet 1024×768 e celular): toque com luva, sem menu lateral. */
export default function Page({ params }: PageProps<"/[cliente]/operador/[maquinaId]">) {
  return (
    <Suspense fallback={<OperatorSkeleton />}>
      <OperatorScreen params={params} />
    </Suspense>
  )
}
