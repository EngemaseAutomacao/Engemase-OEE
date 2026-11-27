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
  /** Id do evento no banco (sistema real), usado para gravar a classificação. */
  eventId?: string
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
  /** Sistema real: as ações gravam no banco (Server Actions). Sem banco: demonstração local. */
  banco: boolean
  /** Cliente da URL (as Server Actions conferem o acesso por ele). */
  clientSlug: string
  /** Aberta pelo tablet pareado: as ações vão pelo token do aparelho (`app/terminal/actions.ts`). */
  viaTerminal: boolean
  /** Operadores do chão ativos da unidade (tablet pareado, D18). Vazio: não pede "quem está operando". */
  floorOperators: FloorOperator[]
  /** Motivos de refugo cadastrados (sistema real). */
  rejectReasons: { id: string; name: string }[]
}

/** Operador do chão (sem conta de login), escolhido na lista do tablet. */
export interface FloorOperator {
  id: string
  name: string
  employeeCode: string | null
}
