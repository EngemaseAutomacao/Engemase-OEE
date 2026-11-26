import type { Metadata } from "next"

import { AuthCard } from "@/components/account/auth-card"
import { NewPasswordForm } from "@/components/account/new-password-form"
import { setPasswordAction } from "../senha-actions"

export const metadata: Metadata = { title: "Criar senha", referrer: "no-referrer", robots: { index: false, follow: false } }

/**
 * Primeiro acesso (convite do admin do cliente ou do seed de plataforma): o link traz o token de uso único
 * no fragmento (`/definir-senha#t=...`), lido só no navegador (docs/15, seção 5 e item 9).
 */
export default function Page() {
  return (
    <AuthCard title="Criar sua senha" description="Primeiro acesso à plataforma Engemase OEE. Depois de salvar, entre com o seu e-mail e a nova senha.">
      <NewPasswordForm
        submit={setPasswordAction}
        doneTitle="Senha criada"
        doneText="Agora entre com o seu e-mail e a nova senha. Se quiser mais proteção, ative depois a verificação em duas etapas em &quot;Segurança da conta&quot;."
        invalidText="Este link já foi usado, venceu ou está incompleto. Peça um novo convite ao administrador da sua empresa."
      />
    </AuthCard>
  )
}
