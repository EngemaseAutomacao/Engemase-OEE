import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type IconTone = "blue" | "navy" | "orange" | "teal" | "green" | "red" | "amber" | "violet" | "slate"

const TONES: Record<IconTone, string> = {
  blue: "bg-[#257bb4] text-white",
  navy: "bg-[#2c4e73] text-white",
  orange: "bg-[#e96549] text-white",
  teal: "bg-[#0e9384] text-white",
  green: "bg-state-running text-white",
  red: "bg-state-fault text-white",
  amber: "bg-state-stopped text-white",
  violet: "bg-state-setup text-white",
  slate: "bg-muted text-muted-foreground",
}

const SOFT: Record<IconTone, string> = {
  blue: "bg-[#257bb4]/12 text-[#257bb4] dark:text-[#4a9fd6]",
  navy: "bg-[#2c4e73]/12 text-[#2c4e73] dark:bg-white/10 dark:text-[#9cc3e6]",
  orange: "bg-[#e96549]/14 text-[#cf5539]",
  teal: "bg-[#0e9384]/12 text-[#0e9384]",
  green: "bg-state-running/12 text-state-running",
  red: "bg-state-fault/12 text-state-fault",
  amber: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
  violet: "bg-state-setup/12 text-state-setup",
  slate: "bg-muted text-muted-foreground",
}

/** Ícone dentro de um círculo colorido (cheio ou suave). */
export function IconCircle({
  icon: Icon,
  tone = "blue",
  soft = false,
  size = "md",
  className,
}: {
  icon: LucideIcon
  tone?: IconTone
  soft?: boolean
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const dims = { sm: "size-8 [&>svg]:size-4", md: "size-11 [&>svg]:size-5", lg: "size-14 [&>svg]:size-6" }[size]
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full", dims, soft ? SOFT[tone] : TONES[tone], className)}>
      <Icon aria-hidden />
    </span>
  )
}
