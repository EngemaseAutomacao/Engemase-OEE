import { cn } from "@/lib/utils"
import { pct } from "@/lib/format"
import { STATE_META, TONE_TEXT, oeeTone } from "@/lib/states"
import type { MachineState } from "@/lib/mock"
import { OeeBreakdown } from "@/components/oee/oee-breakdown"
import { OeeRing } from "@/components/oee/oee-ring"
import { StateDot } from "@/components/oee/state-badge"

/** Valores ilustrativos (não pertencem a nenhum cliente): a tela de login não expõe dados de tenants. */
const SAMPLE: { name: string; state: MachineState; detail: string; oee: number | null }[] = [
  { name: "Injetora 01", state: "RUNNING", detail: "há 1h 12min", oee: 0.86 },
  { name: "Prensa 02", state: "FAULT", detail: "Sobrecarga do motor · 7 min", oee: 0.61 },
  { name: "Sopradora 02", state: "SETUP", detail: "Troca de molde · 26 min", oee: 0.72 },
]

/** Prévia estilizada de um painel ao vivo, para o painel de marca do login. */
export function LoginShowcase({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card/80 p-4 shadow-lg backdrop-blur", className)} aria-hidden>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Linha de injeção · turno atual</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-state-running" />
          ao vivo
        </span>
      </div>
      <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-5">
        <OeeRing value={0.784} size={84} stroke={9} />
        <OeeBreakdown values={{ availability: 0.89, performance: 0.92, quality: 0.958, oee: 0.784 }} />
      </div>
      <ul className="mt-4 grid gap-2 border-t pt-3">
        {SAMPLE.map((m) => (
          <li key={m.name} className="flex items-center gap-3 text-sm">
            <StateDot state={m.state} pulse={m.state === "FAULT"} />
            <span className="w-28 shrink-0 font-medium">{m.name}</span>
            <span className={cn("min-w-0 flex-1 truncate text-xs", STATE_META[m.state].text)}>
              {STATE_META[m.state].short} · {m.detail}
            </span>
            <span className={cn("text-xs font-semibold tabular-nums", TONE_TEXT[oeeTone(m.oee)])}>{pct(m.oee, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
