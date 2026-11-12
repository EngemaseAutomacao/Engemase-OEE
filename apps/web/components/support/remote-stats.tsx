"use client"

import { FileLock2Icon, HistoryIcon, HourglassIcon, ShieldCheckIcon } from "lucide-react"

import { duration } from "@/lib/format"
import { StatCard } from "@/components/dashboard/stat-card"
import { MODE_META, agoLabel, bytesLabel, countdown, minutesLabel } from "./remote-labels"
import { useRemote } from "./remote-provider"

const DAY = 24 * 3600_000

/** Indicadores do topo: pedidos pendentes, sessão ativa, últimos 30 dias e política. */
export function RemoteStats() {
  const { sessions, policy, now } = useRemote()
  const pending = sessions.filter((s) => s.status === "requested")
  const oldest = pending.reduce<number | null>((min, s) => (min === null || s.requestedMs < min ? s.requestedMs : min), null)
  const live = sessions.filter((s) => s.status === "active" || s.status === "approved")
  const next = live
    .filter((s) => s.status === "active" && s.expiresMs !== null)
    .sort((a, b) => a.expiresMs! - b.expiresMs!)[0]
  const recent = sessions.filter((s) => s.startedMs !== null && now - s.startedMs <= 30 * DAY)
  const connectedS = recent.reduce((acc, s) => acc + ((s.endedMs ?? now) - s.startedMs!) / 1000, 0)
  const traffic = recent.reduce((acc, s) => acc + (s.bytes ?? 0), 0)

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={HourglassIcon}
        tone="orange"
        label="Aguardando aprovação"
        value={pending.length}
        hint={oldest !== null ? `Mais antigo: ${agoLabel(oldest, now)}` : "Nenhum pedido pendente"}
      />
      <StatCard
        icon={ShieldCheckIcon}
        tone="teal"
        label={live.length > 1 ? `Sessões ativas (${live.length})` : "Sessão ativa"}
        value={next ? <span className="font-mono">{countdown(next.expiresMs! - now)}</span> : live.length ? "Ativando…" : "Nenhuma"}
        hint={next ? `${next.gatewayName} · ${next.requestedBy}` : live.length ? "VPN ligando no gateway" : "VPN desligada em todos os gateways"}
      />
      <StatCard
        icon={HistoryIcon}
        tone="blue"
        label="Sessões em 30 dias"
        value={recent.length}
        hint={recent.length ? `${duration(connectedS)} conectados · ${bytesLabel(traffic)}` : "Nenhuma sessão no período"}
      />
      <StatCard
        icon={FileLock2Icon}
        tone="navy"
        label="Política"
        value={MODE_META[policy.mode].short}
        hint={`até ${minutesLabel(policy.maxDurationMin)} · CLP ${policy.allowPlcForward ? "caso a caso" : "bloqueado"}`}
      />
    </div>
  )
}
