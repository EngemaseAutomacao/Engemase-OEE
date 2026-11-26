import { Suspense } from "react"
import type { Metadata } from "next"

import { OperatorScreen, OperatorSkeleton } from "@/components/kiosk/operator-screen"

export const metadata: Metadata = { title: "Tela do operador" }

/** Tela do operador (tablet 1024×768 e celular): toque com luva, sem menu lateral. */
export default function Page({ params }: PageProps<"/[cliente]/operador/[maquinaId]">) {
  return (
    <Suspense fallback={<OperatorSkeleton />}>
      <OperatorScreen params={params} />
    </Suspense>
  )
}
