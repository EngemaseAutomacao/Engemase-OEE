import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { InfoIcon } from "lucide-react"

import { getClientBySlug } from "@/lib/mock"
import { buildRemoteAccess } from "@/components/support/remote-data"
import { RemoteGuarantees } from "@/components/support/remote-guarantees"
import { ExportHistoryMenu, RemoteHistory } from "@/components/support/remote-history"
import { PolicyCard } from "@/components/support/remote-policy"
import { RemoteAccessProvider } from "@/components/support/remote-provider"
import { ActiveSessions, PendingRequests } from "@/components/support/remote-sessions"
import { RemoteStats } from "@/components/support/remote-stats"

export const metadata: Metadata = { title: "Acesso remoto" }

export default async function Page({ params }: PageProps<"/[cliente]/acesso-remoto">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const data = buildRemoteAccess(client)

  return (
    <RemoteAccessProvider data={data}>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Acesso remoto</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Pedidos, sessões e histórico do acesso de manutenção (VPN) da Engemase aos gateways de {client.name}. Nada abre sem a sua aprovação.
            </p>
          </div>
          <ExportHistoryMenu className="w-full md:w-auto" />
        </div>

        {data.me.isPlatform && (
          <div className="flex gap-3 rounded-2xl border border-[#257bb4]/25 bg-[#257bb4]/6 px-4 py-3 text-sm">
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-[#257bb4] dark:text-[#4a9fd6]" />
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Você está vendo a tela do cliente como {data.me.name} (Engemase).</span> No uso real, só o admin do cliente
              {data.approvers.length ? ` (${data.approvers.join(", ")})` : ""} aprova pedidos e altera a política — e quem pede nunca aprova. Aqui as ações são simuladas.
            </p>
          </div>
        )}

        <RemoteStats />

        <div className="grid gap-4 xl:grid-cols-12">
          <PendingRequests className="xl:col-span-7" />
          <ActiveSessions className="xl:col-span-5" />
        </div>

        <div className="grid gap-4 xl:grid-cols-12">
          <RemoteHistory className="xl:col-span-8" />
          <div className="grid min-w-0 content-start gap-4 lg:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
            <PolicyCard />
            <RemoteGuarantees guideHref={`/${client.slug}/ajuda`} />
          </div>
        </div>
      </div>
    </RemoteAccessProvider>
  )
}
