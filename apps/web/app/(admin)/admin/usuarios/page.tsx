import type { Metadata } from "next"

import { AddMemberButton } from "@/components/admin-ops/add-member-dialog"
import { OpsTitle } from "@/components/admin-ops/bits"
import { FieldAssignments, SupportGrants } from "@/components/admin-ops/team-access"
import { TeamProvider } from "@/components/admin-ops/team-context"
import { buildTeam } from "@/components/admin-ops/team-data"
import { TeamMembers } from "@/components/admin-ops/team-members"
import { RoleCards, TeamStats } from "@/components/admin-ops/team-overview"

export const metadata: Metadata = { title: "Equipe Engemase" }

export default function Page() {
  const data = buildTeam()

  return (
    <TeamProvider data={data}>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <OpsTitle
          title="Equipe Engemase"
          description="Quem administra a plataforma, com qual papel e em quais clientes pode entrar agora."
          actions={<AddMemberButton />}
        />
        <TeamStats />
        <RoleCards />
        <TeamMembers />
        <div className="grid gap-4 xl:grid-cols-12">
          <FieldAssignments className="xl:col-span-7" />
          <SupportGrants className="xl:col-span-5" />
        </div>
      </div>
    </TeamProvider>
  )
}
