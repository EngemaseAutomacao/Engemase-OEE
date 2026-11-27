import type { Metadata } from "next"
import { Suspense } from "react"

import { AuditLog } from "@/components/settings/audit-log"
import { CarregandoPagina } from "@/components/shell/carregando"
import { AUDIT_DAYS, AUDIT_LIMIT, dadosAuditoria } from "@/lib/data/config/auditoria"

export const metadata: Metadata = { title: "Auditoria" }

/** Lê a sessão e a auditoria (com banco: `audit.read`, RLS e escopo): fica dentro do <Suspense>. */
async function Tela({ params }: { params: PageProps<"/[cliente]/config/auditoria">["params"] }) {
  const { cliente } = await params
  const d = await dadosAuditoria(cliente)
  const note = !d.banco
    ? undefined
    : d.truncated
      ? `Mostrando os ${AUDIT_LIMIT} eventos mais recentes.`
      : `Mostrando os últimos ${AUDIT_DAYS} dias.`
  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <AuditLog clientName={d.client.name} clientSlug={d.client.slug} rows={d.rows} note={note} />
    </div>
  )
}

export default function Page({ params }: PageProps<"/[cliente]/config/auditoria">) {
  return (
    <Suspense fallback={<CarregandoPagina />}>
      <Tela params={params} />
    </Suspense>
  )
}
