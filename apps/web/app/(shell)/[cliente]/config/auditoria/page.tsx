import { notFound } from "next/navigation"

import { getClientBySlug } from "@/lib/mock"
import { buildAudit } from "@/components/settings/audit-data"
import { AuditLog } from "@/components/settings/audit-log"

export default async function Page({ params }: PageProps<"/[cliente]/config/auditoria">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <AuditLog clientName={client.name} clientSlug={client.slug} rows={buildAudit(client)} />
    </div>
  )
}
