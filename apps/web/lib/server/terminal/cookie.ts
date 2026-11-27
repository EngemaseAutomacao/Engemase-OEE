/**
 * Cookie do aparelho pareado (docs/15, risco 12): só no caminho `/terminal`, nunca junto com o cookie de login
 * de uma pessoa. `HttpOnly` (o JavaScript da página não lê), `Secure` em produção, `SameSite=Strict` e o
 * mesmo prazo absoluto do token (12 meses). O banco guarda só o hash do token.
 */
import { cookies } from "next/headers"
import { cache } from "react"
import { getDb } from "@/lib/server/db"
import { type TerminalSession, terminalContext } from "./terminals"

export const TERMINAL_COOKIE = "oee_terminal"
export const TERMINAL_COOKIE_PATH = "/terminal"

/** Grava o token do aparelho depois do pareamento (Server Action). */
export async function setDeviceCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies()
  jar.set(TERMINAL_COOKIE, token, {
    path: TERMINAL_COOKIE_PATH,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    expires: expiresAt,
  })
}

/** Apaga o cookie (aparelho revogado ou "parear de novo"). */
export async function clearDeviceCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete({ name: TERMINAL_COOKIE, path: TERMINAL_COOKIE_PATH })
}

/** Terminal deste aparelho (pelo cookie), ou `null`. Memorizado por pedido. */
export const currentTerminal = cache(async (): Promise<TerminalSession | null> => {
  const db = getDb()
  if (db === null) return null
  const jar = await cookies()
  return terminalContext(db, jar.get(TERMINAL_COOKIE)?.value)
})
