import type { Metadata } from "next"
import { Suspense } from "react"
import { InfoIcon } from "lucide-react"

import { dadosAcessoRemoto } from "@/lib/data/config/acesso-remoto"
import { PageSkeleton } from "@/components/shell/page-skeleton"
import { RemoteAccessBanco } from "@/components/support/remote-banco"
import { RemoteGuarantees } from "@/components/support/remote-guarantees"
import { ExportHistoryMenu, RemoteHistory } from "@/components/support/remote-history"
import { PolicyCard } from "@/components/support/remote-policy"
import { RemoteAccessProvider } from "@/components/support/remote-provider"
import { RemoteRequestButton } from "@/components/support/remote-request"
import { ActiveSessions, PendingRequests } from "@/components/support/remote-sessions"
import { RemoteStats } from "@/components/support/remote-stats"

export const metadata: Metadata = { title: "Acesso remoto" }

export default function Page({ params }: PageProps<"/[cliente]/acesso-remoto">) {
  return (
    <Suspense fallback={<PageSkeleton cards={4} blocks={2} />}>
      <Tela params={params} />
    </Suspense>
  )
}

/** Lê a sessão e os pedidos (com banco: RLS, `data.read`): fica dentro do <Suspense>. */
async function Tela({ params }: { params: PageProps<"/[cliente]/acesso-remoto">["params"] }) {
  const { cliente } = await params
  const d = await dadosAcessoRemoto(cliente)
  const { client, data } = d

  const body = (
    // `@container/page`: o histórico (tabela de 760 px) só divide a linha quando a largura útil comporta.
    <div className="@container/page flex flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Acesso remoto</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Pedidos, sessões e histórico do acesso de manutenção (VPN) da Engemase aos gateways de {client.name}. Nada abre sem a sua aprovação.
          </p>
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          {d.banco && d.canRequest && <RemoteRequestButton clientSlug={client.slug} gateways={d.gateways} maxDurationMin={data.policy.maxDurationMin} />}
          <ExportHistoryMenu className="w-full md:w-auto" />
        </div>
      </div>

      {data.me.isPlatform && (
        <div className="flex gap-3 rounded-2xl border border-[#257bb4]/25 bg-[#257bb4]/6 px-4 py-3 text-sm">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-[#257bb4] dark:text-[#4a9fd6]" />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Você está vendo a tela do cliente como {data.me.name} (Engemase).</span> Só o admin do cliente
            {data.approvers.length ? ` (${data.approvers.join(", ")})` : ""} aprova pedidos e altera a política — e quem pede nunca aprova.
            {d.banco ? " A ligação da VPN no gateway entra com a integração do provedor de VPN." : " Aqui as ações são simuladas."}
          </p>
        </div>
      )}

      <RemoteStats />

      <div className="grid gap-4 xl:grid-cols-12">
        <PendingRequests className="xl:col-span-7" />
        <ActiveSessions className="xl:col-span-5" />
      </div>

      <div className="grid gap-4 @6xl/page:grid-cols-12">
        <RemoteHistory className="@6xl/page:col-span-8" />
        <div className="grid min-w-0 content-start gap-4 @3xl/page:grid-cols-2 @6xl/page:col-span-4 @6xl/page:grid-cols-1">
          <PolicyCard />
          <RemoteGuarantees guideHref={`/${client.slug}/ajuda`} />
        </div>
      </div>
    </div>
  )

  return d.banco ? <RemoteAccessBanco data={data}>{body}</RemoteAccessBanco> : <RemoteAccessProvider data={data}>{body}</RemoteAccessProvider>
}
