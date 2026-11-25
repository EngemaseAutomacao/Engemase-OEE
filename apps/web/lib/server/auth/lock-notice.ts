/**
 * Aviso por e-mail de conta bloqueada por senhas erradas (L20). O bloqueio vale também para e-mail que
 * não existe (não revela quem tem conta); o aviso só sai para conta que existe e não está banida, e o
 * envio vai para depois da resposta (`defer`), sem mudar o tempo do login.
 */
import { user } from "@engemase/db"
import { sql } from "drizzle-orm"
import { type EmailSender, getEmailSender, sendSafely } from "@/lib/server/email"
import { accountLockedEmail } from "@/lib/server/email/templates"
import type { LockNotice } from "./auth"
import type { ThrottleDb } from "./throttle"

/** Avisa a dona da conta que ela foi bloqueada (só se a conta existe e não está banida). */
export function lockNotifier(
  db: ThrottleDb,
  baseURL: string,
  defer: (task: () => Promise<unknown>) => void,
  sender: () => EmailSender = getEmailSender,
) {
  return async (notice: LockNotice): Promise<void> => {
    const [person] = await db
      .select({ email: user.email, name: user.name, banned: user.banned })
      .from(user)
      .where(sql`lower(${user.email}) = ${notice.email.trim().toLowerCase()}`)
      .limit(1)
    if (person === undefined || person.banned) return
    defer(() =>
      sendSafely(
        sender(),
        accountLockedEmail({ to: person.email, name: person.name, until: notice.until, resetUrl: `${baseURL}/login` }),
        "conta bloqueada",
      ),
    )
  }
}
