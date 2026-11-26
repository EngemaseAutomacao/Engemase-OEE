import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { LifeBuoyIcon, MonitorIcon, OctagonAlertIcon, Settings2Icon, TabletSmartphoneIcon, UnplugIcon, WifiOffIcon } from "lucide-react"

import { getClientData } from "@/lib/data/cliente"
import type { Tag } from "@/lib/mock"
import { isNetworkProtocol } from "@/lib/mock/types"
import { ago, dateTime, num, pct, shortDate, since, time } from "@/lib/format"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { SectionCard } from "@/components/dashboard/section-card"
import { StateBadge } from "@/components/oee/state-badge"
import { StateLegend } from "@/components/oee/state-timeline"
import type { StopRow } from "@/components/monitoring/classify-stop-dialog"
import { ConnectionCard } from "@/components/monitoring/connection-card"
import { STOP_STATES, eventKey, reasonPathMap } from "@/components/monitoring/labels"
import { MachineKpis } from "@/components/monitoring/machine-kpis"
import { MachineTimeline } from "@/components/monitoring/machine-timeline"
import { HourlyProductionChart, OeeTrendChart, type DailyPoint, type HourlyPoint } from "@/components/monitoring/production-charts"
import { currentShift, stateDurations, unclassifiedStops } from "@/components/monitoring/queries"
import { StopsTable } from "@/components/monitoring/stops-table"
import { PageTitle } from "@/components/refresh/page-title"
import { SoftLink } from "@/components/refresh/soft-action"
import { PageSkeleton } from "@/components/shell/page-skeleton"

/** Container de página no padrão novo. */
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-5 p-4 md:p-6">{children}</div>
}

const HOUR_MS = 60 * 60 * 1000

export const metadata: Metadata = { title: "Máquina" }

export default function Page({ params }: PageProps<"/[cliente]/maquinas/[maquinaId]">) {
  return (
    <Suspense fallback={<PageSkeleton blocks={3} />}>
      <MachineDetail params={params} />
    </Suspense>
  )
}

