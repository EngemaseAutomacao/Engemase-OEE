import type { Metadata } from "next"
import { Suspense } from "react"

import { getClientData } from "@/lib/data/cliente"
import { buildAlerts, buildDevices, buildScope } from "@/components/account/account-data"
import { AlertCenter } from "@/components/account/alert-center"
import { EnablePushButton } from "@/components/account/push-devices"
import { PageSkeleton } from "@/components/shell/page-skeleton"

export const metadata: Metadata = { title: "Notificações" }

export default function Page({ params }: PageProps<"/[cliente]/notificacoes">) {
  return (
    <Suspense fallback={<PageSkeleton cards={0} blocks={2} />}>
      <Notifications params={params} />
    </Suspense>
  )
}

async function Notifications({ params }: { params: PageProps<"/[cliente]/notificacoes">["params"] }) {
  const { cliente } = await params
  const data = await getClientData(cliente, { somenteCadastro: true, notificacoes: true })
  const { client, viewer } = data
  const alerts = buildAlerts(data)

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Notificações</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Alertas de máquinas, gateways e acessos de {client.name}. Escolha o que receber e em quais aparelhos.
          </p>
        </div>
        <EnablePushButton className="w-full md:w-auto" />
      </div>

      <AlertCenter
        alerts={alerts}
        units={data.units.map((u) => ({ id: u.id, name: u.name }))}
        scope={buildScope(data)}
        // Aparelhos com push: os do protótipo na demonstração; o cadastro real de push é da conta (F2).
        devices={data.fonte === "simulado" ? buildDevices() : []}
        user={{ name: viewer.name, email: viewer.email, isPlatform: viewer.isPlatform }}
        clientName={client.name}
      />
    </div>
  )
}
