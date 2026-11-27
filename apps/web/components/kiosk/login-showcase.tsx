import { CogIcon, TimerIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { LiveCard, delay } from "@/components/account/auth-card"

/*
 * "Telas ao vivo" do painel de marca do login: anel do OEE enchendo e número contando, máquina produzindo
 * com a luz pulsando e o ciclo andando, e um gráfico de barras crescendo. Só CSS (app/(auth)/auth.css).
 * Valores ilustrativos (não pertencem a nenhum cliente): a tela de login não expõe dados de tenants.
 */

const OEE = 78
const FACTORS = [
  { label: "Disponibilidade", value: 89, color: "#7cc0ec" },
  { label: "Performance", value: 92, color: "#5fd4a6" },
  { label: "Qualidade", value: 96, color: "#f3a28f" },
] as const
/** Peças por hora no turno (% da meta). */
const BARS = [62, 74, 81, 58, 86, 90, 84, 92, 79, 88] as const
const GOAL = 80

function Num({ value, at }: { value: number; at: number }) {
  return <span className="au-num au-count" style={{ ["--au-n" as string]: value, ...delay(at) }} />
}

/** Composição de cartões ao vivo (decorativa: `aria-hidden`). */
export function LoginShowcase({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("relative grid w-full max-w-xl grid-cols-2 gap-4", className)}>
      {/* OEE do turno */}
      <div className="au-card-in row-span-2" style={delay(0.3)}>
        <LiveCard className="au-float h-full p-5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-white/60">OEE do turno</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2 py-0.5 text-white/70">
              <span className="relative flex size-1.5">
                <span className="au-ping absolute inline-flex size-full rounded-full bg-[var(--state-running)]" />
                <span className="relative inline-flex size-1.5 rounded-full bg-[var(--state-running)]" />
              </span>
              ao vivo
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold">Linha de injeção A</p>
          <div className="relative mx-auto mt-4 size-32">
            <svg viewBox="0 0 100 100" className="size-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgb(255 255 255 / 10%)" strokeWidth="9" />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="var(--state-running)"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray="264"
                strokeDashoffset={Math.round(264 * (1 - OEE / 100))}
                className="au-ring"
                style={delay(0.55)}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-3xl font-bold tabular-nums">
              <Num value={OEE} at={0.55} />%
            </span>
          </div>
          <ul className="mt-4 grid gap-2.5">
            {FACTORS.map((f, i) => (
              <li key={f.label} className="text-xs">
                <div className="flex justify-between text-white/70">
                  <span>{f.label}</span>
                  <span className="font-semibold text-white tabular-nums">
                    <Num value={f.value} at={0.7 + i * 0.1} />%
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-white/10">
                  <div className="au-meter h-full rounded-full" style={{ width: `${f.value}%`, background: f.color, ...delay(0.7 + i * 0.1) }} />
                </div>
              </li>
            ))}
          </ul>
        </LiveCard>
      </div>

      {/* Máquina produzindo */}
      <div className="au-card-in" style={delay(0.42)}>
        <LiveCard className="au-float-2">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--state-running)]/15 text-[var(--state-running)]">
              <CogIcon className="au-spin size-5" />
            </span>
            <div className="min-w-0 text-sm leading-tight">
              <p className="font-semibold">Injetora 03</p>
              <p className="text-white/60">
                Produzindo <span className="whitespace-nowrap">· 6 s/ciclo</span>
              </p>
            </div>
            <span className="relative ml-auto flex size-2.5 shrink-0">
              <span className="au-ping absolute inline-flex size-full rounded-full bg-[var(--state-running)]" />
              <span className="relative inline-flex size-2.5 rounded-full bg-[var(--state-running)]" />
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="au-cycle-bar h-full rounded-full bg-[var(--state-running)]" />
          </div>
          <div className="mt-3 flex justify-between text-xs text-white/60">
            <span>
              Peças boas <span className="font-semibold text-white tabular-nums">1.248</span>
            </span>
            <span>
              Refugo <span className="font-semibold text-white tabular-nums">0,4%</span>
            </span>
          </div>
        </LiveCard>
      </div>

      {/* Produção por hora */}
      <div className="au-card-in" style={delay(0.54)}>
        <LiveCard className="au-float-3">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold text-white">Produção por hora</span>
            <span className="text-white/60">meta {GOAL}%</span>
          </div>
          <div className="relative mt-3 flex h-20 items-end gap-1.5">
            <span className="absolute inset-x-0 border-t border-dashed border-white/30" style={{ bottom: `${GOAL}%` }} />
            {BARS.map((h, i) => (
              <span
                key={i}
                className="au-bar flex-1 rounded-t-[3px]"
                style={{ height: `${h}%`, background: h >= GOAL ? "#4a9fd6" : "rgb(74 159 214 / 45%)", ...delay(0.75 + i * 0.06) }}
              />
            ))}
          </div>
        </LiveCard>
      </div>

      {/* Parada classificada */}
      <div className="au-card-in absolute -bottom-9 left-[30%] hidden [@media(min-height:880px)]:xl:block" style={delay(0.8)}>
        <LiveCard className="au-float-2 flex items-center gap-3 px-3.5 py-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--state-stopped)]/20 text-[var(--state-stopped)]">
            <TimerIcon className="size-4" />
          </span>
          <div className="text-xs leading-tight">
            <p className="font-semibold">Parada classificada</p>
            <p className="text-white/60">Falta de material · 14 min</p>
          </div>
        </LiveCard>
      </div>
    </div>
  )
}
