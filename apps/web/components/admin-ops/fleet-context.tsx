"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"

import type { AgentRelease, FleetData, FleetRow } from "./fleet-data"

interface FleetState {
  rows: FleetRow[]
  latest: string
  releases: AgentRelease[]
  clients: FleetData["clients"]
  /** gatewayId → versão-alvo agendada (OTA) nesta sessão do protótipo. */
  scheduled: Record<string, string>
  schedule: (ids: string[], version: string) => void
  unschedule: (ids: string[]) => void
  addGateway: (row: FleetRow) => void
}

const FleetContext = createContext<FleetState | null>(null)

/** Estado local da frota (protótipo): gateways provisionados e atualizações agendadas. */
export function FleetProvider({ data, children }: { data: FleetData; children: React.ReactNode }) {
  const [extra, setExtra] = useState<FleetRow[]>([])
  const [scheduled, setScheduled] = useState<Record<string, string>>({})

  const schedule = useCallback((ids: string[], version: string) => {
    setScheduled((s) => {
      const next = { ...s }
      for (const id of ids) next[id] = version
      return next
    })
  }, [])
  const unschedule = useCallback((ids: string[]) => {
    setScheduled((s) => {
      const next = { ...s }
      for (const id of ids) delete next[id]
      return next
    })
  }, [])
  const addGateway = useCallback((row: FleetRow) => setExtra((e) => [row, ...e]), [])

  const value = useMemo<FleetState>(
    () => ({ rows: [...extra, ...data.rows], latest: data.latest, releases: data.releases, clients: data.clients, scheduled, schedule, unschedule, addGateway }),
    [extra, data, scheduled, schedule, unschedule, addGateway],
  )
  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>
}

export function useFleet(): FleetState {
  const ctx = useContext(FleetContext)
  if (!ctx) throw new Error("useFleet precisa de <FleetProvider>")
  return ctx
}
