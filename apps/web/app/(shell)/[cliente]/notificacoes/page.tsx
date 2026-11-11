import { notFound } from "next/navigation"

import { getClientBySlug, getCurrentUser, getUnits } from "@/lib/mock"
import { buildAlerts, buildDevices, buildScope } from "@/components/account/account-data"
import { AlertCenter } from "@/components/account/alert-center"
import { EnablePushButton } from "@/components/account/push-devices"

export default async function Page({ params }: PageProps<"/[cliente]/notificacoes">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const me = getCurrentUser()
  const alerts = buildAlerts(client.id)

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
        units={getUnits(client.id).map((u) => ({ id: u.id, name: u.name }))}
        scope={buildScope(client.id)}
        devices={buildDevices()}
        user={{ name: me.name, email: me.email ?? "", isPlatform: Boolean(me.platformRole) }}
        clientName={client.name}
      />
    </div>
  )
}
