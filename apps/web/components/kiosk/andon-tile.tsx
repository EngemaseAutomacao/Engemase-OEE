import { HourglassIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { num, pct, time } from "@/lib/format"
import { STATE_META } from "@/lib/states"
import type { MachineState, MachineWithLive } from "@/lib/mock"
import { LiveSince } from "@/components/kiosk/andon-live"
import { STATE_ICON, STATE_ON } from "@/components/kiosk/state-style"

/** Rótulos curtos e legíveis a distância. */
const TV_LABEL: Record<MachineState, string> = {
  RUNNING: "Produzindo",
  STOPPED: "Parada",
  FAULT: "Falha",
  SETUP: "Setup",
  PLANNED_STOP: "Parada planejada",
  NO_COMM: "Sem comunicação",
}

export interface AndonTileData {
  machine: MachineWithLive
  /** Motivo já apontado para o estado atual (setup, parada planejada...). */
  reasonName?: string
  /** Parada/falha atual ainda sem motivo apontado pelo operador. */
  awaitingReason: boolean
  /** Explicação da falta de comunicação (gateway offline, CLP sem resposta...). */
  commDetail?: string
  /** Peças esperadas até agora para cumprir a meta do turno. */
  expected: number | null
}

/**
 * Tile de máquina para a TV/Andon: fundo na cor do estado, textos que escalam com a largura
 * do tile (container queries), contagem × meta com marcador de ritmo esperado.
 */
export function AndonTile({ data }: { data: AndonTileData }) {
  const { machine, reasonName, awaitingReason, commDetail, expected } = data
  const live = machine.live
  const state: MachineState = live?.state ?? "NO_COMM"
  const Icon = STATE_ICON[state]
  const noData = !live || (live.stale && live.countShift === 0)
  const showOee = Boolean(live && !live.stale && live.countShift > 0)
  const progress = live && live.targetShift > 0 ? Math.min(100, (live.countShift / live.targetShift) * 100) : 0
  const expectedPct = live && expected !== null && live.targetShift > 0 ? Math.min(100, (expected / live.targetShift) * 100) : null
  const delta = live && expected !== null && !live.stale ? live.countShift - expected : null

  let detail: React.ReactNode = null
  if (state === "FAULT") {
    detail = live?.faultCode !== undefined ? `F${live.faultCode} · ${live.faultText ?? "Alarme do CLP"}` : "Alarme ativo no CLP"
  } else if (state === "NO_COMM") {
    detail = commDetail ?? "Sem comunicação com o CLP"
  } else if (awaitingReason) {
    detail = "Aguardando motivo do operador"
  } else if (reasonName && state !== "RUNNING") {
    detail = reasonName
  }

  return (
    <article
      aria-label={`${machine.name}: ${STATE_META[state].label}`}
      className={cn(
        "@container relative flex min-h-[19rem] flex-col justify-between gap-[clamp(0.5rem,2.6cqmin,1.5rem)] overflow-hidden rounded-2xl p-[clamp(1rem,1.4vw,2rem)] shadow-lg xl:min-h-0 xl:[container-type:size]",
        STATE_META[state].bg,
        STATE_ON[state],
        state === "NO_COMM" && "bg-stripes",
      )}
    >
      {state === "FAULT" && (
        <span aria-hidden className="pointer-events-none absolute inset-0 animate-pulse rounded-2xl border-[6px] border-white/90" />
      )}

      <div className="grid gap-[clamp(0.5rem,3cqmin,1.75rem)]">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[clamp(1.5rem,10cqmin,4.75rem)] leading-none font-extrabold tracking-tight">{machine.name}</h2>
            <p className="mt-[0.4em] truncate text-[clamp(0.875rem,4cqmin,1.75rem)] font-semibold opacity-75">
              {machine.code} · {machine.type}
            </p>
          </div>
          <div className="shrink-0 text-right leading-none">
            <div className="text-[clamp(1.75rem,14cqmin,6.5rem)] font-black tracking-tight tabular-nums">
              {showOee ? pct(live!.shift.oee, 0) : "—"}
            </div>
            <div className="mt-1 text-[clamp(0.75rem,3.4cqmin,1.5rem)] font-bold tracking-[0.2em] opacity-75">OEE</div>
          </div>
        </header>

        <div className="rounded-xl bg-black/15 px-[clamp(0.75rem,3.4cqmin,1.75rem)] py-[clamp(0.5rem,3cqmin,1.5rem)]">
          <div className="flex items-center gap-[clamp(0.5rem,2.6cqmin,1.5rem)]">
            <Icon className="size-[clamp(1.75rem,11cqmin,5rem)] shrink-0" strokeWidth={2.4} aria-hidden />
            <div className="min-w-0">
              <div className="text-[clamp(1.25rem,8cqmin,3.75rem)] leading-[0.95] font-black text-balance uppercase">{TV_LABEL[state]}</div>
              <div className="mt-[0.3em] text-[clamp(0.875rem,6cqmin,2.75rem)] leading-none font-bold">
                {live && !noData ? <LiveSince since={live.stateSince} /> : "Aguardando dados"}
              </div>
            </div>
          </div>
          {detail && (
            <div className="mt-[clamp(0.375rem,2.2cqmin,1rem)] line-clamp-2 text-[clamp(0.875rem,4.6cqmin,2rem)] leading-tight font-semibold">
              {detail}
            </div>
          )}
        </div>
      </div>

      {noData ? (
        <div className="flex items-center gap-3 text-[clamp(0.875rem,5cqmin,2rem)] font-semibold opacity-85">
          <HourglassIcon className="size-[1.25em] shrink-0" aria-hidden />
          Aguardando os primeiros dados do gateway
        </div>
      ) : (
        <div className="grid gap-[clamp(0.375rem,2cqmin,1rem)]">
          <div className="truncate text-[clamp(0.875rem,4.8cqmin,2rem)] font-semibold opacity-90">
            {live!.productName}
            <span className="font-medium opacity-70"> · {live!.productCode}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 leading-none tabular-nums">
            <span className="text-[clamp(1.5rem,12cqmin,5.5rem)] font-extrabold">{num(live!.countShift)}</span>
            <span className="text-[clamp(0.875rem,5.4cqmin,2.25rem)] font-bold opacity-75">meta {num(live!.targetShift)}</span>
          </div>
          <div className="relative py-1.5">
            <div className="h-[clamp(0.5rem,3cqmin,1.5rem)] overflow-hidden rounded-full bg-black/20">
              <div className="h-full rounded-full bg-current" style={{ width: `${progress}%` }} />
            </div>
            {expectedPct !== null && (
              <div
                aria-hidden
                className="absolute inset-y-0 w-1 -translate-x-1/2 rounded-full bg-current opacity-80"
                style={{ left: `${expectedPct}%` }}
              />
            )}
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[clamp(0.75rem,4cqmin,1.75rem)] font-semibold tabular-nums">
            <span>
              {live!.stale
                ? `Dados até ${time(live!.lastUpdate)}`
                : delta === null
                  ? `${pct(progress / 100, 0)} da meta`
                  : delta >= 0
                    ? `À frente do ritmo: +${num(delta)}`
                    : `Atrás do ritmo: −${num(-delta)}`}
            </span>
            {showOee && (
              <span className="opacity-75">
                D {pct(live!.shift.availability, 0)} · P {pct(live!.shift.performance, 0)} · Q {pct(live!.shift.quality, 0)}
              </span>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
