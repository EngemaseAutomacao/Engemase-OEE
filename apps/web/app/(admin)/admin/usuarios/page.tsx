import { Suspense } from "react"
import type { Metadata } from "next"

import { AddMemberButton } from "@/components/admin-ops/add-member-dialog"
import { OpsTitle } from "@/components/admin-ops/bits"
import { FieldAssignments, SupportGrants } from "@/components/admin-ops/team-access"
import { TeamProvider } from "@/components/admin-ops/team-context"
import { dadosEquipe } from "@/lib/data/admin/console"
import { TeamMembers } from "@/components/admin-ops/team-members"
import { RoleCards, TeamStats } from "@/components/admin-ops/team-overview"
import { CarregandoPagina } from "@/components/shell/carregando"
import { usarBanco } from "@/lib/data/fonte"

export const metadata: Metadata = { title: "Equipe Engemase" }

export default function Page() {
  return (
    <Suspense fallback={<CarregandoPagina cartoes={4} />}>
      <Equipe />
    </Suspense>
  )
}

async function Equipe() {
  const data = await dadosEquipe()

  return (
    <TeamProvider data={data}>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <OpsTitle
          title="Equipe Engemase"
          description="Quem administra a plataforma, com qual papel e em quais clientes pode entrar agora."
          actions={<AddMemberButton banco={usarBanco()} />}
        />
        <TeamStats />
        <RoleCards />
        <TeamMembers />
        {/* Lado a lado só a partir de 1536 px: abaixo disso a tabela de atribuições ficava cortada. */}
        <div className="grid gap-4 2xl:grid-cols-12">
          <FieldAssignments className="2xl:col-span-8" />
          <SupportGrants className="2xl:col-span-4" />
        </div>
      </div>
    </TeamProvider>
  )
}
