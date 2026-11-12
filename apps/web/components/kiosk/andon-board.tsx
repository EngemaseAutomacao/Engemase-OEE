import Link from "next/link"
import { notFound } from "next/navigation"
import { FactoryIcon, LogOutIcon } from "lucide-react"

import {
  DEFAULT_TZ,
  aggregateOee,
  getAreas,
  getClientBySlug,
  getDevice,
  getDowntimeReason,
  getGateway,
  getLine,
  getMachinesWithLive,
  getTimeline,
  getUnit,
  type MachineState,
  type MachineWithLive,
} from "@/lib/mock"
import { ago, duration, num, pct } from "@/lib/format"
import { STATE_META, STATE_ORDER, TONE_TEXT, oeeTone } from "@/lib/states"
import { cn } from "@/lib/utils"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Brand } from "@/components/shell/brand"
import { AndonClock, FullscreenButton } from "@/components/kiosk/andon-live"
import { AndonTile, type AndonTileData } from "@/components/kiosk/andon-tile"
import { currentShift, expectedByNow } from "@/components/kiosk/shift-info"

/** Moldura de tela cheia da TV: tema escuro fixo e altura da tela em telas grandes. */
export function AndonFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark min-h-dvh bg-background text-foreground">
      <div className="flex min-h-dvh flex-col gap-4 p-4 xl:h-dvh xl:gap-[clamp(1rem,1.1vw,1.5rem)] xl:overflow-hidden xl:p-[clamp(1rem,1.3vw,2rem)]">
        {children}
      </div>
    </div>
  )
}

/** Esqueleto exibido enquanto o Andon carrega (navegação no app). */
export function AndonSkeleton() {
  return (
    <AndonFrame>
      <div className="grid shrink-0 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-40 rounded-2xl bg-card xl:h-[clamp(10rem,15vw,16rem)]" />
        ))}
      </div>
      <div className="grid flex-1 gap-4 sm:grid-cols-2 xl:min-h-0 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="min-h-[19rem] rounded-2xl bg-card xl:min-h-0" />
        ))}
      </div>
    </AndonFrame>
  )
}

/** Colunas na TV conforme o número de máquinas (classes completas para o Tailwind). */
const TV_COLS: Record<number, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
}
function tvCols(n: number) {
  if (n <= 4) return TV_COLS[Math.max(1, n)]
  if (n <= 6) return TV_COLS[3]
  if (n <= 8) return TV_COLS[4]
  return TV_COLS[5]
}

function commDetail(m: MachineWithLive): string {
  const gateway = m.gatewayId ? getGateway(m.gatewayId) : undefined
  const device = m.deviceId ? getDevice(m.deviceId) : undefined
  if (!gateway) return "Máquina sem gateway configurado"
  if (gateway.status === "pending") return "Gateway aguardando ativação"
  if (gateway.status === "offline") return `Gateway offline · último sinal ${ago(gateway.lastSeen)}`
  if (!device) return "CLP ainda não configurado no gateway"
  if (device.status === "disabled") return "Leitura do CLP desativada"
  if (device.status === "error") return `CLP sem resposta · ${device.lastError ?? "verifique cabo e endereço"}`
  return "Sem leitura do CLP"
}

