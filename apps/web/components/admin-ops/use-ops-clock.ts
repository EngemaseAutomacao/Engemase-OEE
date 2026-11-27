"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { MOCK_NOW } from "@/lib/mock/clock"

/**
 * Relógio do console: começa em `baseIso` (o "agora" que o servidor usou; com banco, a hora real) ou, sem
 * ele, em MOCK_NOW (demonstração). Igual no servidor e no navegador (sem erro de hidratação) e, depois de
 * montado, avança junto com o relógio real. `read()` devolve o instante dentro de handlers.
 */
export function useOpsClock(tickMs = 1000, baseIso?: string) {
  const BASE_MS = Date.parse(baseIso ?? MOCK_NOW)
  const [now, setNow] = useState(BASE_MS)
  const mountedAt = useRef<number | null>(null)

  useEffect(() => {
    const startedAt = Date.now()
    mountedAt.current = startedAt
    const id = window.setInterval(() => setNow(BASE_MS + (Date.now() - startedAt)), tickMs)
    return () => window.clearInterval(id)
  }, [tickMs, BASE_MS])

  const read = useCallback(() => (mountedAt.current === null ? BASE_MS : BASE_MS + (Date.now() - mountedAt.current)), [BASE_MS])

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
