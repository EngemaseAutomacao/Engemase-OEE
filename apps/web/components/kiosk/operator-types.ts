import type { MachineLive, ReasonCategory } from "@/lib/mock"

/** Parada não planejada (≥ limite de micro-parada) ainda sem motivo apontado. */
export interface PendingStop {
  /** Identificador estável: início do evento (ISO). */
  id: string
  state: "STOPPED" | "FAULT"
  start: string
  end: string
  /** Evento atual da máquina (ainda em aberto). */
  ongoing: boolean
  faultCode?: number
  faultText?: string
}

export interface ReasonOption {
  id: string
  parentId: string | null
  name: string
  category: ReasonCategory
}

export interface ProductOption {
  id: string
  code: string
  name: string
  idealCycleS: number
  /** Há ciclo ideal cadastrado para esta máquina (senão usa o padrão da máquina). */
  configured: boolean
}

export interface OperatorMachine {
  id: string
  name: string
  code: string
  type: string
  clientName: string
  unitName: string
  lineName: string
  idealCycleS: number
  microStopThresholdS: number
}

export interface OperatorShift {
  name: string
  start: string
  end: string
  remainingMin: number
  plannedProgress: number
  onBreak: string | null
}

export interface OperatorData {
  machine: OperatorMachine
  live: MachineLive | null
  shift: OperatorShift | null
  pendingStops: PendingStop[]
  microStops: number
  classifiedStops: number
  /** Motivo já apontado para o estado atual (setup, parada planejada...). */
  currentReasonName: string | null
  commDetail: string | null
  reasons: ReasonOption[]
  products: ProductOption[]
  operator: { name: string; username: string | null; initials: string }
  timeZone: string
}
