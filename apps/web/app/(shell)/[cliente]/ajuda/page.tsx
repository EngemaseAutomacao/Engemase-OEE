import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { getClientBySlug } from "@/lib/mock"
import { ContactCard, PlatformStatusCard } from "@/components/support/help-aside"
import { HelpCenter } from "@/components/support/help-center"
import { buildHelp, buildPlatformStatus } from "@/components/support/help-data"
import { HelpProvider, OpenTicketButton } from "@/components/support/help-provider"
import { TicketsCard } from "@/components/support/help-tickets"

export const metadata: Metadata = { title: "Central de ajuda" }

export default async function Page({ params }: PageProps<"/[cliente]/ajuda">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const d = buildHelp(client)
  const status = buildPlatformStatus(client)
  const b = `/${client.slug}`

  return (
    <HelpProvider targets={d.targets} initialTickets={d.tickets} nextTicket={d.nextTicket}>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Central de ajuda</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Guias, perguntas frequentes e suporte da Engemase para {client.name}.</p>
          </div>
          <OpenTicketButton className="w-full md:w-auto" />
        </div>

        <HelpCenter
          firstName={d.firstName}
          articles={d.articles}
          categories={d.categories}
          faq={d.faq}
          aside={
            <>
              <ContactCard remoteHref={`${b}/acesso-remoto`} />
              <TicketsCard pendingRemote={d.pendingRemote} remoteHref={`${b}/acesso-remoto`} />
              <PlatformStatusCard {...status} gatewaysHref={`${b}/config/gateways`} />
            </>
          }
        />
      </div>
    </HelpProvider>
  )
}
