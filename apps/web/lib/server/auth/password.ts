/**
 * Política de senha (L20): 12 caracteres ou mais, sem regra de composição, recusada se aparecer em
 * vazamentos conhecidos.
 *
 * A consulta de vazamento usa k-anonimato (Pwned Passwords): só os 5 primeiros caracteres do SHA-1
 * saem do servidor; a comparação do resto é local. Com falha de rede, tempo esgotado ou resposta
 * estranha, o resultado é "não sei" (`null`) e a senha é ACEITA — a checagem nunca derruba a troca de
 * senha, e o login nunca passa por ela (só senha nova é conferida).
 */
import { createHash } from "node:crypto"

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

/** Mensagem de erro da política (em português) ou `null` se a senha passa. */
export function passwordPolicyError(password: string): string | null {
  // Conta caracteres (pontos de código), não bytes nem unidades UTF-16.
  const length = [...password].length
  if (length < PASSWORD_MIN_LENGTH) return `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`
  if (length > PASSWORD_MAX_LENGTH) return `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`
  return null
}

const PWNED_RANGE_URL = "https://api.pwnedpasswords.com/range/"

export interface PwnedCheckOptions {
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}

/**
 * A senha aparece em vazamentos conhecidos? `true` sim, `false` não, `null` não deu para saber
 * (rede, tempo-limite, resposta inválida) — quem chama deve aceitar a senha nesse caso.
 */
export async function isPasswordPwned(password: string, options: PwnedCheckOptions = {}): Promise<boolean | null> {
  const doFetch = options.fetch ?? globalThis.fetch
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase()
  const prefix = sha1.slice(0, 5)
  const suffix = sha1.slice(5)
  try {
    const response = await doFetch(`${PWNED_RANGE_URL}${prefix}`, {
      // Padding: a resposta tem tamanho parecido para qualquer prefixo (não revela qual foi pedido).
      headers: { "Add-Padding": "true", "User-Agent": "engemase-oee" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 2_500),
      cache: "no-store",
    })
    if (!response.ok) return null
    const body = await response.text()
    for (const line of body.split("\n")) {
      const [hashSuffix, count] = line.trim().split(":")
      if (hashSuffix?.toUpperCase() === suffix) return Number(count) > 0
    }
    return false
  } catch {
    return null
  }
}

/** Valida uma senha NOVA: política + vazamento. Devolve a mensagem de erro ou `null`. */
export async function newPasswordError(
  password: string,
  pwned: (password: string) => Promise<boolean | null> = isPasswordPwned,
): Promise<string | null> {
  const policy = passwordPolicyError(password)
  if (policy !== null) return policy
  if ((await pwned(password)) === true) {
    return "Esta senha aparece em vazamentos conhecidos na internet. Escolha outra."
  }
  return null
}
