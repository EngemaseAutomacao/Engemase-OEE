import { notFound } from "next/navigation"

import { getClientBySlug, getConfigAccess, getCurrentUser, getLines, getMachines, getTerminals, getUnits } from "@/lib/mock"
import { ago, date } from "@/lib/format"
import { ConfigAccessProvider, EngemaseManagedNote } from "@/components/config/engemase-managed"
import { TerminalsManager } from "@/components/settings/terminals-manager"
import type { TerminalRow } from "@/components/settings/types"

export default async function Page({ params }: PageProps<"/[cliente]/config/terminais">) {
  const { cliente } = await params
  const client = getClientBySlug(cliente)
  if (!client) notFound()

  const me = getCurrentUser()
  const units = getUnits(client.id).map((u) => ({ id: u.id, name: u.name }))
  const lines = getLines(client.id).map((l) => ({ id: l.id, unitId: l.unitId, name: l.name, code: l.code }))
  const machines = getMachines(client.id).map((m) => ({ id: m.id, unitId: m.unitId, lineId: m.lineId, name: m.name, code: m.code }))

  const terminals: TerminalRow[] = getTerminals(client.id).map((t) => ({
    id: t.id,
    unitId: t.unitId,
    name: t.name,
    kind: t.kind,
    lineIds: t.scope.lineIds ?? [],
    machineIds: t.scope.machineIds ?? [],
    theme: t.theme,
    status: t.status,
    pairedBy: t.pairedBy,
    pairedAt: t.pairedAt ? date(t.pairedAt) : null,
    lastSeen: ago(t.lastSeen),
    pairingCode: t.pairingCode ?? null,
  }))

  return (
    <ConfigAccessProvider canEdit={getConfigAccess(client.id).canConfigure}>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <EngemaseManagedNote clientSlug={client.slug} subject="Terminais (TVs Andon e tablets) e o que cada um mostra" />
        <TerminalsManager
          clientSlug={client.slug}
          clientName={client.name}
          currentUserName={me.platformRole ? `${me.name} (Engemase)` : me.name}
          units={units}
          lines={lines}
          machines={machines}
          initialTerminals={terminals}
        />
      </div>
    </ConfigAccessProvider>
  )
}
