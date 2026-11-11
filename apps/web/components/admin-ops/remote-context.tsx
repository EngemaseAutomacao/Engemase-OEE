"use client"

import { createContext, useContext, useMemo, useState } from "react"

import { dateTime, duration } from "@/lib/format"
import type { RemoteData, SessionRow } from "./remote-data"
import { useOpsClock } from "./use-ops-clock"

export interface KillSwitch {
  at: string
  atLabel: string
  by: string
  reason: string
}

interface RemoteState extends RemoteData {
  read: () => number
  killSwitch: KillSwitch | null
  request: (row: SessionRow) => void
  endSession: (id: string, reason: string) => void
  cancelRequest: (id: string) => void
  activateKill: (reason: string, rejectPending: boolean) => { revoked: number; rejected: number }
  deactivateKill: () => void
}

const RemoteContext = createContext<RemoteState | null>(null)

/** Estado local do console de acesso remoto (protótipo): pedidos, encerramentos e kill switch. */
export function RemoteProvider({ data, children }: { data: RemoteData; children: React.ReactNode }) {
  const { read } = useOpsClock(60_000)
  const [sessions, setSessions] = useState(data.sessions)
  const [killSwitch, setKillSwitch] = useState<KillSwitch | null>(null)

  const value = useMemo<RemoteState>(() => {
    const finish = (s: SessionRow, status: SessionRow["status"], reason: string, at: string): SessionRow => ({
      ...s,
      status,
      endedAt: at,
      endedLabel: dateTime(at),
      endedReason: reason,
      realDuration: s.startedAt ? duration((Date.parse(at) - Date.parse(s.startedAt)) / 1000) : null,
    })
    return {
      ...data,
      sessions,
      read,
      killSwitch,
      request: (row) => setSessions((list) => [row, ...list]),
      endSession: (id, reason) => {
        const at = new Date(read()).toISOString()
        setSessions((list) => list.map((s) => (s.id === id ? finish(s, "ended", reason, at) : s)))
      },
      cancelRequest: (id) => {
        const at = new Date(read()).toISOString()
        setSessions((list) => list.map((s) => (s.id === id ? finish(s, "cancelled", `Cancelado por ${data.me.name}`, at) : s)))
      },
      activateKill: (reason, rejectPending) => {
        const at = new Date(read()).toISOString()
        const revoked = sessions.filter((s) => s.status === "active" || s.status === "approved").length
        const rejected = rejectPending ? sessions.filter((s) => s.status === "requested").length : 0
        setSessions((list) =>
          list.map((s) =>
            s.status === "active" || s.status === "approved"
              ? finish(s, "revoked", `Revogada pelo kill switch global (${data.me.name})`, at)
              : rejectPending && s.status === "requested"
                ? finish(s, "rejected", "Recusado automaticamente: kill switch global", at)
                : s,
          ),
        )
        setKillSwitch({ at, atLabel: dateTime(at), by: data.me.name, reason })
        return { revoked, rejected }
      },
      deactivateKill: () => setKillSwitch(null),
    }
  }, [data, sessions, read, killSwitch])

  return <RemoteContext.Provider value={value}>{children}</RemoteContext.Provider>
}

export function useRemote(): RemoteState {
  const ctx = useContext(RemoteContext)
  if (!ctx) throw new Error("useRemote precisa de <RemoteProvider>")
  return ctx
}
