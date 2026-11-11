"use client"

import { toast } from "sonner"
import { Building2Icon, CheckIcon, HistoryIcon, InboxIcon, OctagonXIcon, ShieldCheckIcon, TerminalSquareIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { StatCard } from "@/components/dashboard/stat-card"
import { SectionCard } from "@/components/dashboard/section-card"
import { Button } from "@/components/ui/button"
import { SoftBadge, plural } from "./bits"
import { MODE_LABEL } from "./labels"
import { useRemote } from "./remote-context"

/** Indicadores do acesso remoto (recalculados com o estado local). */
export function RemoteStats() {
  const { sessions, policies, last30, avgMinutes, killSwitch } = useRemote()
  const active = sessions.filter((s) => s.status === "active" || s.status === "approved")
  const relay = active.filter((s) => s.connection === "relay").length
  const pending = sessions.filter((s) => s.status === "requested")
  const allowed = policies.filter((p) => p.mode !== "disabled" && p.clientStatus !== "suspended")

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={TerminalSquareIcon}
        tone="teal"
        label="Sessões ativas"
        value={active.length}
        hint={active.length > 0 ? `${relay} via relay (443) · ${active.length - relay} direta${active.length - relay === 1 ? "" : "s"}` : "nenhuma VPN aberta agora"}
      />
      <StatCard
        icon={InboxIcon}
        tone="orange"
        label="Pedidos pendentes"
        value={pending.length}
        hint={pending.length > 0 ? "aguardando o admin do cliente" : "nenhum pedido aguardando"}
      />
      <StatCard icon={HistoryIcon} tone="navy" label="Sessões em 30 dias" value={last30} hint={avgMinutes !== null ? `duração média de ${avgMinutes} min` : "sem sessões encerradas"} />
      <StatCard
        icon={killSwitch ? OctagonXIcon : Building2Icon}
        tone={killSwitch ? "red" : "blue"}
        label="Clientes que permitem VPN"
        value={
          killSwitch ? (
            "Bloqueado"
          ) : (
            <>
              {allowed.length}
              <span className="text-base font-semibold text-muted-foreground"> / {policies.length}</span>
            </>
          )
        }
        hint={killSwitch ? "kill switch global ativo" : `${policies.length - allowed.length} desativado ou suspenso`}
      />
    </div>
  )
}

/** Faixa exibida enquanto o kill switch global estiver ativo. */
export function KillSwitchBanner() {
  const { killSwitch, deactivateKill } = useRemote()
  if (!killSwitch) return null
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-state-fault/40 bg-state-fault/8 p-4 sm:flex-row sm:items-center">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-state-fault text-white">
        <OctagonXIcon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-state-fault">Kill switch global ativo</div>
        <p className="text-xs text-muted-foreground">
          Desde {killSwitch.atLabel} por {killSwitch.by} · {killSwitch.reason}. Novos pedidos estão bloqueados em todos os clientes; os gateways recebem vpn.disable no próximo /sync.
        </p>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          deactivateKill()
          toast.success("Kill switch global desativado", { description: "Novos pedidos de acesso voltam a ser aceitos. Sessões revogadas não são reabertas." })
        }}
      >
        Desativar kill switch
      </Button>
    </div>
  )
}

/** Políticas de acesso remoto de cada cliente (definidas pelo admin do cliente). */
export function RemotePolicies() {
  const { policies } = useRemote()
  return (
    <SectionCard title="Políticas dos clientes" description="Definidas pelo admin de cada cliente · vale a regra mais restritiva entre cliente, unidade e gateway">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {policies.map((p) => {
          const off = p.mode === "disabled" || p.clientStatus === "suspended"
          return (
            <div key={p.clientId} className={cn("flex flex-col gap-2 rounded-xl border p-3", off && "bg-muted/40")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{p.clientName}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {p.approvers.length > 0 ? `Aprova: ${p.approvers.join(", ")}` : "Sem admin ativo para aprovar"}
                  </div>
                </div>
                <SoftBadge tone={p.mode === "disabled" ? "slate" : p.mode === "preapproved_window" ? "teal" : "blue"} icon={p.mode === "disabled" ? XIcon : ShieldCheckIcon}>
                  {MODE_LABEL[p.mode]}
                </SoftBadge>
              </div>
              <ul className="grid gap-1 text-xs">
                <li className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Duração máxima</span>
                  <span className="font-medium">{p.maxDurationMin >= 60 ? `${p.maxDurationMin / 60} h` : `${p.maxDurationMin} min`}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Inatividade</span>
                  <span className="font-medium">{p.idleTimeoutMin} min</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Acesso a CLP</span>
                  <span className={cn("inline-flex items-center gap-1 font-medium", !p.allowPlcForward && "text-muted-foreground")}>
                    {p.allowPlcForward ? <CheckIcon className="size-3 text-state-running" aria-hidden /> : <XIcon className="size-3" aria-hidden />}
                    {p.allowPlcForward ? "Permitido" : "Não permitido"}
                  </span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Contato na planta</span>
                  <span className="font-medium">{p.requireOnsiteContact ? "Obrigatório" : "Opcional"}</span>
                </li>
                {p.windows.length > 0 && (
                  <li className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Janela</span>
                    <span className="font-medium">{p.windows.join(" · ")}</span>
                  </li>
                )}
              </ul>
              {p.clientStatus === "suspended" && <p className="text-[11px] text-muted-foreground">Cliente suspenso: novos pedidos bloqueados.</p>}
              {p.mode === "disabled" && p.clientStatus !== "suspended" && <p className="text-[11px] text-muted-foreground">O cliente desligou o acesso remoto.</p>}
            </div>
          )
        })}
      </div>
      {policies.length > 0 && <p className="mt-3 text-[11px] text-muted-foreground">{plural(policies.length, "cliente", "clientes")} com política cadastrada. Solicitar é da Engemase; aprovar e mudar a política é só do admin do cliente.</p>}
    </SectionCard>
  )
}
