import type { Metadata } from "next"

import { AuthCard } from "@/components/account/auth-card"
import { NewPasswordForm } from "@/components/account/new-password-form"
import { resetPasswordAction } from "../senha-actions"

export const metadata: Metadata = { title: "Nova senha", referrer: "no-referrer", robots: { index: false, follow: false } }

/**
 * Redefinição de senha ("Esqueci minha senha" no login): o link do e-mail traz o token no fragmento
 * (`/redefinir-senha#t=...`), vale 30 minutos e uma vez só. Salvar encerra as sessões abertas.
 */
export default function Page() {
  return (
    <AuthCard title="Criar nova senha" description="Escolha uma nova senha para a sua conta. As sessões abertas em outros aparelhos serão encerradas.">
      <NewPasswordForm
        submit={resetPasswordAction}
        doneTitle="Senha alterada"
        doneText="Entre com o seu e-mail e a nova senha."
        invalidText="Este link já foi usado, venceu (vale 30 minutos) ou está incompleto. Peça outro em “Esqueci minha senha”, na tela de login."
      />
    </AuthCard>
  )
}
