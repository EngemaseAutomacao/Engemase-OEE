"use client"

import { createContext, useContext, useState } from "react"

import type { ClientManagement, ClientPlan } from "@/lib/mock/types"
import type { AdminClientStatus, PlanLimits } from "./labels"

export interface EditableClient {
  name: string
  legalName: string
  contactName: string
  contactEmail: string
  plan: ClientPlan
  management: ClientManagement
  limits: PlanLimits
}

export interface LocalEvent {
  id: string
  title: string
  subtitle: string
  at: string
}

interface ClientDetailState {
  status: AdminClientStatus
  setStatus: (s: AdminClientStatus) => void
  info: EditableClient
  setInfo: (i: EditableClient) => void
  /** Eventos gerados nesta sessão (mudanças de estado, edições), mostrados no Ciclo de vida. */
  events: LocalEvent[]
  addEvent: (e: Omit<LocalEvent, "id">) => void
}

const Ctx = createContext<ClientDetailState | null>(null)

/** Estado local do detalhe do cliente: compartilhado entre o cabeçalho e as abas (protótipo, sem backend). */
export function ClientDetailProvider({ initialStatus, initialInfo, children }: { initialStatus: AdminClientStatus; initialInfo: EditableClient; children: React.ReactNode }) {
  const [status, setStatus] = useState<AdminClientStatus>(initialStatus)
  const [info, setInfo] = useState<EditableClient>(initialInfo)
  const [events, setEvents] = useState<LocalEvent[]>([])
  const addEvent = (e: Omit<LocalEvent, "id">) => setEvents((list) => [...list, { ...e, id: `local-${list.length + 1}` }])
  return <Ctx.Provider value={{ status, setStatus, info, setInfo, events, addEvent }}>{children}</Ctx.Provider>
}

export function useClientDetail(): ClientDetailState {
  const v = useContext(Ctx)
  if (!v) throw new Error("useClientDetail precisa de <ClientDetailProvider>")
  return v
}
