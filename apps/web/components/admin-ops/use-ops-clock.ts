"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { MOCK_NOW } from "@/lib/mock/clock"

const BASE_MS = Date.parse(MOCK_NOW)

/**
 * Relógio simulado do console: começa em MOCK_NOW (igual no servidor e no navegador,
 * sem erro de hidratação) e, depois de montado, avança junto com o relógio real.
 * `read()` devolve o instante simulado dentro de handlers (ex.: hora de um pedido).
 */
export function useOpsClock(tickMs = 1000) {
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

/** Contagem regressiva "1:04:59" / "12:05" a partir de milissegundos. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0")
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
