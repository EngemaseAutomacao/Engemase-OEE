import type { Metadata } from "next"

import { getPendingPairings } from "@/lib/mock"
import { PairingScreen } from "@/components/kiosk/pairing-screen"

export const metadata: Metadata = { title: "Parear aparelho" }

/** Tela que o aparelho (TV ou tablet) abre para digitar o código gerado em Configurações → Terminais. */
export default function Page() {
  // Protótipo: os códigos válidos vêm do mock. Na versão real, o código é conferido no servidor (uso único, 10 min).
  return <PairingScreen pending={getPendingPairings()} />
}
