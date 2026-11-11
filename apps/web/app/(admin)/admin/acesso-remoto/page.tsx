import type { Metadata } from "next"

import { OpsTitle } from "@/components/admin-ops/bits"
import { KillSwitchButton, RequestAccessButton } from "@/components/admin-ops/remote-actions"
import { RemoteProvider } from "@/components/admin-ops/remote-context"
import { buildRemoteAccess } from "@/components/admin-ops/remote-data"
import { RemoteHistory } from "@/components/admin-ops/remote-history"
import { KillSwitchBanner, RemotePolicies, RemoteStats } from "@/components/admin-ops/remote-overview"
import { ActiveSessions, PendingRequests } from "@/components/admin-ops/remote-sessions"

export const metadata: Metadata = { title: "Acesso remoto" }

export default function Page() {
  const data = buildRemoteAccess()

  return (
    <RemoteProvider data={data}>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <OpsTitle
          title="Acesso remoto"
          description="VPN de manutenção de todos os clientes: desligada por padrão, aprovada pelo cliente e encerrada sozinha no prazo."
          actions={
            <>
              <KillSwitchButton />
              <RequestAccessButton />
            </>
          }
        />
        <KillSwitchBanner />
        <RemoteStats />
        <div className="grid gap-4 xl:grid-cols-12">
          <ActiveSessions className="xl:col-span-7" />
          <PendingRequests className="xl:col-span-5" />
        </div>
        <RemoteHistory />
        <RemotePolicies />
      </div>
    </RemoteProvider>
  )
}
