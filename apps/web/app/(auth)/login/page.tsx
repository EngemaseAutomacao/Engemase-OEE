import type { Metadata } from "next"
import { CableIcon, GaugeIcon, ShieldCheckIcon, TabletSmartphoneIcon } from "lucide-react"

import { IconCircle } from "@/components/dashboard/icon-circle"
import { BrandLogo, BrandWatermark } from "@/components/shell/brand"
import { ThemeToggle } from "@/components/theme-toggle"
import { LoginForm } from "@/components/kiosk/login-form"
import { LoginShowcase } from "@/components/kiosk/login-showcase"

export const metadata: Metadata = { title: "Entrar" }

const FEATURES = [
  {
    icon: GaugeIcon,
    tone: "blue",
    title: "OEE ao vivo por máquina, linha e unidade",
    text: "Disponibilidade, performance e qualidade calculadas a partir dos sinais do CLP, minuto a minuto.",
  },
  {
    icon: TabletSmartphoneIcon,
    tone: "teal",
    title: "Paradas classificadas no chão de fábrica",
    text: "O operador aponta o motivo na hora, com botões grandes pensados para tablet e uso com luva.",
  },
  {
    icon: CableIcon,
    tone: "orange",
    title: "Conecta ao que você já tem",
    text: "Modbus TCP/IP ou Modbus RTU via RS-485, com vários escravos no mesmo barramento. Sem trocar CLPs.",
  },
  {
    icon: ShieldCheckIcon,
    tone: "navy",
    title: "Dados isolados e auditados",
    text: "Cada cliente vê só os seus dados, com papéis por unidade e trilha de auditoria completa.",
  },
] as const

/** Exemplo de máquina do chão de fábrica para a tela do operador após o login por PIN. */
const OPERATOR_DEMO_HREF = "/plastiform/operador/mch_inj03"

export default function Page() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Painel de marca (só em telas largas). `dark` fixo: azul-marinho Engemase nos dois temas. */}
      <aside className="dark relative isolate hidden overflow-hidden bg-[#13263b] text-foreground lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_55%_at_0%_0%,rgba(37,123,180,0.38),transparent),radial-gradient(55%_45%_at_100%_100%,rgba(233,101,73,0.20),transparent)]"
        />
        <BrandWatermark className="absolute -right-24 -bottom-20 -z-10 w-[640px] dark:opacity-[0.12]" />

        <div className="flex flex-1 flex-col gap-8 p-10 xl:px-14">
          <div className="flex items-center gap-4">
            <BrandLogo variant="selo" width={96} priority className="rounded-full shadow-lg ring-4 ring-white/10" />
            <div className="grid leading-tight">
              <span className="text-lg font-bold text-white">Engemase OEE</span>
              <span className="text-sm text-muted-foreground">Plataforma de eficiência industrial</span>
            </div>
          </div>

          <div className="max-w-xl">
            <h2 className="text-3xl leading-tight font-bold tracking-tight text-balance text-white xl:text-4xl">Do CLP ao indicador, em tempo real.</h2>
            <p className="mt-4 text-base text-muted-foreground">
              Transformamos os sinais das suas máquinas em OEE, paradas classificadas e relatórios por turno, para você saber onde está cada
              minuto perdido.
            </p>
          </div>

          <ul className="grid max-w-xl gap-4">
            {FEATURES.map(({ icon, tone, title, text }) => (
              <li key={title} className="flex gap-4">
                <IconCircle icon={icon} tone={tone} />
                <div>
                  <div className="font-semibold text-white">{title}</div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ul>

          <LoginShowcase className="mt-auto hidden max-w-xl [@media(min-height:960px)]:block" />
        </div>
        <div className="flex items-center justify-between border-t border-white/10 px-10 py-4 text-xs text-muted-foreground xl:px-14">
          <span>© 2026 Engemase Engenharia</span>
          <span>Ambiente de demonstração · dados simulados</span>
        </div>
      </aside>

      <main className="relative isolate flex flex-col overflow-hidden bg-background">
        {/* Marca d'água discreta (só no celular/tablet, onde o painel de marca some) */}
        <BrandWatermark className="absolute -top-6 -right-24 -z-10 w-[340px] opacity-40 lg:hidden" />

        <div className="flex items-center justify-between gap-2 p-4 md:px-8">
          <BrandLogo width={112} priority className="lg:invisible" />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-start justify-center px-4 pt-2 pb-10 sm:items-center sm:pt-0 md:px-8">
          <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight">Entrar</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">Acesse a plataforma com sua conta. Operadores usam usuário e PIN.</p>
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
