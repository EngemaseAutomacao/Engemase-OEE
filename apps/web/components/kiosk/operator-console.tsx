"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import type { LucideIcon } from "lucide-react"
import {
  ArrowLeftRightIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  HistoryIcon,
  InfoIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  LogOutIcon,
  PackageXIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { dec, duration, num, pct, time } from "@/lib/format"
import { STATE_META } from "@/lib/states"
import type { MachineState } from "@/lib/mock"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { OeeBreakdown } from "@/components/oee/oee-breakdown"
import { OeeRing } from "@/components/oee/oee-ring"
import { KioskThemeToggle } from "@/components/kiosk/kiosk-theme-toggle"
import type { OperatorData, PendingStop, ProductOption } from "@/components/kiosk/operator-types"
import { ProductDialog } from "@/components/kiosk/product-dialog"
import { ReasonPicker, type PickedReason } from "@/components/kiosk/reason-picker"
import { RejectDialog } from "@/components/kiosk/reject-dialog"
import { STATE_ICON, STATE_ON } from "@/components/kiosk/state-style"
import { useMockClock } from "@/components/kiosk/use-mock-clock"

interface LogEntry {
  id: string
  at: number
  kind: "stop" | "reject" | "product"
  title: string
  detail: string
}

const LOG_ICON: Record<LogEntry["kind"], LucideIcon> = {
  stop: ClipboardCheckIcon,
  reject: PackageXIcon,
  product: ArrowLeftRightIcon,
}

const sortStops = (list: PendingStop[]) =>
  [...list].sort((a, b) => Number(b.ongoing) - Number(a.ongoing) || b.start.localeCompare(a.start))

const seconds = (s: number) => `${Number.isInteger(s) ? num(s) : dec(s)} s`

const pieces = (n: number) => `${num(n)} ${n === 1 ? "peça" : "peças"}`

/** Tela do operador (tablet/celular): estado ao vivo, paradas a classificar, refugo e troca de produto. */
export function OperatorConsole({ data, panelHref }: { data: OperatorData; panelHref: string }) {
  const { machine, live, shift, reasons, products, operator, timeZone } = data
  const { now, read } = useMockClock(10_000)
  const seq = useRef(0)

  const [pending, setPending] = useState<PendingStop[]>(() => sortStops(data.pendingStops))
  const [classified, setClassified] = useState<Record<string, string>>({})
  const [rejectAdded, setRejectAdded] = useState(0)
  const [product, setProduct] = useState(() =>
    live && live.productCode !== "—"
      ? {
          code: live.productCode,
          name: live.productName,
          idealCycleS: products.find((p) => p.code === live.productCode)?.idealCycleS ?? machine.idealCycleS,
        }
      : null,
  )
  const [log, setLog] = useState<LogEntry[]>([])
  const [pickStop, setPickStop] = useState<PendingStop | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [productOpen, setProductOpen] = useState(false)

  const state: MachineState = live?.state ?? "NO_COMM"
  const meta = STATE_META[state]
  const StateIcon = STATE_ICON[state]
  const hasData = Boolean(live && live.countShift > 0)
  const ongoingId = data.pendingStops.find((p) => p.ongoing)?.id ?? null
  const ongoingPending = pending.find((p) => p.ongoing) ?? null
  const ongoingLabel = ongoingId ? classified[ongoingId] : undefined

  // Produção e qualidade (recalculada com o refugo lançado aqui)
  const count = live?.countShift ?? 0
  const target = live?.targetShift ?? 0
  const rejectTotal = (live?.rejectShift ?? 0) + rejectAdded
  const good = Math.max(0, count - rejectTotal)
  const progress = target > 0 ? Math.min(100, (count / target) * 100) : 0
  const expected = shift && target > 0 && live && !live.stale ? Math.round(target * shift.plannedProgress) : null
  const expectedPct = expected !== null && target > 0 ? Math.min(100, (expected / target) * 100) : null
  const delta = expected !== null ? count - expected : null
  const oeeValues =
    live && hasData && !live.stale
      ? (() => {
          const quality = count > 0 ? good / count : live.shift.quality
          return { ...live.shift, quality, oee: live.shift.availability * live.shift.performance * quality }
        })()
      : null

  const nextId = (prefix: string) => `${prefix}-${++seq.current}`
  const addLog = (entry: LogEntry) => setLog((l) => [entry, ...l])
  const removeLog = (id: string) => setLog((l) => l.filter((e) => e.id !== id))

  function classify(stop: PendingStop, picked: PickedReason) {
    const label = picked.group ? `${picked.group.name} › ${picked.reason.name}` : picked.reason.name
    const end = stop.ongoing ? read() : Date.parse(stop.end)
    const dur = duration((end - Date.parse(stop.start)) / 1000)
    const id = nextId("stop")
    setPending((list) => list.filter((s) => s.id !== stop.id))
    setClassified((c) => ({ ...c, [stop.id]: label }))
    addLog({ id, at: read(), kind: "stop", title: `Parada de ${dur} classificada`, detail: label })
    setPickStop(null)
    toast.success("Parada classificada", {
      description: `${label} · ${dur}`,
      action: {
        label: "Desfazer",
        onClick: () => {
          setPending((list) => sortStops([...list.filter((s) => s.id !== stop.id), stop]))
          setClassified((c) => {
            const next = { ...c }
            delete next[stop.id]
            return next
          })
          removeLog(id)
        },
      },
    })
  }

  function launchReject(qty: number, defect: string | null) {
    const id = nextId("reject")
    setRejectAdded((r) => r + qty)
    setRejectOpen(false)
    addLog({ id, at: read(), kind: "reject", title: `${pieces(qty)} de refugo`, detail: defect ?? "Tipo de defeito não informado" })
    toast.success(`Refugo lançado: ${pieces(qty)}`, {
      description: `${machine.name}${defect ? ` · ${defect}` : ""}`,
      action: {
        label: "Desfazer",
        onClick: () => {
          setRejectAdded((r) => r - qty)
          removeLog(id)
        },
      },
    })
  }

  function changeProduct(p: ProductOption) {
    const previous = product
    const id = nextId("product")
    setProduct({ code: p.code, name: p.name, idealCycleS: p.idealCycleS })
    setProductOpen(false)
    addLog({ id, at: read(), kind: "product", title: "Troca de produto", detail: `${previous ? `${previous.code} → ` : ""}${p.code} · ${p.name}` })
    toast.success("Produto alterado", {
      description: `Agora em produção: ${p.name} (${p.code})`,
      action: {
        label: "Desfazer",
        onClick: () => {
          setProduct(previous)
          removeLog(id)
        },
      },
    })
  }

  // Linha de detalhe da faixa de estado
  let stateDetail: string | null = null
  if (state === "FAULT") {
    stateDetail = `${live?.faultCode !== undefined ? `F${live.faultCode} · ${live.faultText ?? "Alarme do CLP"}` : "Alarme ativo no CLP"}${ongoingLabel ? ` · Motivo: ${ongoingLabel}` : ""}`
  } else if (state === "STOPPED") {
    stateDetail = ongoingLabel ? `Motivo: ${ongoingLabel}` : ongoingPending ? "Sem motivo apontado" : null
  } else if (state === "NO_COMM") {
    stateDetail = `${data.commDetail ?? "Sem leitura do CLP"} · avise a manutenção`
  } else if (data.currentReasonName) {
    stateDetail = `Motivo: ${data.currentReasonName}`
  } else if (product) {
    stateDetail = `Produto: ${product.name}`
  }

  const nowIso = new Date(now).toISOString()

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-2.5 sm:gap-3 md:px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground sm:text-sm">
              {machine.lineName} · {machine.unitName}
            </p>
            <h1 className="truncate text-2xl leading-tight font-bold tracking-tight md:text-3xl">
              {machine.name}
              <span className="ml-2 align-middle text-sm font-medium text-muted-foreground md:text-base">{machine.code}</span>
            </h1>
            <p className="truncate text-xs text-muted-foreground sm:hidden">
              {shift ? `${shift.name} · ${shift.start}–${shift.end}` : "Fora do horário de turno"} · {time(nowIso, timeZone)}
            </p>
          </div>

          <div className="hidden shrink-0 text-right sm:block">
            <div className="text-2xl leading-tight font-bold tabular-nums" suppressHydrationWarning>
              {time(nowIso, timeZone)}
            </div>
            <div className="text-xs text-muted-foreground">
              {shift ? (
                <>
                  {shift.name} · {shift.start}–{shift.end}
                  <span className="hidden md:inline"> · {shift.onBreak ?? `restam ${duration(shift.remainingMin * 60)}`}</span>
                </>
              ) : (
                "Fora do horário de turno"
              )}
            </div>
          </div>

          <div className="hidden items-center gap-2 border-l pl-3 lg:flex">
            <Avatar className="size-10">
              <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">{operator.initials}</AvatarFallback>
            </Avatar>
            <div className="grid max-w-40 leading-tight">
              <span className="truncate text-sm font-medium">{operator.name}</span>
              <span className="truncate text-xs text-muted-foreground">{operator.username ?? "Operador"}</span>
            </div>
          </div>

          <Link
            href={panelHref}
            aria-label="Abrir o painel da máquina"
            className="hidden size-12 shrink-0 items-center justify-center rounded-xl border bg-card transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none md:inline-flex"
          >
            <LayoutDashboardIcon className="size-5" />
          </Link>
          <KioskThemeToggle />
          <Link
            href="/login"
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl border bg-card px-3 font-medium transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:px-4"
          >
            <LogOutIcon className="size-5" />
            <span className="hidden sm:inline">Sair</span>
            <span className="sr-only sm:hidden">Sair</span>
          </Link>
        </div>

        {/* Faixa de estado ao vivo */}
        <div className={cn(meta.bg, STATE_ON[state], state === "NO_COMM" && "bg-stripes")} role="status" aria-live="polite">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-6">
            <StateIcon className="size-9 shrink-0" strokeWidth={2.4} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-xl font-black tracking-tight uppercase md:text-2xl">{meta.label}</span>
                {live && hasData && (
                  <span className="text-lg font-bold tabular-nums md:text-xl" suppressHydrationWarning>
                    há {duration((now - Date.parse(live.stateSince)) / 1000)}
                  </span>
                )}
              </div>
              {stateDetail && <div className="truncate text-sm font-semibold opacity-90 md:text-base">{stateDetail}</div>}
            </div>
            {ongoingPending && (
              <button
                type="button"
                onClick={() => setPickStop(ongoingPending)}
                className="inline-flex h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 text-base font-semibold text-white shadow-md transition-transform active:scale-[0.98] sm:w-auto"
              >
                Classificar esta parada
                <ChevronRightIcon className="size-5" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 md:gap-5 md:p-6">
        {/* Indicadores do turno */}
        <section className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4" aria-label="Indicadores do turno">
          <Kpi label="Produção do turno">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl leading-none font-bold tabular-nums md:text-4xl">{hasData ? num(count) : "—"}</span>
              <span className="text-sm text-muted-foreground tabular-nums">/ {num(target)}</span>
            </div>
            <div className="relative py-1">
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
              {expectedPct !== null && (
                <div
                  aria-hidden
                  className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
                  style={{ left: `${expectedPct}%` }}
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {live?.stale
                ? hasData
                  ? `Dados até ${time(live.lastUpdate, timeZone)}`
                  : "Aguardando dados do gateway"
                : delta === null
                  ? `${pct(progress / 100, 0)} da meta`
                  : delta >= 0
                    ? `À frente do ritmo: +${num(delta)}`
                    : `Atrás do ritmo: −${num(-delta)} (esperado ${num(expected)})`}
            </p>
          </Kpi>

          <Kpi label="Refugo">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl leading-none font-bold tabular-nums md:text-4xl">{hasData ? num(rejectTotal) : "—"}</span>
              {count > 0 && <span className="text-sm text-muted-foreground tabular-nums">{pct(rejectTotal / count, 1)}</span>}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {num(live?.rejectShift ?? 0)} do CLP
              {rejectAdded > 0 && <span className="font-medium text-foreground"> + {num(rejectAdded)} lançadas</span>}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">Boas: {num(good)}</p>
          </Kpi>

          <Kpi label="OEE do turno">
            <div className="flex items-center gap-3">
              <OeeRing value={oeeValues?.oee ?? null} size={60} stroke={7} label="" />
              {oeeValues ? (
                <OeeBreakdown values={oeeValues} compact className="hidden min-w-0 flex-1 gap-1.5 sm:grid" />
              ) : (
                <span className="hidden text-xs text-muted-foreground sm:block">Sem dados suficientes</span>
              )}
            </div>
            {oeeValues && (
              <p className="text-xs text-muted-foreground tabular-nums sm:hidden">
                D {pct(oeeValues.availability, 0)} · P {pct(oeeValues.performance, 0)} · Q {pct(oeeValues.quality, 0)}
              </p>
            )}
          </Kpi>

          <Kpi label="Produto">
            <span className="line-clamp-2 text-base leading-snug font-semibold md:text-lg">{product?.name ?? "Nenhum produto"}</span>
            <p className="text-xs text-muted-foreground">
              {product ? `Código ${product.code} · ciclo ideal ${seconds(product.idealCycleS)}` : "Selecione em Trocar produto"}
            </p>
          </Kpi>
        </section>

        <div className="grid gap-4 md:gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Ações grandes */}
          <div className="grid grid-cols-2 content-start gap-3 lg:col-start-2 lg:row-start-1 lg:grid-cols-1">
            <ActionButton
              icon={PackageXIcon}
              title="Lançar refugo"
              subtitle={hasData ? "Peças descartadas no turno" : "Sem produção no turno"}
              iconClassName="bg-state-fault text-white"
              disabled={!hasData}
              onClick={() => setRejectOpen(true)}
            />
            <ActionButton
              icon={ArrowLeftRightIcon}
              title="Trocar produto"
              subtitle={product ? `Atual: ${product.code}` : "Selecionar produto"}
              iconClassName="bg-primary text-primary-foreground"
              onClick={() => setProductOpen(true)}
            />
          </div>

          {/* Paradas para classificar */}
          <section className="flex flex-col rounded-xl border bg-card lg:col-start-1 lg:row-span-2 lg:row-start-1" aria-labelledby="pendentes-titulo">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <h2 id="pendentes-titulo" className="flex items-center gap-2 text-lg font-semibold">
                  Paradas para classificar
                  {pending.length > 0 && (
                    <span className="rounded-full bg-state-stopped px-2.5 py-0.5 text-sm font-bold text-zinc-950 tabular-nums">{pending.length}</span>
                  )}
                </h2>
                <p className="text-sm text-muted-foreground">Toque na parada e escolha o motivo.</p>
              </div>
            </div>

            <div className="flex-1 p-3 md:p-4">
              {pending.length === 0 ? (
                <Empty className="h-full border border-dashed p-6 md:p-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon" className="bg-state-running/15 text-emerald-700 dark:text-state-running">
                      <ListChecksIcon />
                    </EmptyMedia>
                    <EmptyTitle>Tudo classificado</EmptyTitle>
                    <EmptyDescription>
                      Nenhuma parada pendente neste turno. Quando a máquina parar por mais de {duration(machine.microStopThresholdS)}, ela aparece
                      aqui.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="grid gap-3">
                  {pending.map((stop) => (
                    <li key={stop.id}>
                      <PendingStopButton stop={stop} nowMs={now} timeZone={timeZone} onClick={() => setPickStop(stop)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-start gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
              <InfoIcon className="mt-px size-4 shrink-0" />
              <span>
                {data.microStops > 0
                  ? `${data.microStops} micro-paradas (menos de ${duration(machine.microStopThresholdS)}) contam na performance e não precisam de motivo. `
                  : `Paradas menores que ${duration(machine.microStopThresholdS)} são micro-paradas e não precisam de motivo. `}
                {data.classifiedStops + Object.keys(classified).length} paradas já classificadas neste turno.
              </span>
            </div>
          </section>

          {/* Lançamentos feitos neste tablet */}
          <section className="flex flex-col rounded-xl border bg-card lg:col-start-2 lg:row-start-2" aria-labelledby="lancamentos-titulo">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <h2 id="lancamentos-titulo" className="font-semibold">
                Lançamentos do turno
              </h2>
              {log.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{log.length}</span>}
            </div>
            {log.length === 0 ? (
              <Empty className="gap-3 p-6 md:p-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HistoryIcon />
                  </EmptyMedia>
                  <EmptyTitle className="text-base">Nada lançado ainda</EmptyTitle>
                  <EmptyDescription>Classificações, refugos e trocas de produto feitos aqui aparecem nesta lista.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="max-h-80 divide-y overflow-y-auto">
                {log.map((e) => {
                  const Icon = LOG_ICON[e.kind]
                  return (
                    <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{e.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{e.detail}</div>
                      </div>
                      <time className="shrink-0 text-xs text-muted-foreground tabular-nums">{time(new Date(e.at).toISOString(), timeZone)}</time>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-auto border-t px-4 py-2.5 text-xs text-muted-foreground">
              Sem rede? Os lançamentos ficam guardados no tablet e são enviados quando a conexão voltar.
            </p>
          </section>
        </div>
      </main>

      <ReasonPicker
        stop={pickStop}
        reasons={reasons}
        nowMs={now}
        timeZone={timeZone}
        onOpenChange={(open) => !open && setPickStop(null)}
        onPick={classify}
      />
      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        machineName={machine.name}
        maxQty={good}
        onConfirm={launchReject}
      />
      <ProductDialog
        open={productOpen}
        onOpenChange={setProductOpen}
        machineName={machine.name}
        products={products}
        currentCode={product?.code ?? ""}
        defaultCycleS={machine.idealCycleS}
        onConfirm={changeProduct}
      />
    </div>
  )
}

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  )
}

function ActionButton({
  icon: Icon,
  title,
  subtitle,
  iconClassName,
  disabled,
  onClick,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
  iconClassName: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-28 touch-manipulation flex-col items-start justify-between gap-3 rounded-2xl border-2 bg-card p-4 text-left shadow-xs transition-colors select-none",
        "hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-50 lg:flex-row lg:items-center lg:justify-start",
      )}
    >
      <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl", iconClassName)}>
        <Icon className="size-6" />
      </span>
      <span className="min-w-0">
        <span className="block text-lg leading-tight font-semibold">{title}</span>
        <span className="block truncate text-sm text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  )
}

function PendingStopButton({
  stop,
  nowMs,
  timeZone,
  onClick,
}: {
  stop: PendingStop
  nowMs: number
  timeZone: string
  onClick: () => void
}) {
  const Icon = STATE_ICON[stop.state]
  const end = stop.ongoing ? nowMs : Date.parse(stop.end)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-22 w-full touch-manipulation items-center gap-3 rounded-xl border-2 bg-card p-3 text-left transition-colors select-none sm:gap-4",
        "hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.99]",
        stop.state === "FAULT" ? "border-state-fault/50" : "border-state-stopped/60",
      )}
    >
      <span className={cn("flex size-14 shrink-0 items-center justify-center rounded-xl", STATE_META[stop.state].bg, STATE_ON[stop.state])}>
        <Icon className="size-7" strokeWidth={2.4} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-base font-semibold">{stop.state === "FAULT" ? "Falha" : "Parada não planejada"}</span>
          {stop.ongoing && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-state-fault/10 px-2 py-0.5 text-xs font-semibold text-state-fault">
              <span className="size-1.5 animate-pulse rounded-full bg-state-fault" />
              Em andamento
            </span>
          )}
        </span>
        <span className="block text-sm text-muted-foreground tabular-nums">
          {time(stop.start, timeZone)} – {stop.ongoing ? "agora" : time(stop.end, timeZone)}
        </span>
        {stop.faultCode !== undefined && (
          <span className="block truncate text-sm text-state-fault">
            F{stop.faultCode}
            {stop.faultText ? ` · ${stop.faultText}` : ""}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-xl leading-tight font-bold tabular-nums sm:text-2xl" suppressHydrationWarning>
          {duration((end - Date.parse(stop.start)) / 1000)}
        </span>
        <span className="hidden text-xs text-muted-foreground sm:block">parada</span>
      </span>
      <span className="hidden h-12 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground md:inline-flex">
        Classificar
      </span>
      <ChevronRightIcon className="size-6 shrink-0 text-muted-foreground md:hidden" />
    </button>
  )
}
