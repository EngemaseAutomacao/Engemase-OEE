"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { MOCK_NOW } from "@/lib/mock/clock"
import { CONNECTION_LABEL, MODE_META, STATUS_META, bytesLabel, dateTimeOf, minutesLabel, timeOf } from "./remote-labels"
import type { PersonVM, PolicyVM, RemoteData, RemoteSessionVM } from "./remote-types"

export interface ApproveOptions {
  durationMin: number
  keepPlc: boolean
  onsiteContactId: string | null
  note: string
  changes: string[]
}

interface RemoteCtx {
  clientName: string
  clientSlug: string
  me: RemoteData["me"]
  approvers: string[]
  contacts: PersonVM[]
  /** Instante simulado (MOCK_NOW avançando com o relógio real depois de montado). */
  now: number
  sessions: RemoteSessionVM[]
  policy: PolicyVM
  approve: (id: string, opts: ApproveOptions) => void
  reject: (id: string, reason: string) => void
  endNow: (id: string) => void
  savePolicy: (p: PolicyVM) => void
  exportHistory: (format: "csv" | "pdf") => void
}

const Ctx = createContext<RemoteCtx | null>(null)

export function useRemote() {
  const c = useContext(Ctx)
  if (!c) throw new Error("useRemote precisa estar dentro de <RemoteAccessProvider>")
  return c
}

export const isHistory = (s: RemoteSessionVM) => s.status === "ended" || s.status === "rejected" || s.status === "expired_unapproved" || s.status === "revoked"

/** Sessão ativa cujo prazo já passou vira "encerrada" (o gateway derruba sozinho). */
function effective(s: RemoteSessionVM, now: number): RemoteSessionVM {
  if (s.status === "active" && s.expiresMs !== null && now >= s.expiresMs) {
    return { ...s, status: "ended", endedMs: s.expiresMs, endedReason: "Prazo encerrado" }
  }
  return s
}

