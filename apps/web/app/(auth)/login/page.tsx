import type { Metadata } from "next"
import { CableIcon, GaugeIcon, ShieldCheckIcon, TabletSmartphoneIcon } from "lucide-react"

import { AuthHeading, AuthShell, GlassCard, PanelFeatures, PanelIntro, type PanelFeature } from "@/components/account/auth-card"
import { LoginForm } from "@/components/kiosk/login-form"
import { LoginShowcase } from "@/components/kiosk/login-showcase"

export const metadata: Metadata = { title: "Entrar" }

const FEATURES: readonly PanelFeature[] = [
  { icon: GaugeIcon, color: "#7cc0ec", title: "OEE ao vivo", text: "Por máquina, linha e unidade, minuto a minuto." },
  { icon: TabletSmartphoneIcon, color: "#5fd4a6", title: "Paradas no chão", text: "O operador aponta o motivo na hora, no tablet." },
  { icon: CableIcon, color: "#f3a28f", title: "Conecta ao que já existe", text: "Modbus TCP/IP ou RTU (RS-485), sem trocar CLPs." },
  { icon: ShieldCheckIcon, color: "#c9d6e4", title: "Dados isolados", text: "Papéis por unidade e trilha de auditoria." },
]

/** Exemplo de máquina do chão de fábrica para a tela do operador após o login por PIN. */
const OPERATOR_DEMO_HREF = "/plastiform/operador/mch_inj03"

export default function Page() {
  return (
    <AuthShell
      panel={
        <>
          <div className="max-w-xl 2xl:w-[29rem] 2xl:shrink-0">
            <PanelIntro
              eyebrow="Eficiência industrial"
              title="Do CLP ao indicador,"
              highlight="em tempo real."
              text="Os sinais das suas máquinas viram OEE, paradas classificadas e relatórios por turno, para você saber onde está cada minuto perdido."
            />
            <PanelFeatures items={FEATURES} />
          </div>
          <LoginShowcase className="hidden [@media(min-height:700px)]:grid 2xl:grid 2xl:flex-1" />
        </>
      }
    >
      <GlassCard>
        <AuthHeading eyebrow="Bem-vindo de volta" title="Entrar" description="Acesse a plataforma com sua conta. Operadores usam usuário e PIN." />
        <LoginForm operatorHref={OPERATOR_DEMO_HREF} />
      </GlassCard>
    </AuthShell>
  )
}
