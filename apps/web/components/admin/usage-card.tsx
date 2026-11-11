"use client"

import { CpuIcon, DatabaseIcon, FactoryIcon, type LucideIcon, UsersIcon } from "lucide-react"

import { num } from "@/lib/format"
import { PLAN_LABEL } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { SectionCard } from "@/components/dashboard/section-card"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { UsageBar } from "./bits"
import { useClientDetail } from "./client-detail-context"

function Meter({ icon, tone, label, used, limit }: { icon: LucideIcon; tone: IconTone; label: string; used: number; limit: number }) {
  const ratio = limit > 0 ? used / limit : 0
  const note = ratio >= 1 ? "Limite atingido: novas criações ficam bloqueadas" : ratio >= 0.8 ? "Perto do limite" : `${num(Math.max(0, limit - used))} disponíveis`
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      <IconCircle icon={icon} tone={tone} soft size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate font-medium text-muted-foreground">{label}</span>
          <span className="tabular-nums">
            <span className="text-sm font-bold">{num(used)}</span>
            <span className="text-muted-foreground"> / {num(limit)}</span>
          </span>
        </div>
        <UsageBar used={used} limit={limit} className="mt-1.5" />
        <div className={cn("mt-1 truncate text-[11px]", ratio >= 1 ? "font-semibold text-state-fault" : ratio >= 0.8 ? "font-semibold text-amber-700 dark:text-state-stopped" : "text-muted-foreground")}>
          {note}
        </div>
      </div>
    </div>
  )
}

/** Uso × limites do plano (os limites podem ter sido editados nesta sessão). */
export function UsageCard({ used, className }: { used: { machines: number; gateways: number; users: number }; className?: string }) {
  const { info } = useClientDetail()
  return (
    <SectionCard title="Uso × limites do plano" description={`Plano ${PLAN_LABEL[info.plan]} · limites bloqueiam a criação além do contratado`} className={className}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Meter icon={FactoryIcon} tone="blue" label="Máquinas" used={used.machines} limit={info.limits.machines} />
        <Meter icon={CpuIcon} tone="teal" label="Gateways" used={used.gateways} limit={info.limits.gateways} />
        <Meter icon={UsersIcon} tone="navy" label="Usuários" used={used.users} limit={info.limits.users} />
        <div className="flex items-center gap-3 rounded-xl border p-3">
          <IconCircle icon={DatabaseIcon} tone="violet" soft size="sm" />
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-medium text-muted-foreground">Retenção de dados</div>
            <div className="text-sm font-bold tabular-nums">{info.limits.retentionMonths} meses</div>
            <div className="truncate text-[11px] text-muted-foreground">Dados brutos e agregados por turno</div>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
