import type { Metadata } from "next"
import Link from "next/link"
import { Building2Icon, FactoryIcon, PauseCircleIcon, PlusIcon, RocketIcon } from "lucide-react"

import { num, pct } from "@/lib/format"
import { StatCard } from "@/components/dashboard/stat-card"
import { Button } from "@/components/ui/button"
import { buildClientRows } from "@/components/admin/admin-data"
import { PageTitle } from "@/components/admin/bits"
import { ClientsTable } from "@/components/admin/clients-table"

export const metadata: Metadata = { title: "Clientes" }

export default function Page() {
  const rows = buildClientRows()
  const count = (s: string) => rows.filter((r) => r.status === s).length
  const used = rows.reduce((s, r) => s + r.machines, 0)
  const limit = rows.reduce((s, r) => s + r.machinesLimit, 0)

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageTitle
        title="Clientes"
        description="Todos os clientes da plataforma: status, plano, máquinas contratadas × em uso (a assinatura é cobrada por máquina) e gateways com problema."
        actions={
          <Button asChild>
            <Link href="/admin/clientes/novo">
              <PlusIcon />
              Novo cliente
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Building2Icon} tone="blue" label="Clientes ativos" value={count("active")} hint={`de ${rows.length} clientes cadastrados`} />
        <StatCard icon={RocketIcon} tone="navy" label="Em implantação" value={count("onboarding")} hint="Engemase configurando" />
        <StatCard icon={PauseCircleIcon} tone="orange" label="Suspensos" value={count("suspended")} hint="Coleta de dados continua" />
        <StatCard
          icon={FactoryIcon}
          tone="teal"
          label="Máquinas em uso"
          value={
            <>
              {num(used)}
              <span className="text-base font-semibold text-muted-foreground"> / {num(limit)}</span>
            </>
          }
          hint={`${pct(limit > 0 ? used / limit : 0, 0)} das contratadas`}
        />
      </div>

      <ClientsTable rows={rows} />
    </div>
  )
}
