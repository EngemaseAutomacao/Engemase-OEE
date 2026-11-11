import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { getClients, getCurrentUser, getUsers } from "@/lib/mock"
import { PageTitle } from "@/components/admin/bits"
import { onlyDigits } from "@/components/admin/labels"
import { NewClientWizard } from "@/components/admin/new-client-wizard"
import type { WizardContext } from "@/components/admin/wizard-model"

export const metadata: Metadata = { title: "Novo cliente" }

export default function Page() {
  const clients = getClients()
  const me = getCurrentUser()
  const ctx: WizardContext = {
    usedSlugs: clients.map((c) => c.slug),
    usedCnpjs: clients.map((c) => onlyDigits(c.cnpj)),
    knownEmails: getUsers()
      .filter((u) => u.email && u.platformRole === null)
      .map((u) => ({
        email: u.email!.toLowerCase(),
        name: u.name,
        clients: u.memberships.map((m) => clients.find((c) => c.id === m.clientId)?.name ?? m.clientId),
      })),
    engemaseDomain: me.email?.split("@")[1] ?? "engemase.com.br",
  }

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageTitle title="Novo cliente" description="Assistente em 3 passos: empresa, primeira unidade e primeiro admin. O cliente nasce em implantação.">
        <Link href="/admin/clientes" className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          <ChevronLeftIcon className="size-3.5" />
          Clientes
        </Link>
      </PageTitle>
      <NewClientWizard ctx={ctx} />
    </div>
  )
}
