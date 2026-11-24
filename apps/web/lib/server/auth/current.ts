/**
 * Sessão do pedido atual (Next.js): lê os cookies com `headers()` e aplica a regra de duração
 * (`session.ts`). Memorizada por pedido (`cache` do React): várias leituras no mesmo render consultam
 * o banco uma vez. Lê o pedido: use dentro de `<Suspense>` (Cache Components) ou em Server Actions.
 */
import { cookies, headers } from "next/headers"
import { connection } from "next/server"
import { cache } from "react"
import { getAuthDb } from "@/lib/server/db"
import { getAuth } from "./index"
import { type CurrentSession, readSession } from "./session"

export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  // Os cookies vêm de `cookies()`, não do cabeçalho original: numa Server Action que trocou a sessão
  // (ex.: ativar o 2FA cria uma sessão nova), o render seguinte já enxerga o cookie novo.
  const requestHeaders = new Headers(await headers())
  requestHeaders.set("cookie", (await cookies()).toString())
  // Marca o render como dinâmico antes de ler o relógio (Cache Components).
  await connection()
  const auth = getAuth()
  const db = getAuthDb()
  if (auth === null || db === null) return null
  return readSession(auth, db, requestHeaders, new Date())
})
