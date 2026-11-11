import type { Metadata } from "next"
import { ClipboardListIcon, HeadsetIcon, ShieldCheckIcon, UsersIcon } from "lucide-react"

import { StatCard } from "@/components/dashboard/stat-card"
import { AuditConsole } from "@/components/admin-ops/audit-console"
import { buildAudit } from "@/components/admin-ops/audit-data"
import { OpsTitle } from "@/components/admin-ops/bits"

export const metadata: Metadata = { title: "Auditoria global" }

export default function Page() {
  const data = buildAudit()
  const rows = data.rows
  const platform = rows.filter((r) => r.category === "platform")
  const support = rows.filter((r) => r.category === "support")
  const people = new Map(rows.map((r) => [r.actorName, r.actorKind]))
  const engemase = [...people.values()].filter((k) => k === "engemase").length
  const supportClients = new Set(support.map((r) => r.clientName)).size

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <OpsTitle title="Auditoria global" description="Todas as ações registradas na plataforma e em todos os clientes, da mais recente para a mais antiga." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardListIcon} tone="blue" label="Eventos registrados" value={rows.length} hint={`desde ${data.since}`} />
        <StatCard icon={ShieldCheckIcon} tone="navy" label="Ações de plataforma" value={platform.length} hint="clientes, equipe e ciclo de vida" />
        <StatCard
          icon={HeadsetIcon}
          tone="orange"
          label="Acessos de suporte"
          value={support.length}
          hint={support.length > 0 ? `em ${supportClients} cliente${supportClients === 1 ? "" : "s"} · visíveis ao cliente` : "nenhum no período"}
        />
        <StatCard icon={UsersIcon} tone="teal" label="Pessoas com ações" value={people.size} hint={`${engemase} da Engemase · ${people.size - engemase} de clientes`} />
      </div>

      <AuditConsole data={data} />
    </div>
  )
}
