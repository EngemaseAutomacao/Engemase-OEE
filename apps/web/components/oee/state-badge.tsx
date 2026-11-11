import { cn } from "@/lib/utils"
import { STATE_META } from "@/lib/states"
import type { MachineState } from "@/lib/mock/types"

/** Badge com bolinha colorida + rótulo do estado da máquina. */
export function StateBadge({
  state,
  short = false,
  pulse = false,
  className,
}: {
  state: MachineState
  short?: boolean
  pulse?: boolean
  className?: string
}) {
  const meta = STATE_META[state]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        meta.soft,
        meta.text,
        className,
      )}
    >
      <StateDot state={state} pulse={pulse} />
      {short ? meta.short : meta.label}
    </span>
  )
}

export function StateDot({ state, pulse = false, className }: { state: MachineState; pulse?: boolean; className?: string }) {
  const meta = STATE_META[state]
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      {pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", meta.dot)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", meta.dot, state === "NO_COMM" && "bg-stripes")} />
    </span>
  )
}
