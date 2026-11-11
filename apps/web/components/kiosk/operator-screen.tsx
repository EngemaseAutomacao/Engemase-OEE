import { notFound } from "next/navigation"

import {
  DEFAULT_TZ,
  getClientBySlug,
  getClientUsers,
  getCurrentUser,
  getDevice,
  getDowntimeReason,
  getDowntimeReasons,
  getGateway,
  getLine,
  getMachine,
  getMachineLive,
  getProducts,
  getTimeline,
  getUnit,
  nowMs,
} from "@/lib/mock"
import { ago, initials } from "@/lib/format"
import { Skeleton } from "@/components/ui/skeleton"
import { OperatorConsole } from "@/components/kiosk/operator-console"
import type { OperatorData, PendingStop } from "@/components/kiosk/operator-types"
import { currentShift } from "@/components/kiosk/shift-info"

/** Esqueleto exibido enquanto a tela do operador carrega (navegação no app). */
export function OperatorSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="border-b px-4 py-3 md:px-6">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-2 h-8 w-64" />
      </div>
      <Skeleton className="h-16 rounded-none" />
      <div className="mx-auto grid w-full max-w-7xl gap-4 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

/** Monta os dados da tela do operador (lê os params dentro do <Suspense> da página). */
export async function OperatorScreen({ params }: { params: Promise<{ cliente: string; maquinaId: string }> }) {
  const { cliente, maquinaId } = await params
  const client = getClientBySlug(cliente)
  const machine = getMachine(maquinaId)
  if (!client || !machine || machine.clientId !== client.id) notFound()

  const unit = getUnit(machine.unitId)
  const line = getLine(machine.lineId)
  const tz = unit?.timezone ?? DEFAULT_TZ
  const live = getMachineLive(machine.id) ?? null
  const timeline = getTimeline(machine.id)
  const now = nowMs()
  const thresholdMs = machine.microStopThresholdS * 1000

  // Paradas não planejadas/falhas ≥ limite de micro-parada, sem motivo (inclui a atual, se for o caso)
  const pendingStops: PendingStop[] = []
  let microStops = 0
  let classifiedStops = 0
  for (const e of timeline) {
    if (e.state !== "STOPPED" && e.state !== "FAULT") continue
    const dur = Date.parse(e.end) - Date.parse(e.start)
    if (dur < thresholdMs) {
      microStops++
      continue
    }
    if (e.reasonId) {
      classifiedStops++
      continue
    }
    const ongoing = Date.parse(e.end) >= now
    pendingStops.push({
      id: e.start,
      state: e.state,
      start: e.start,
      end: e.end,
      ongoing,
      faultCode: e.faultCode,
      faultText: ongoing && live?.state === "FAULT" ? live.faultText : undefined,
    })
  }

  // Motivo já apontado para o estado atual (setup, parada planejada)
  const current = timeline.at(-1)
  const currentReasonName =
    current && live && current.state === live.state ? (getDowntimeReason(current.reasonId)?.name ?? null) : null

  // Explicação da falta de comunicação
  let commDetail: string | null = null
  if (!live || live.state === "NO_COMM") {
    const gateway = machine.gatewayId ? getGateway(machine.gatewayId) : undefined
    const device = machine.deviceId ? getDevice(machine.deviceId) : undefined
    if (!gateway) commDetail = "Máquina sem gateway configurado"
    else if (gateway.status === "pending") commDetail = "Gateway aguardando ativação"
    else if (gateway.status === "offline") commDetail = `Gateway offline · último sinal ${ago(gateway.lastSeen)}`
    else if (device?.status === "error") commDetail = `CLP sem resposta (${device.lastError ?? "verifique cabo e endereço"})`
    else if (device?.status === "disabled") commDetail = "Leitura do CLP desativada"
    else commDetail = "Sem leitura do CLP"
  }

  // Quem está no tablet: conta de operador da unidade (senão, o usuário atual)
  const operatorUser =
    getClientUsers(client.id).find((u) =>
      u.memberships.some(
        (m) => m.clientId === client.id && m.role === "operator" && (m.unitScope === "all" || m.unitScope.includes(machine.unitId)),
      ),
    ) ?? getCurrentUser()

  const shift = currentShift(client.id, machine.unitId)

  const data: OperatorData = {
    machine: {
      id: machine.id,
      name: machine.name,
      code: machine.code,
      type: machine.type,
      clientName: client.name,
      unitName: unit?.name ?? "",
      lineName: line?.name ?? "",
      idealCycleS: machine.idealCycleS,
      microStopThresholdS: machine.microStopThresholdS,
    },
    live,
    shift: shift
      ? {
          name: shift.name,
          start: shift.start,
          end: shift.end,
          remainingMin: shift.remainingMin,
          plannedProgress: shift.plannedProgress,
          onBreak: shift.onBreak,
        }
      : null,
    pendingStops,
    microStops,
    classifiedStops,
    currentReasonName,
    commDetail,
    reasons: getDowntimeReasons(client.id).map((r) => ({ id: r.id, parentId: r.parentId, name: r.name, category: r.category })),
    products: getProducts(client.id).map((p) => {
      const ideal = p.idealCycles.find((c) => c.machineId === machine.id)
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        idealCycleS: ideal?.idealCycleS ?? machine.idealCycleS,
        configured: Boolean(ideal),
      }
    }),
    operator: { name: operatorUser.name, username: operatorUser.username ?? operatorUser.email, initials: initials(operatorUser.name) },
    timeZone: tz,
  }

  return <OperatorConsole data={data} panelHref={`/${client.slug}/maquinas/${machine.id}`} />
}
