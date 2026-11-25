"use client"

import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

import { MOCK_NOW } from "@/lib/mock/clock"

const BASE_MS = Date.parse(MOCK_NOW)

/**
 * Instante de partida do relógio das telas de quiosque: o "agora" da leitura feita no servidor
 * (relógio real com banco; MOCK_NOW na demonstração). Igual no servidor e no cliente: sem erro de hidratação.
 */
const ClockBaseContext = createContext<number>(BASE_MS)

/** Define o instante de partida do relógio para os componentes abaixo (Andon, tela do operador). */
export function ClockBase({ value, children }: { value: number; children: ReactNode }) {
  return createElement(ClockBaseContext.Provider, { value }, children)
}

/**
 * Relógio das telas de quiosque: começa no instante de `ClockBase` (padrão: MOCK_NOW) e, depois de
 * montado, avança junto com o relógio real. `read()` dá o instante dentro de handlers (ex.: horário de
 * um lançamento).
 */
export function useMockClock(tickMs = 1000) {
  const base = useContext(ClockBaseContext)
  const [now, setNow] = useState(base)
  const mountedAt = useRef<number | null>(null)

  useEffect(() => {
    const startedAt = Date.now()
    mountedAt.current = startedAt
    const id = window.setInterval(() => setNow(base + (Date.now() - startedAt)), tickMs)
    return () => window.clearInterval(id)
  }, [tickMs, base])

  const read = useCallback(() => (mountedAt.current === null ? base : base + (Date.now() - mountedAt.current)), [base])

  return { now, read }
}
