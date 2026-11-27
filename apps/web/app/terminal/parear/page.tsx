import type { Metadata } from "next"

import { usarBanco } from "@/lib/data/fonte"
import { getPendingPairings } from "@/lib/mock"
import { PairingScreen } from "@/components/kiosk/pairing-screen"
import { parearAction } from "@/app/terminal/actions"

export const metadata: Metadata = { title: "Parear aparelho" }

/**
 * Tela que o aparelho (TV ou tablet) abre para digitar o código gerado em Configurações → Terminais.
 * Sistema real: o código é conferido no servidor (`parearAction`: uso único, 10 min, limite por IP) e o
 * aparelho recebe o cookie próprio de /terminal. Demonstração: códigos simulados do protótipo.
 */
export default function Page() {
  if (usarBanco()) return <PairingScreen pending={[]} pair={parearAction} />
  return <PairingScreen pending={getPendingPairings()} />
}