function csvCell(v: string) {
  return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function RemoteAccessProvider({ data, children }: { data: RemoteData; children: React.ReactNode }) {
  const base = data.nowMs
  const [now, setNow] = useState(base)
  const [sessions, setSessions] = useState(data.sessions)
  const [policy, setPolicy] = useState(data.policy)
  const startedRef = useRef<number | null>(null)
  const sessionsRef = useRef(sessions)
  const notified = useRef(new Set<string>())

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    const startedAt = Date.now()
    startedRef.current = startedAt
    const id = window.setInterval(() => {
      const t = base + (Date.now() - startedAt)
      setNow(t)
      for (const s of sessionsRef.current) {
        if (s.status === "active" && s.expiresMs !== null && t >= s.expiresMs && !notified.current.has(s.id)) {
          notified.current.add(s.id)
          toast.info("Sessão de acesso remoto encerrada", { description: `Prazo esgotado no ${s.gatewayName}. O gateway desligou a VPN sozinho.` })
        }
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [base])

  const read = useCallback(() => (startedRef.current === null ? base : base + (Date.now() - startedRef.current)), [base])

  const patch = useCallback((id: string, fn: (s: RemoteSessionVM) => RemoteSessionVM) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)))
  }, [])

  const approve = useCallback(
    (id: string, o: ApproveOptions) => {
      const s = sessionsRef.current.find((x) => x.id === id)
      if (!s) return
      const t = read()
      const contact = data.contacts.find((c) => c.id === o.onsiteContactId)?.name ?? null
      patch(id, (x) => ({
        ...x,
        status: "approved",
        durationMin: o.durationMin,
        plc: o.keepPlc ? x.plc : null,
        decidedBy: data.me.name,
        decidedMs: t,
        onsiteContact: contact,
        changes: o.changes,
      }))
      if (s.gatewayStatus === "offline" || s.gatewayStatus === "pending") {
        toast.warning("Pedido aprovado, mas o gateway está offline", {
          description: `A VPN liga quando o ${s.gatewayName} voltar a se conectar, dentro do prazo aprovado.`,
        })
        return
      }
      toast.success("Pedido aprovado", {
        description: `${o.changes.length ? "Com alterações · " : ""}enviando o comando ao ${s.gatewayName}. A VPN liga em alguns segundos.`,
      })
      window.setTimeout(() => {
        const start = read()
        const connection = s.gatewayStatus === "online" ? "direct" : "relay"
        patch(id, (x) =>
          x.status === "approved" ? { ...x, status: "active", startedMs: start, expiresMs: start + o.durationMin * 60_000, connection, bytes: 0 } : x,
        )
        toast.success("Sessão de acesso remoto ativa", {
          description: `${s.requestedBy} conectado ao ${s.gatewayName} · ${CONNECTION_LABEL[connection]} · encerra às ${timeOf(start + o.durationMin * 60_000)}.`,
        })
      }, 2500)
    },
    [data.contacts, data.me.name, patch, read],
  )

  const reject = useCallback(
    (id: string, reason: string) => {
      const t = read()
      patch(id, (x) => ({ ...x, status: "rejected", decidedBy: data.me.name, decidedMs: t, endedMs: t, endedReason: `Recusado: ${reason}` }))
      toast.success("Pedido recusado", { description: "O técnico foi avisado com o motivo. Nada foi aberto no gateway." })
    },
    [data.me.name, patch, read],
  )

  const endNow = useCallback(
    (id: string) => {
      const t = read()
      patch(id, (x) => ({ ...x, status: "ended", endedMs: t, endedReason: `Encerrada pelo cliente (${data.me.name})` }))
      toast.success("Sessão encerrada", {
        description: "O gateway desligou a VPN e apagou as credenciais da sessão. O resumo vai para a Auditoria e por e-mail.",
      })
    },
    [data.me.name, patch, read],
  )

  const savePolicy = useCallback(
    (p: PolicyVM) => {
      setPolicy(p)
      if (p.mode === "disabled") {
        const t = read()
        setSessions((prev) =>
          prev.map((s) =>
            s.status === "requested" ? { ...s, status: "rejected", decidedBy: data.me.name, decidedMs: t, endedMs: t, endedReason: "Recusado: acesso remoto desativado pela política" } : s,
          ),
        )
      }
      toast.success("Política de acesso remoto salva", {
        description: `${MODE_META[p.mode].label} · até ${minutesLabel(p.maxDurationMin)} por sessão. Vale para os próximos pedidos e fica registrada na Auditoria.`,
      })
    },
    [data.me.name, read],
  )

  const effectiveSessions = useMemo(() => sessions.map((s) => effective(s, now)), [sessions, now])

  const exportHistory = useCallback(
    (format: "csv" | "pdf") => {
      const rows = effectiveSessions.filter(isHistory)
      const day = MOCK_NOW.slice(0, 10)
      const file = `acesso-remoto-${data.clientSlug}-${day}.${format}`
      if (format === "csv") {
        const head = ["Pedido em", "Gateway", "Técnico", "Chamado", "Motivo", "Duração aprovada", "Início", "Fim", "Resultado", "Decidido por", "Conexão", "Tráfego", "Observação"]
        const lines = rows.map((s) =>
          [
            dateTimeOf(s.requestedMs),
            s.gatewayName,
            s.requestedBy,
            s.ticket,
            s.reason,
            minutesLabel(s.durationMin),
            s.startedMs ? dateTimeOf(s.startedMs) : "",
            s.endedMs ? dateTimeOf(s.endedMs) : "",
            STATUS_META[s.status].label,
            s.decidedBy ?? "",
            s.connection ? CONNECTION_LABEL[s.connection] : "",
            s.bytes !== null ? bytesLabel(s.bytes) : "",
            s.endedReason ?? "",
          ]
            .map(csvCell)
            .join(";"),
        )
        const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = file
        document.body.appendChild(a)
        a.click()
        a.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        toast.success("Histórico exportado", { description: `${file} · ${rows.length} ${rows.length === 1 ? "sessão" : "sessões"}` })
      } else {
        toast.success("Relatório PDF em preparação", {
          description: `${file} · ${rows.length} ${rows.length === 1 ? "sessão" : "sessões"} com linha do tempo e assinatura de integridade. Você recebe o arquivo por e-mail em instantes.`,
        })
      }
    },
    [data.clientSlug, effectiveSessions],
  )

  const value = useMemo<RemoteCtx>(
    () => ({
      clientName: data.clientName,
      clientSlug: data.clientSlug,
      me: data.me,
      approvers: data.approvers,
      contacts: data.contacts,
      now,
      sessions: effectiveSessions,
      policy,
      approve,
      reject,
      endNow,
      savePolicy,
      exportHistory,
    }),
    [data, now, effectiveSessions, policy, approve, reject, endNow, savePolicy, exportHistory],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
