import type { Metadata } from "next"
import { CableIcon, GaugeIcon, ShieldCheckIcon, TabletSmartphoneIcon } from "lucide-react"

import { Brand } from "@/components/shell/brand"
import { ThemeToggle } from "@/components/theme-toggle"
import { LoginForm } from "@/components/kiosk/login-form"
import { LoginShowcase } from "@/components/kiosk/login-showcase"

export const metadata: Metadata = { title: "Entrar" }

const FEATURES = [
  {
    icon: GaugeIcon,
    title: "OEE ao vivo por máquina, linha e unidade",
    text: "Disponibilidade, performance e qualidade calculadas a partir dos sinais do CLP, minuto a minuto.",
  },
  {
    icon: TabletSmartphoneIcon,
    title: "Paradas classificadas no chão de fábrica",
    text: "O operador aponta o motivo na hora, com botões grandes pensados para tablet e uso com luva.",
  },
  {
    icon: CableIcon,
    title: "Conecta ao que você já tem",
    text: "Modbus TCP/IP ou Modbus RTU via RS-485, com vários escravos no mesmo barramento. Sem trocar CLPs.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Dados isolados e auditados",
    text: "Cada cliente vê só os seus dados, com papéis por unidade e trilha de auditoria completa.",
  },
]

/** Exemplo de máquina do chão de fábrica para a tela do operador após o login por PIN. */
const OPERATOR_DEMO_HREF = "/plastiform/operador/mch_inj03"

export default function Page() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Painel de marca (só em telas largas). `dark` fixo: mantém a identidade escura nos dois temas. */}
      <aside className="dark relative hidden overflow-hidden bg-background text-foreground lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_0%_0%,color-mix(in_oklch,var(--primary)_22%,transparent),transparent),radial-gradient(50%_50%_at_100%_100%,color-mix(in_oklch,var(--state-running)_12%,transparent),transparent)]"
        />
        <div className="relative flex flex-1 flex-col gap-10 p-10 xl:p-14">
          <Brand subtitle="por Engemase Automação" />

          <div className="max-w-xl">
            <h2 className="text-3xl leading-tight font-semibold tracking-tight text-balance xl:text-4xl">
              Do CLP ao indicador, em tempo real.
            </h2>
            <p className="mt-4 text-base text-muted-foreground">
              Transformamos os sinais das suas máquinas em OEE, paradas classificadas e relatórios por turno, para você saber onde está
              cada minuto perdido.
            </p>
          </div>

          <ul className="grid max-w-xl gap-5">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Icon className="size-5" />
                </div>
                <div>
                  <div className="font-medium">{title}</div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ul>

          <LoginShowcase className="mt-auto max-w-xl" />
        </div>
        <div className="relative flex items-center justify-between border-t px-10 py-4 text-xs text-muted-foreground xl:px-14">
          <span>© 2026 Engemase Automação</span>
          <span>Ambiente de demonstração · dados simulados</span>
        </div>
      </aside>

      <main className="flex flex-col bg-background">
        <div className="flex items-center justify-between gap-2 p-4 md:px-8">
          <Brand subtitle="Plataforma de OEE" className="lg:invisible" />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-start justify-center px-4 pt-4 pb-10 sm:items-center sm:pt-0 md:px-8">
          <div className="w-full max-w-sm">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
              <p className="mt-1 text-sm text-muted-foreground">Acesse a plataforma com sua conta. Operadores usam usuário e PIN.</p>
            </div>
            <LoginForm operatorHref={OPERATOR_DEMO_HREF} />
          </div>
        </div>
        <p className="px-4 pb-6 text-center text-xs text-muted-foreground md:px-8">
          Problemas para acessar? Fale com o administrador da sua empresa ou com o suporte Engemase.
        </p>
      </main>
    </div>
  )
}
