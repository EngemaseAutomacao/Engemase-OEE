/**
 * Envio de e-mail transacional (docs/15, seção 5): "definir senha", redefinição de senha, aviso de conta
 * bloqueada e de verificação em duas etapas reiniciada.
 *
 * Ainda não há provedor contratado. A interface é uma função (`EmailSender`); hoje há duas:
 * - **Resend** (API HTTP, tempo-limite de 10 s), quando `RESEND_API_KEY` e `EMAIL_FROM` existem;
 * - **registro no log** (padrão): escreve destinatário mascarado e assunto. Fora de produção
 *   (`NODE_ENV` ≠ production) também o texto, para quem desenvolve pegar o link no terminal; em
 *   produção NUNCA o texto (o link "definir/redefinir senha" é uma credencial, docs/15 item 9).
 *
 * Falha no envio nunca desfaz a operação que pediu o e-mail (quem chama registra e segue).
 */

export interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
  /** Evita envio duplicado numa nova tentativa (cabeçalho Idempotency-Key do Resend). */
  readonly idempotencyKey?: string
}

export type EmailResult =
  | { readonly status: "sent"; readonly provider: "resend"; readonly id: string | null }
  | { readonly status: "logged" }
  | { readonly status: "failed"; readonly error: string }

export type EmailSender = (message: EmailMessage) => Promise<EmailResult>

type Env = Readonly<Record<string, string | undefined>>

/** `nome@empresa.com` → `n***@empresa.com` (para log; nunca o e-mail inteiro). */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@")
  return `${local.slice(0, 1)}***@${domain}`
}

export interface EmailSenderDeps {
  readonly env?: Env
  readonly fetch?: typeof fetch
  readonly log?: (line: string) => void
}

/** Escolhe o envio pelas variáveis de ambiente (ver o cabeçalho). */
export function createEmailSender(deps: EmailSenderDeps = {}): EmailSender {
  const env = deps.env ?? process.env
  const log = deps.log ?? ((line: string) => console.info(line))
  const apiKey = env.RESEND_API_KEY?.trim() ?? ""
  const from = env.EMAIL_FROM?.trim() ?? ""
  if (apiKey !== "" && from !== "") return resendSender(apiKey, from, deps.fetch ?? fetch)
  const verbose = env.NODE_ENV !== "production"
  return async (message) => {
    log(`[e-mail] sem provedor configurado (RESEND_API_KEY/EMAIL_FROM): para ${maskEmail(message.to)}, assunto "${message.subject}"`)
    if (verbose) log(`[e-mail] (só fora de produção) texto:\n${message.text}`)
    return { status: "logged" }
  }
}

function resendSender(apiKey: string, from: string, doFetch: typeof fetch): EmailSender {
  return async (message) => {
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
      if (message.idempotencyKey !== undefined) headers["Idempotency-Key"] = message.idempotencyKey
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers,
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        // Sem o corpo inteiro no erro (pode ecoar o e-mail); só o status.
        return { status: "failed", error: `Resend respondeu ${res.status}` }
      }
      const body = (await res.json().catch(() => null)) as { id?: unknown } | null
      return { status: "sent", provider: "resend", id: typeof body?.id === "string" ? body.id : null }
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.name : "erro desconhecido" }
    }
  }
}

let cached: { readonly key: string; readonly sender: EmailSender } | undefined

/** Envio do app (variáveis de `process.env`). */
export function getEmailSender(): EmailSender {
  const key = `${process.env.RESEND_API_KEY ?? ""}|${process.env.EMAIL_FROM ?? ""}`
  if (cached?.key !== key) cached = { key, sender: createEmailSender() }
  return cached.sender
}

/** Envia e registra a falha (sem lançar): para avisos que não podem derrubar a operação principal. */
export async function sendSafely(sender: EmailSender, message: EmailMessage, label: string): Promise<EmailResult> {
  try {
    const result = await sender(message)
    if (result.status === "failed") console.error(`[e-mail] falha ao enviar "${label}" para ${maskEmail(message.to)}: ${result.error}`)
    return result
  } catch (error) {
    console.error(`[e-mail] falha ao enviar "${label}" para ${maskEmail(message.to)}`, error)
    return { status: "failed", error: "exceção no envio" }
  }
}
