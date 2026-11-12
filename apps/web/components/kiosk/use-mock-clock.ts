"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { MOCK_NOW } from "@/lib/mock/clock"

const BASE_MS = Date.parse(MOCK_NOW)

/**
 * Relógio simulado do protótipo: começa em MOCK_NOW (igual no servidor e no cliente,
 * sem erro de hidratação) e, depois de montado, avança junto com o relógio real.
 * `read()` dá o instante simulado dentro de handlers (ex.: horário de um lançamento).
 */
export function useMockClock(tickMs = 1000) {
  const [now, setNow] = useState(BASE_MS)
  const mountedAt = useRef<number | null>(null)

  useEffect(() => {
    const startedAt = Date.now()
    mountedAt.current = startedAt
    const id = window.setInterval(() => setNow(BASE_MS + (Date.now() - startedAt)), tickMs)
    return () => window.clearInterval(id)
  }, [tickMs])

  const read = useCallback(() => (mountedAt.current === null ? BASE_MS : BASE_MS + (Date.now() - mountedAt.current)), [])

  return { now, read }
}
