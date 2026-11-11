"use client"

import { ArrowUpCircleIcon, CpuIcon, FileDownIcon, ListChecksIcon } from "lucide-react"

import { num, pct } from "@/lib/format"
import { Ring } from "@/components/dashboard/ring"
import { StatCard } from "@/components/dashboard/stat-card"
import { useFleet } from "./fleet-context"

/** Indicadores da frota (recalculados com o estado local: provisionamentos e OTA). */
export function FleetStats() {
  const { rows, latest, scheduled } = useFleet()
  const total = rows.length
  const online = rows.filter((r) => r.status === "online").length
  const degraded = rows.filter((r) => r.status === "degraded").length
  const offline = rows.filter((r) => r.status === "offline").length
  const pending = rows.filter((r) => r.status === "pending").length
  const outdated = rows.filter((r) => r.versionState === "outdated" || r.versionState === "unsupported")
  const unsupported = outdated.filter((r) => r.versionState === "unsupported").length
  const queued = outdated.filter((r) => scheduled[r.id]).length
  const configPending = rows.filter((r) => r.configState === "pending")
  const buffer = rows.reduce((s, r) => s + r.bufferPending, 0)
  const bufferGws = rows.filter((r) => r.bufferPending > 0).length
  const clockAlerts = rows.filter((r) => r.clockState === "alert").length
  const ratio = total > 0 ? online / total : 0

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={CpuIcon}
        tone="teal"
        label="Gateways online"
        value={
          <>
            {online}
            <span className="text-base font-semibold text-muted-foreground"> / {total}</span>
          </>
        }
        hint={`${degraded} com alertas · ${offline} offline · ${pending} aguardando`}
        aside={<Ring value={ratio} size={58} stroke={7} color="#0e9384" label={pct(ratio, 0)} />}
      />
      <StatCard
        icon={ArrowUpCircleIcon}
        tone="orange"
        label="Agente desatualizado"
        value={outdated.length}
        hint={queued > 0 ? `${queued} com atualização agendada` : `estável ${latest}${unsupported > 0 ? ` · ${unsupported} sem suporte` : ""}`}
      />
      <StatCard
        icon={ListChecksIcon}
        tone="navy"
        label="Configuração pendente"
        value={configPending.length}
        hint={configPending.length > 0 ? `aplicada ≠ publicada em ${configPending.map((r) => r.hostname).join(", ")}` : "todas aplicadas"}
      />
      <StatCard
        icon={FileDownIcon}
        tone="blue"
        label="Registros na fila"
        value={num(buffer)}
        hint={`em ${bufferGws} gateway${bufferGws === 1 ? "" : "s"}${clockAlerts > 0 ? ` · ${clockAlerts} com relógio > 2 s` : ""}`}
      />
    </div>
  )
}
