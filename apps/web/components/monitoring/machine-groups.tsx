import Link from "next/link"
import { Building2Icon, MonitorIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { pct } from "@/lib/format"
import { STATE_META, STATE_ORDER, TONE_TEXT, oeeTone } from "@/lib/states"
import type { MachineState, MachineWithLive } from "@/lib/mock"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MachineCard } from "@/components/oee/machine-card"
import { StateDot } from "@/components/oee/state-badge"

export interface LineGroup {
  id: string
  name: string
  code: string
  areaName: string
  oee: number
  machinesWithData: number
  machines: MachineWithLive[]
}

export interface UnitGroup {
  id: string
  name: string
  location: string
  oee: number
  machinesWithData: number
  machineCount: number
  lines: LineGroup[]
}

function StateCounts({ machines }: { machines: MachineWithLive[] }) {
  const counts = new Map<MachineState, number>()
  for (const m of machines) {
    const s = m.live?.state ?? "NO_COMM"
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
      {STATE_ORDER.filter((s) => counts.get(s)).map((s) => (
        <span key={s} className="inline-flex items-center gap-1 tabular-nums" title={STATE_META[s].label}>
          <StateDot state={s} />
          {counts.get(s)} <span className="hidden sm:inline">{STATE_META[s].short.toLowerCase()}</span>
        </span>
      ))}
    </span>
  )
}

function OeePill({ value, hasData }: { value: number; hasData: boolean }) {
  const tone = hasData ? oeeTone(value) : "none"
  return (
    <span className="inline-flex items-baseline gap-1 rounded-md border bg-background px-2 py-0.5 text-xs">
      <span className="text-muted-foreground">OEE</span>
      <span className={cn("font-semibold tabular-nums", TONE_TEXT[tone])}>{hasData ? pct(value) : "—"}</span>
    </span>
  )
}

/** Máquinas agrupadas por Unidade → Linha, com OEE agregado de cada nível. */
export function MachineGroups({ units, clientSlug }: { units: UnitGroup[]; clientSlug: string }) {
  return (
    <div className="flex flex-col gap-8">
      {units.map((unit) => (
        <section key={unit.id} aria-labelledby={`unit-${unit.id}`} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-3">
            <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Building2Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 id={`unit-${unit.id}`} className="text-base leading-tight font-semibold">
                {unit.name}
              </h2>
              <p className="text-xs text-muted-foreground">
                {unit.location} · {unit.lines.length} {unit.lines.length === 1 ? "linha" : "linhas"} · {unit.machineCount}{" "}
                {unit.machineCount === 1 ? "máquina" : "máquinas"}
              </p>
            </div>
            <div className="ml-auto">
              <OeePill value={unit.oee} hasData={unit.machinesWithData > 0} />
            </div>
          </div>

          {unit.lines.map((line) => (
            <div key={line.id} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h3 className="text-sm font-medium">{line.name}</h3>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {line.code}
                </Badge>
                <span className="text-xs text-muted-foreground">{line.areaName}</span>
                <StateCounts machines={line.machines} />
                <div className="ml-auto flex items-center gap-2">
                  <OeePill value={line.oee} hasData={line.machinesWithData > 0} />
                  <Button asChild variant="ghost" size="xs" className="text-muted-foreground">
                    <Link href={`/${clientSlug}/andon/${line.id}`}>
                      <MonitorIcon />
                      Andon
                    </Link>
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {line.machines.map((m) => (
                  <MachineCard key={m.id} machine={m} clientSlug={clientSlug} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
