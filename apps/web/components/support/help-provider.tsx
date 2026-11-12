"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { LifeBuoyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { TicketTarget, TicketVM } from "./help-types"
import { TicketDialog, type TicketPrefill } from "./ticket-dialog"

interface HelpContextValue {
  tickets: TicketVM[]
  openTicket: (prefill?: TicketPrefill) => void
}

const HelpContext = createContext<HelpContextValue | null>(null)

export function useHelp() {
  const ctx = useContext(HelpContext)
  if (!ctx) throw new Error("useHelp precisa estar dentro de <HelpProvider>")
  return ctx
}

/** Estado compartilhado da central de ajuda: chamados (locais) e o diálogo "Abrir chamado". */
export function HelpProvider({
  targets,
  initialTickets,
  nextTicket,
  children,
}: {
  targets: TicketTarget[]
  initialTickets: TicketVM[]
  nextTicket: number
  children: React.ReactNode
}) {
  const [tickets, setTickets] = useState(initialTickets)
  const [number, setNumber] = useState(nextTicket)
  const [open, setOpen] = useState(false)
  const [prefill, setPrefill] = useState<TicketPrefill>({})
  const [formKey, setFormKey] = useState(0)

  const openTicket = useCallback((p: TicketPrefill = {}) => {
    setPrefill(p)
    setFormKey((k) => k + 1)
    setOpen(true)
  }, [])

  const value = useMemo(() => ({ tickets, openTicket }), [tickets, openTicket])

  return (
    <HelpContext.Provider value={value}>
      {children}
      <TicketDialog
        open={open}
        onOpenChange={setOpen}
        prefill={prefill}
        targets={targets}
        number={number}
        formKey={formKey}
        onCreated={(t) => {
          setTickets((prev) => [t, ...prev])
          setNumber((n) => n + 1)
        }}
      />
    </HelpContext.Provider>
  )
}

/** Botão "Abrir chamado" (usa o diálogo único do provider). */
export function OpenTicketButton({
  label = "Abrir chamado",
  variant = "default",
  className,
  prefill,
}: {
  label?: string
  variant?: "default" | "outline" | "secondary"
  className?: string
  prefill?: TicketPrefill
}) {
  const { openTicket } = useHelp()
  return (
    <Button variant={variant} className={className} onClick={() => openTicket(prefill)}>
      <LifeBuoyIcon />
      {label}
    </Button>
  )
}
