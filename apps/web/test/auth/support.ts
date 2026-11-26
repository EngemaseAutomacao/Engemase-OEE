/**
 * Apoio aos testes do login: o mesmo Better Auth do app (`createAuth`) sobre o PGlite, contas com
 * senha, cookies entre chamadas e um gerador de código TOTP (RFC 6238) para o 2FA.
 */
import { createHmac } from "node:crypto"
import * as s from "@engemase/db"
import { type Auth, createAuth, type CreateAuthOptions, type LockNotice } from "@/lib/server/auth/auth"
import { createTestDatabase, type TestDatabase } from "../access/support"

export const BASE_URL = "http://localhost:3000"
export const SECRET = "segredo-de-teste-com-mais-de-32-caracteres-ok"
export const GOOD_PASSWORD = "cavalo bateria grampo correto"

export interface AuthHarness {
  readonly t: TestDatabase
  readonly auth: Auth
  readonly clock: { now: Date }
  readonly locks: LockNotice[]
  readonly pwnedAnswer: { value: boolean | null }
}

export async function createAuthHarness(overrides: Partial<CreateAuthOptions> = {}): Promise<AuthHarness> {
  const t = await createTestDatabase()
  const clock = { now: new Date() }
  const locks: LockNotice[] = []
  const pwnedAnswer: { value: boolean | null } = { value: false }
  const auth = createAuth({
    db: t.db,
    secret: SECRET,
    baseURL: BASE_URL,
    now: () => clock.now,
    pwned: async () => pwnedAnswer.value,
    onLock: (notice) => {
      locks.push(notice)
    },
    ...overrides,
  })
  return { t, auth, clock, locks, pwnedAnswer }
}

let counter = 0

/** Cria uma pessoa com senha (como fará o fluxo "definir senha"). */
export async function createUserWithPassword(
  h: AuthHarness,
  opts: { readonly role?: string; readonly banned?: boolean; readonly password?: string } = {},
): Promise<{ id: string; email: string; password: string }> {
  counter += 1
  const email = `pessoa${counter}@exemplo.test`
  const password = opts.password ?? GOOD_PASSWORD
  const [row] = await h.t.db
    .insert(s.user)
    .values({ name: `Pessoa ${counter}`, email, role: opts.role ?? null, banned: opts.banned ?? false, emailVerified: true })
    .returning()
  if (row === undefined) throw new Error("insert sem retorno")
  const ctx = await h.auth.$context
  await h.t.db.insert(s.account).values({
    accountId: row.id,
    providerId: "credential",
    userId: row.id,
    password: await ctx.password.hash(password),
  })
  return { id: row.id, email, password }
}

/** Cabeçalhos de uma requisição do navegador (mesma origem). */
export function browserHeaders(cookie = ""): Headers {
  const headers = new Headers({ origin: BASE_URL, "user-agent": "vitest", "x-forwarded-for": "10.0.0.1" })
  if (cookie !== "") headers.set("cookie", cookie)
  return headers
}

/** Junta os Set-Cookie de uma resposta num cabeçalho Cookie (ignorando os expirados). */
export function cookiesFrom(headers: Headers, previous = ""): string {
  const jar = new Map<string, string>()
  for (const part of previous.split(";")) {
    const [name, ...rest] = part.trim().split("=")
    if (name) jar.set(name, rest.join("="))
  }
  for (const line of headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(";")
    const [name, ...rest] = (pair ?? "").trim().split("=")
    if (!name) continue
    const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))
    if (expired) jar.delete(name)
    else jar.set(name, rest.join("="))
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(char)
    if (value < 0) throw new Error(`base32 inválido: ${char}`)
    bits += value.toString(2).padStart(5, "0")
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** Código TOTP (SHA-1, 6 dígitos, 30 s) do segredo da URI `otpauth://`. */
export function totpCode(totpURI: string, at: Date = new Date()): string {
  const secret = new URL(totpURI).searchParams.get("secret")
  if (secret === null) throw new Error("URI sem secret")
  const counterValue = Math.floor(at.getTime() / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counterValue))
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest()
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(code).padStart(6, "0")
}
