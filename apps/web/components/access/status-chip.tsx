import { cn } from "@/lib/utils"
import { GATEWAY_STATUS_LABEL } from "@/lib/roles"
import type { DeviceStatus, GatewayStatus } from "@/lib/mock/types"
import { DEVICE_STATUS_LABEL, DEVICE_STATUS_STYLE, GATEWAY_STATUS_STYLE } from "./labels"

/** Chip de status do gateway (online, com alertas, offline, aguardando ativação). */
export function GatewayStatusChip({ status, className }: { status: GatewayStatus; className?: string }) {
  const s = GATEWAY_STATUS_STYLE[status]
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", s.chip, className)}>
      <span className="relative inline-flex size-2 shrink-0">
        {status === "offline" && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", s.dot)} />}
        <span className={cn("relative inline-flex size-2 rounded-full", s.dot)} />
      </span>
      {GATEWAY_STATUS_LABEL[status]}
    </span>
  )
}

/** Chip de status de um dispositivo (CLP). */
export function DeviceStatusChip({ status, className }: { status: DeviceStatus; className?: string }) {
  const s = DEVICE_STATUS_STYLE[status]
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", s.chip, className)}>
      <span className={cn("size-2 shrink-0 rounded-full", s.dot)} />
      {DEVICE_STATUS_LABEL[status]}
    </span>
  )
}

/** Chip genérico (status de usuário, comando, qualidade). */
export function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)}>{children}</span>
}
