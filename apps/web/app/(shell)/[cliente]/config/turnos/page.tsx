import type { Metadata } from "next"
import { Suspense } from "react"
import { ConfigAccessProvider, EngemaseManagedNote } from "@/components/config/engemase-managed"
import { ShiftsManager } from "@/components/config/shifts-manager"
import { CarregandoPagina } from "@/components/shell/carregando"
import { dadosTurnos } from "@/lib/data/config/turnos"

export const metadata: Metadata = { title: "Turnos" }

/** Lê a sessão e o cadastro (com banco, `requireTenant`): fica dentro do <Suspense>. */
async function Tela({ params }: { params: PageProps<"/[cliente]/config/turnos">["params"] }) {
  const { cliente } = await params
  const d = await dadosTurnos(cliente)
  return (
    <ConfigAccessProvider canEdit={d.canEdit}>
      <EngemaseManagedNote padded clientSlug={d.client.slug} subject="Turnos, pausas e paradas planejadas" />
      <ShiftsManager
        units={d.units}
        initialShifts={d.shifts}
        initialStops={d.stops}
        reasons={d.reasons}
        machines={d.machines}
        banco={d.banco}
        clientSlug={d.client.slug}
      />
    </ConfigAccessProvider>
  )
}

export default function Page({ params }: PageProps<"/[cliente]/config/turnos">) {
  return (
    <Suspense fallback={<CarregandoPagina />}>
      <Tela params={params} />
    </Suspense>
  )
}