async function MachineDetail({ params }: { params: PageProps<"/[cliente]/maquinas/[maquinaId]">["params"] }) {
  const { cliente, maquinaId } = await params
  const data = await getClientData(cliente, { diasOee: 30 })
  const { client } = data
  // Máquina de outro cliente ou fora do escopo da pessoa: 404 (não revela que existe).
  const machine = data.getMachine(maquinaId)
  if (!machine) notFound()

  const slug = client.slug
  const nowIso = data.now
  // Só a equipe Engemase configura gateway, CLP e tags (D12/D13); para o cliente a tela é só leitura.
  const { canConfigure, canSeeTechnical } = data.access
  const live = data.getMachineLive(machine.id)
  const line = data.getLine(machine.lineId)
  const unit = data.getUnit(machine.unitId)
  const areaName = line && unit ? data.getAreas(unit.id).find((a) => a.id === line.areaId)?.name : undefined
  const gateway = machine.gatewayId ? data.getGateway(machine.gatewayId) : undefined
  const device = machine.deviceId ? data.getDevice(machine.deviceId) : undefined
  const busPeers =
    device?.protocol === "modbus-rtu"
      ? data.getDevices(device.gatewayId).filter((d) => d.id !== device.id && d.protocol === "modbus-rtu" && d.params.serialPort === device.params.serialPort)
      : []

  const shift = currentShift(data.shiftWindow(machine.unitId), nowIso)
  const events = data.getTimeline(machine.id)
  const hasData = Boolean(live) && events.length > 0
  const reasons = [...data.reasons]
  const reasonPaths = reasonPathMap(reasons)
  const state = live?.state ?? "NO_COMM"

  // Valores das tags de estado coerentes com o estado ao vivo (o mock traz valores fixos).
  const tags: Tag[] = data.getTags(machine.id).map((t) => {
    if (!live || t.quality !== "good") return t
    if (t.role === "state.running") return { ...t, lastValue: state === "RUNNING" ? "1" : "0" }
    if (t.role === "state.fault") return { ...t, lastValue: state === "FAULT" ? "1" : "0" }
    if (t.role === "fault.code") return { ...t, lastValue: String(live.faultCode ?? 0) }
    if (t.role === "product.code" && /^\d+$/.test(live.productCode)) return { ...t, lastValue: live.productCode }
    return t
  })

  // Conexão Modbus, endereços e tags: só com leitura técnica (engenheiro, admin, Engemase).
  const connection = canSeeTechnical && (
    <ConnectionCard
      clientSlug={slug}
      gateway={gateway}
      device={device}
      busPeers={busPeers}
      tags={tags}
      stateMode={machine.stateMode}
      canConfigure={canConfigure}
      now={nowIso}
    />
  )

  // ---------------------------------------------------------------------------
  // Cabeçalho
  // ---------------------------------------------------------------------------
  const header = (
    <PageTitle
      eyebrow={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={`/${slug}/maquinas`}>Máquinas</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="hidden sm:inline-flex">{unit?.name}</BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:block" />
            <BreadcrumbItem>
              {line ? (
                <BreadcrumbLink asChild>
                  <Link href={`/${slug}/linhas/${line.id}`}>{line.name}</Link>
                </BreadcrumbLink>
              ) : null}
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{machine.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
      title={
        <span className="flex flex-wrap items-center gap-2">
          {machine.name}
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs font-medium text-muted-foreground">{machine.code}</span>
        </span>
      }
      description={[machine.type, line?.name, areaName, unit ? (unit.city ? `${unit.name} (${unit.city}/${unit.state})` : unit.name) : undefined].filter(Boolean).join(" · ")}
      actions={
        <>
          <SoftLink href={`/${slug}/operador/${machine.id}`}>
            <TabletSmartphoneIcon />
            Tela do operador
          </SoftLink>
          {line && (
            <SoftLink href={`/${slug}/andon/${line.id}`} tone="teal">
              <MonitorIcon />
              Andon da linha
            </SoftLink>
          )}
        </>
      }
    >
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <StateBadge state={state} pulse={state === "FAULT"} className="px-2.5 py-1 text-sm" />
        {hasData && live ? (
          <span className="text-sm text-muted-foreground tabular-nums">
            há {since(live.stateSince, nowIso)} · desde {time(live.stateSince)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Nenhum dado recebido neste turno</span>
        )}
        {live?.faultCode !== undefined && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-state-fault/10 px-2.5 py-1 text-xs font-medium text-state-fault">
            <OctagonAlertIcon className="size-3.5" />
            Alarme {live.faultCode} · {live.faultText ?? "sem descrição"}
          </span>
        )}
      </div>
    </PageTitle>
  )

  // ---------------------------------------------------------------------------
  // Máquina sem nenhum dado (gateway pendente/offline, CLP não vinculado)
  // ---------------------------------------------------------------------------
  if (!live || !hasData) {
    const causes: string[] = []
    if (!gateway) causes.push("Esta máquina ainda não está vinculada a um gateway.")
    else if (gateway.status === "pending")
      causes.push(
        canConfigure
          ? `O ${gateway.name} ainda não foi ativado no local${gateway.enrollmentCode ? ` (código ${gateway.enrollmentCode})` : ""}. Assim que ele se conectar e a configuração for publicada, estado, contagens e OEE aparecem aqui.`
          : `O ${gateway.name} ainda não foi ativado pela equipe Engemase. Assim que ele se conectar e a configuração for publicada, estado, contagens e OEE aparecem aqui.`,
      )
    else if (gateway.status === "offline")
      causes.push(`O ${gateway.name} está offline desde ${gateway.lastSeen ? dateTime(gateway.lastSeen) : "a instalação"} e nenhum dado desta máquina chegou no turno.`)
    if (!device)
      causes.push(
        canConfigure
          ? "Nenhum CLP vinculado: cadastre a conexão Modbus TCP ou RTU no gateway e mapeie as tags."
          : "Nenhum CLP vinculado: a equipe Engemase liga a máquina ao CLP e mapeia as tags.",
      )
    else if (device.status === "disabled") causes.push(`A conexão ${device.name} está desativada.`)
    if (causes.length === 0) causes.push("A máquina ainda não enviou contagens neste turno.")

    return (
      <Shell>
        {header}
        <Empty className="rounded-2xl border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WifiOffIcon />
            </EmptyMedia>
            <EmptyTitle>Aguardando os primeiros dados</EmptyTitle>
            <EmptyDescription>{causes.join(" ")}</EmptyDescription>
          </EmptyHeader>
          {canConfigure ? (
            gateway && (
              <EmptyContent>
                <Button asChild variant="outline">
                  <Link href={`/${slug}/config/gateways/${gateway.id}`}>
                    <Settings2Icon />
                    Abrir configuração do gateway
                  </Link>
                </Button>
              </EmptyContent>
            )
          ) : (
            <EmptyContent>
              <Button asChild variant="outline">
                <Link href={`/${slug}/ajuda`}>
                  <LifeBuoyIcon />
                  Abrir chamado
                </Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
        {connection}
      </Shell>
    )
  }

  // ---------------------------------------------------------------------------
  // Indicadores e séries
  // ---------------------------------------------------------------------------
  const durations = stateDurations(events)
  const totalS = Object.values(durations).reduce((s, v) => s + v, 0)
  const plannedElapsedS = totalS - durations.PLANNED_STOP
  const product = data.products.find((p) => p.code === live.productCode)
  const idealCycleS = product?.idealCycles.find((c) => c.machineId === machine.id)?.idealCycleS ?? machine.idealCycleS

  const lastEvent = events.at(-1)
  const stopRows: StopRow[] = events
    .filter((e) => STOP_STATES.includes(e.state))
    .map((e) => {
      const durationS = (Date.parse(e.end) - Date.parse(e.start)) / 1000
      const open = e === lastEvent && e.end === nowIso
      return {
        key: eventKey(e),
        state: e.state,
        start: e.start,
        end: e.end,
        open,
        durationS,
        faultCode: e.faultCode,
        faultText: e.faultCode !== undefined && e.faultCode === live.faultCode ? live.faultText : undefined,
        reasonId: e.reasonId,
        micro: e.state === "STOPPED" && durationS < machine.microStopThresholdS,
      }
    })
    .reverse()
  const pending = unclassifiedStops(events, machine.microStopThresholdS).length
  const micro = stopRows.filter((r) => r.micro).length

  const now = data.nowMs
  const hourly: HourlyPoint[] = data.getHourlyProduction(machine.id).map((h) => {
    const hs = Date.parse(h.hour)
    const future = hs >= now
    return {
      label: time(h.hour),
      good: future ? null : h.total - h.reject,
      reject: future ? null : h.reject,
      target: h.target,
      partial: !future && hs + HOUR_MS > now,
    }
  })
  const daily: DailyPoint[] = data.getDailyOee(machine.id, 30).map((d) => ({
    label: shortDate(d.date),
    oee: d.oee,
    availability: d.availability,
    performance: d.performance,
    quality: d.quality,
  }))
  const dailyAvg = daily.length ? daily.reduce((s, d) => s + d.oee, 0) / daily.length : 0
  const bestDay = daily.reduce<DailyPoint | undefined>((b, d) => (!b || d.oee > b.oee ? d : b), undefined)

  return (
    <Shell>
      {header}

      {live.stale && (
        <Alert className="rounded-2xl border-state-stopped/40 bg-state-stopped/5">
          <WifiOffIcon className="text-amber-700 dark:text-state-stopped" />
          <AlertTitle>Dados atrasados · último dado {ago(live.lastUpdate, nowIso)}</AlertTitle>
          <AlertDescription>
            {gateway?.status === "offline"
              ? `O ${gateway.name} está offline desde ${time(gateway.lastSeen ?? live.lastUpdate)}. Os indicadores abaixo vão até ${time(live.lastUpdate)}; quando a conexão voltar, ${num(gateway.bufferPending)} leituras guardadas no gateway serão enviadas e o turno será recalculado.`
              : `Os indicadores abaixo vão até ${time(live.lastUpdate)} e serão recalculados quando os dados chegarem.`}
          </AlertDescription>
        </Alert>
      )}
      {state === "NO_COMM" && !live.stale && (
        <Alert variant="destructive" className="rounded-2xl">
          <UnplugIcon />
          <AlertTitle>Sem comunicação com o CLP desde {time(live.stateSince)}</AlertTitle>
          <AlertDescription>
            {gateway ? `O ${gateway.name} está ${gateway.status === "online" ? "online" : "com alertas"}, mas ` : ""}
            {device
              ? `${device.name} (${isNetworkProtocol(device.protocol) ? `${device.params.host}:${device.params.port}` : `${device.params.serialPort}, escravo ${device.params.unitId}`}) não responde: ${device.lastError ?? "sem resposta Modbus"}.`
              : "o CLP não responde."}{" "}
            O tempo sem comunicação conta como parada não planejada com o motivo &quot;Sem comunicação&quot;.
          </AlertDescription>
        </Alert>
      )}

      <MachineKpis
        live={live}
        shiftLabel={`${shift.name} · ${time(shift.start)}–${time(shift.end)}`}
        durations={durations}
        plannedElapsedS={plannedElapsedS}
        idealCycleS={idealCycleS}
        stops={stopRows.filter((r) => !r.micro).length}
        pending={pending}
        micro={micro}
      />

      <SectionCard
        title="Linha do tempo do turno"
        description={`${shift.name} · ${time(shift.start)}–${time(shift.end)} · passe o mouse sobre um trecho para ver horário, duração e motivo`}
        bodyClassName="grid gap-3"
      >
        <MachineTimeline events={events} start={shift.start} end={shift.end} now={shift.now} reasonPaths={reasonPaths} />
        <StateLegend />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Produção por hora"
          description={`${num(live.countShift)} peças no turno · barras = boas + refugo; contorno tracejado = meta da hora (sem paradas planejadas)`}
          href={`/${slug}/relatorios/oee`}
          linkLabel="Relatório"
          bodyClassName="px-3 sm:px-4"
        >
          <HourlyProductionChart data={hourly} />
        </SectionCard>
        <SectionCard
          title="Tendência de OEE · 30 dias"
          description={
            daily.length > 0
              ? `Média ${pct(dailyAvg)} · melhor dia ${bestDay ? `${bestDay.label} (${pct(bestDay.oee, 0)})` : "—"} · linha tracejada = classe mundial`
              : "Sem histórico consolidado"
          }
          href={`/${slug}/relatorios/oee`}
          linkLabel="Ver histórico"
          bodyClassName="px-3 sm:px-4"
        >
          {daily.length > 0 ? (
            <OeeTrendChart data={daily} />
          ) : (
            <Empty className="h-[260px] border border-dashed">
              <EmptyHeader>
                <EmptyTitle className="text-base">Sem histórico</EmptyTitle>
                <EmptyDescription>O histórico diário aparece após o fechamento do primeiro turno com dados.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </SectionCard>
      </div>

      <StopsTable
        rows={stopRows}
        reasons={reasons}
        reasonPaths={reasonPaths}
        machineName={machine.name}
        microStopThresholdS={machine.microStopThresholdS}
      />

      {connection}
    </Shell>
  )
}
