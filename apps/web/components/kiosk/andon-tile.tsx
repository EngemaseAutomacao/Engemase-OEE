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

  // Em tiles baixos (TV com 2 fileiras de máquinas) some o que é secundário.
  const secondary = "[@container(max-height:26rem)]:hidden"

  return (
    <article
      aria-label={`${machine.name}: ${STATE_META[state].label}`}
      className={cn(
        "@container relative flex min-h-[19rem] [--u:min(1cqw,0.72cqh)] flex-col justify-between gap-[clamp(0.5rem,calc(2.4*var(--u)),1.5rem)] overflow-hidden rounded-2xl p-[clamp(1rem,1.4vw,2rem)] shadow-lg xl:min-h-0 xl:[container-type:size]",
        STATE_META[state].bg,
        STATE_ON[state],
        state === "NO_COMM" && "bg-stripes",
      )}
    >
      {state === "FAULT" && (
        <span aria-hidden className="pointer-events-none absolute inset-0 animate-pulse rounded-2xl border-[6px] border-white/90" />
      )}

      <div className="grid gap-[clamp(0.5rem,calc(3*var(--u)),1.75rem)]">
        <header className="min-w-0">
          <h2 className="truncate pb-[0.08em] text-[clamp(1.5rem,calc(12*var(--u)),5.5rem)] leading-none font-extrabold tracking-tight">{machine.name}</h2>
          <p className={cn("mt-[0.35em] truncate text-[clamp(0.875rem,calc(4.4*var(--u)),2rem)] font-semibold opacity-75", secondary)}>
            {machine.code} · {machine.type}
          </p>
        </header>

        <div className="rounded-xl bg-black/15 px-[clamp(0.75rem,calc(3.4*var(--u)),1.75rem)] py-[clamp(0.5rem,calc(3*var(--u)),1.5rem)]">
          <div className="flex items-center gap-[clamp(0.5rem,calc(3*var(--u)),1.5rem)]">
            <Icon className="size-[clamp(1.75rem,calc(13*var(--u)),6rem)] shrink-0" strokeWidth={2.4} aria-hidden />
            <div className="min-w-0">
              <div className="text-[clamp(1.25rem,calc(10*var(--u)),4.5rem)] leading-[0.95] font-black text-balance uppercase">{TV_LABEL[state]}</div>
              <div className="mt-[0.3em] text-[clamp(0.875rem,calc(7*var(--u)),3.25rem)] leading-none font-bold">
                {live && !noData ? <LiveSince since={live.stateSince} /> : "Aguardando dados"}
              </div>
            </div>
          </div>
          {detail && (
            <div className="mt-[clamp(0.375rem,calc(2.4*var(--u)),1rem)] line-clamp-2 text-[clamp(0.875rem,calc(5.2*var(--u)),2.25rem)] leading-tight font-semibold [@container(max-height:26rem)]:line-clamp-1">
              {detail}
            </div>
          )}
        </div>
      </div>

      {noData ? (
        <div className="flex items-center gap-3 text-[clamp(0.875rem,calc(5.4*var(--u)),2.25rem)] font-semibold opacity-85">
          <HourglassIcon className="size-[1.25em] shrink-0" aria-hidden />
          Aguardando os primeiros dados do gateway
        </div>
      ) : (
        <div className="grid gap-[clamp(0.375rem,calc(2*var(--u)),1rem)]">
          <div className={cn("truncate text-[clamp(0.875rem,calc(5*var(--u)),2.25rem)] font-semibold opacity-90", secondary)}>
            {live!.productName}
            <span className="font-medium opacity-70"> · {live!.productCode}</span>
          </div>
          <div className="flex items-end justify-between gap-3 leading-none tabular-nums">
            <div className="min-w-0">
              <div className="text-[clamp(0.75rem,calc(3.6*var(--u)),1.5rem)] font-bold tracking-[0.15em] uppercase opacity-75">Produção</div>
              <div className="mt-[0.2em] text-[clamp(1.5rem,calc(15*var(--u)),6.5rem)] font-black tracking-tight">{num(live!.countShift)}</div>
              <div className="mt-[0.25em] text-[clamp(0.875rem,calc(5*var(--u)),2.25rem)] font-bold opacity-75">de {num(live!.targetShift)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[clamp(0.75rem,calc(3.6*var(--u)),1.5rem)] font-bold tracking-[0.15em] uppercase opacity-75">OEE</div>
              <div className="mt-[0.2em] text-[clamp(1.5rem,calc(15*var(--u)),6.5rem)] font-black tracking-tight">
                {showOee ? pct(live!.shift.oee, 0) : "—"}
              </div>
              <div className={cn("mt-[0.25em] text-[clamp(0.75rem,calc(4*var(--u)),1.75rem)] font-bold opacity-75", !showOee && "invisible")}>
                D {pct(live!.shift.availability, 0)} · P {pct(live!.shift.performance, 0)} · Q {pct(live!.shift.quality, 0)}
              </div>
            </div>
          </div>
          <div className="relative py-[clamp(0.25rem,calc(1.2*var(--u)),0.5rem)]">
            <div className="h-[clamp(0.5rem,calc(3.4*var(--u)),1.5rem)] overflow-hidden rounded-full bg-black/20">
              <div className="h-full rounded-full bg-current" style={{ width: `${progress}%` }} />
            </div>
            {expectedPct !== null && (
              <div
                aria-hidden
                className="absolute inset-y-0 w-[clamp(3px,calc(0.9*var(--u)),6px)] -translate-x-1/2 rounded-full bg-current opacity-80"
                style={{ left: `${expectedPct}%` }}
              />
            )}
          </div>
          <div className="text-[clamp(0.75rem,calc(4.6*var(--u)),2rem)] leading-tight font-bold tabular-nums">
            {live!.stale
              ? `Dados até ${time(live!.lastUpdate)}`
              : delta === null
                ? `${pct(progress / 100, 0)} da meta do turno`
                : delta >= 0
                  ? `À frente do ritmo: +${num(delta)} peças`
                  : `Atrás do ritmo: −${num(-delta)} peças`}
          </div>
        </div>
      )}
    </article>
  )
}