/** Conteúdo do Andon de uma linha (lê os params dentro do <Suspense> da página). */
/** `terminal`: aberto por uma TV pareada (/terminal); some o "Sair do modo TV" (não há sessão de pessoa). */
export async function AndonBoard({ params, terminal }: { params: Promise<{ cliente: string; linhaId: string }>; terminal?: { name: string } }) {
  const { cliente, linhaId } = await params
  const client = getClientBySlug(cliente)
  const line = getLine(linhaId)
  if (!client || !line || line.clientId !== client.id) notFound()

  const unit = getUnit(line.unitId)
  const area = getAreas(line.unitId).find((a) => a.id === line.areaId)
  const tz = unit?.timezone ?? DEFAULT_TZ
  const machines = getMachinesWithLive(client.id, { lineId: line.id })
  const shift = currentShift(client.id, line.unitId)
  const agg = aggregateOee(machines)
  const lineOee = agg.machinesWithData > 0 ? agg : null

  const tiles: AndonTileData[] = machines.map((m) => {
    const current = getTimeline(m.id).at(-1)
    const live = m.live
    const sameState = current && live && current.state === live.state
    return {
      machine: m,
      reasonName: sameState ? getDowntimeReason(current.reasonId)?.name : undefined,
      awaitingReason: Boolean(sameState && (live.state === "STOPPED" || live.state === "FAULT") && current.reasonId === null),
      commDetail: live?.state === "NO_COMM" || !live ? commDetail(m) : undefined,
      expected: live && !live.stale ? expectedByNow(live.targetShift, shift) : null,
    }
  })

  // Contagem por estado (para o resumo do topo)
  const byState = new Map<MachineState, number>()
  for (const m of machines) {
    const s = m.live?.state ?? "NO_COMM"
    byState.set(s, (byState.get(s) ?? 0) + 1)
  }

  // Produção da linha (máquinas com dados atualizados)
  const fresh = machines.filter((m) => m.live && !m.live.stale && m.live.countShift > 0)
  const total = fresh.reduce((s, m) => s + m.live!.countShift, 0)
  const reject = fresh.reduce((s, m) => s + m.live!.rejectShift, 0)
  const good = total - reject
  const expectedTotal = tiles.reduce((s, t) => s + (t.expected ?? 0), 0)
  const delta = expectedTotal > 0 ? total - expectedTotal : null

  return (
    <AndonFrame>
        {/* Cabeçalho: linha, OEE da linha, produção, relógio e turno */}
        <header className="grid shrink-0 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)] xl:gap-[clamp(1rem,1.1vw,1.5rem)]">
          <section className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border bg-card p-[clamp(1rem,1.3vw,1.75rem)]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[clamp(0.875rem,1.05vw,1.375rem)] text-muted-foreground">
                <span className="rounded-md bg-primary px-2 py-0.5 font-mono font-bold text-primary-foreground">{line.code}</span>
                <span className="truncate">
                  {client.name} · {unit?.name}
                  {area ? ` · ${area.name}` : ""}
                </span>
              </div>
              <h1 className="mt-2 truncate pb-[0.1em] text-[clamp(2rem,3.3vw,4.5rem)] leading-none font-extrabold tracking-tight">{line.name}</h1>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[clamp(1rem,1.15vw,1.5rem)] font-semibold">
              {STATE_ORDER.filter((s) => byState.has(s)).map((s) => (
                <li key={s} className="inline-flex items-center gap-2">
                  <span
                    className={cn(
                      "size-[0.8em] rounded-full",
                      STATE_META[s].bg,
                      s === "NO_COMM" && "bg-stripes",
                      s === "FAULT" && "animate-pulse",
                    )}
                  />
                  <span className="tabular-nums">{byState.get(s)}</span>
                  <span className="font-medium text-muted-foreground">{STATE_META[s].short.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border bg-card p-[clamp(1rem,1.3vw,1.75rem)]">
            <h2 className="text-[clamp(0.875rem,0.95vw,1.25rem)] font-bold tracking-[0.18em] text-muted-foreground uppercase">OEE da linha</h2>
            <div
              className={cn(
                "text-[clamp(4rem,6.4vw,9rem)] leading-none font-black tracking-tight tabular-nums",
                TONE_TEXT[oeeTone(lineOee?.oee)],
              )}
            >
              {lineOee ? pct(lineOee.oee, 0) : "—"}
            </div>
            <dl className="grid grid-cols-3 gap-2 text-[clamp(0.875rem,0.95vw,1.25rem)]">
              {(
                [
                  ["Disp.", lineOee?.availability],
                  ["Perf.", lineOee?.performance],
                  ["Qual.", lineOee?.quality],
                ] as const
              ).map(([label, v]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className={cn("text-[clamp(1.25rem,1.7vw,2.5rem)] leading-tight font-bold tabular-nums", TONE_TEXT[oeeTone(v)])}>
                    {pct(v, 0)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border bg-card p-[clamp(1rem,1.3vw,1.75rem)]">
            <h2 className="text-[clamp(0.875rem,0.95vw,1.25rem)] font-bold tracking-[0.18em] text-muted-foreground uppercase">Peças boas no turno</h2>
            <div className="text-[clamp(3rem,4.6vw,6.5rem)] leading-none font-black tracking-tight tabular-nums">
              {fresh.length > 0 ? num(good) : "—"}
            </div>
            <dl className="grid grid-cols-2 gap-2 text-[clamp(0.875rem,0.95vw,1.25rem)]">
              <div>
                <dt className="text-muted-foreground">Refugo</dt>
                <dd className="text-[clamp(1.25rem,1.7vw,2.5rem)] leading-tight font-bold tabular-nums">
                  {fresh.length > 0 ? num(reject) : "—"}
                  {total > 0 && <span className="ml-1.5 text-[0.6em] font-semibold text-muted-foreground">{pct(reject / total, 1)}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ritmo da meta</dt>
                <dd
                  className={cn(
                    "text-[clamp(1.25rem,1.7vw,2.5rem)] leading-tight font-bold tabular-nums",
                    delta === null ? "text-muted-foreground" : delta >= 0 ? "text-state-running" : "text-state-stopped",
                  )}
                >
                  {delta === null ? "—" : delta >= 0 ? `+${num(delta)}` : `−${num(-delta)}`}
                </dd>
              </div>
            </dl>
          </section>

          <section className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border bg-card p-[clamp(1rem,1.3vw,1.75rem)]">
            <AndonClock timeZone={tz} />
            {shift ? (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[clamp(1rem,1.1vw,1.5rem)]">
                  <span className="font-bold whitespace-nowrap">
                    {shift.name} <span className="font-medium text-muted-foreground tabular-nums">{shift.start}–{shift.end}</span>
                  </span>
                  <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {shift.onBreak ? shift.onBreak : `restam ${duration(shift.remainingMin * 60)}`}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(shift.progress * 100)}%` }} />
                </div>
              </div>
            ) : (
              <div className="text-[clamp(1rem,1.15vw,1.5rem)] font-semibold text-muted-foreground">Fora do horário de turno</div>
            )}
          </section>
        </header>

        {/* Tiles das máquinas */}
        {tiles.length === 0 ? (
          <Empty className="flex-1 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FactoryIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhuma máquina nesta linha</EmptyTitle>
              <EmptyDescription>Cadastre máquinas na linha {line.name} para que elas apareçam no Andon.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <main
            className={cn(
              "grid flex-1 gap-4 xl:min-h-0 xl:auto-rows-fr xl:gap-[clamp(1rem,1.1vw,1.5rem)]",
              tiles.length > 1 && "sm:grid-cols-2",
              tvCols(tiles.length),
            )}
          >
            {tiles.map((t) => (
              <AndonTile key={t.machine.id} data={t} />
            ))}
          </main>
        )}

        {/* Rodapé: legenda */}
        <footer className="flex shrink-0 flex-col gap-3 border-t pt-3 lg:flex-row lg:items-center lg:justify-between xl:pt-[clamp(0.75rem,0.9vw,1.25rem)]">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[clamp(0.875rem,1vw,1.375rem)] font-medium">
            {STATE_ORDER.map((s) => (
              <li key={s} className="inline-flex items-center gap-2">
                <span className={cn("size-[1em] rounded", STATE_META[s].bg, s === "NO_COMM" && "bg-stripes")} />
                {STATE_META[s].label}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 text-[clamp(0.75rem,0.85vw,1.125rem)] text-muted-foreground lg:shrink-0">
            <span className="hidden 2xl:inline">Marcador na barra = ritmo esperado para a meta</span>
            <Brand className="hidden text-foreground md:flex" />
            <FullscreenButton />
            {terminal ? (
              <span className="inline-flex h-10 items-center rounded-lg border px-3 text-sm font-medium">{terminal.name}</span>
            ) : (
              <Link
                href={`/${client.slug}`}
                className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-foreground"
              >
                <LogOutIcon className="size-4" />
                Sair do modo TV
              </Link>
            )}
          </div>
        </footer>
    </AndonFrame>
  )
}
