import Link from "next/link"
import {
  ActivityIcon,
  BellRingIcon,
  CheckCircle2Icon,
  HeadsetIcon,
  LayoutDashboardIcon,
  MailIcon,
  MessageCircleIcon,
  PhoneIcon,
  RadioTowerIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react"

import { MOCK_NOW } from "@/lib/mock"
import { date, time } from "@/lib/format"
import { cn } from "@/lib/utils"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { OpenTicketButton } from "./help-provider"

/** Versão exibida no rodapé de status (protótipo). */
const PLATFORM_VERSION = "0.1.0"

const SUPPORT = {
  email: "suporte@engemase.exemplo.com.br",
  phone: "(47) 3000-0000",
  phoneHref: "tel:+554730000000",
  whatsapp: "(47) 99999-0000",
  whatsappHref: "https://wa.me/5547999990000",
}

function Channel({ icon, label, value, href }: { icon: LucideIcon; label: string; value: string; href: string }) {
  return (
    <li>
      <a href={href} className="group flex items-center gap-3 py-2.5" target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
        <IconCircle icon={icon} tone="slate" size="sm" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[11px] text-muted-foreground">{label}</span>
          <span className="block truncate text-sm font-medium group-hover:text-primary">{value}</span>
        </span>
      </a>
    </li>
  )
}

/** Cartão de contato com o suporte da Engemase. */
export function ContactCard({ remoteHref }: { remoteHref: string }) {
  return (
    <SectionCard title="Fale com a Engemase" description="Suporte técnico da plataforma, dos gateways e da integração com os CLPs">
      <div className="flex items-center gap-3 rounded-xl bg-[#0e9384]/8 p-3">
        <IconCircle icon={HeadsetIcon} tone="teal" />
        <div className="min-w-0 text-xs leading-relaxed">
          <div className="text-sm font-semibold">Engemase Automação</div>
          <div className="text-muted-foreground">Seg. a sex., 7h30–18h · chamados críticos com plantão, conforme o contrato</div>
        </div>
      </div>
      <OpenTicketButton className="mt-3 w-full" />
      <ul className="mt-2 divide-y">
        <Channel icon={MailIcon} label="E-mail" value={SUPPORT.email} href={`mailto:${SUPPORT.email}`} />
        <Channel icon={PhoneIcon} label="Telefone" value={SUPPORT.phone} href={SUPPORT.phoneHref} />
        <Channel icon={MessageCircleIcon} label="WhatsApp" value={SUPPORT.whatsapp} href={SUPPORT.whatsappHref} />
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Precisa que a Engemase acesse um gateway?{" "}
        <Link href={remoteHref} className="font-semibold text-primary hover:underline">
          Veja os pedidos de acesso remoto
        </Link>
        .
      </p>
    </SectionCard>
  )
}

const SERVICES: { icon: LucideIcon; name: string; detail: string }[] = [
  { icon: LayoutDashboardIcon, name: "Painel e relatórios", detail: "Telas, relatórios e exportações" },
  { icon: RadioTowerIcon, name: "Recebimento de dados", detail: "Conexão dos gateways (HTTPS 443)" },
  { icon: BellRingIcon, name: "Notificações", detail: "Sino, push e e-mail" },
  { icon: ShieldCheckIcon, name: "Acesso remoto", detail: "VPN de manutenção sob demanda" },
]

/** Status dos serviços da plataforma, gateways do cliente e versão. */
export function PlatformStatusCard({
  gatewaysOnline,
  gatewaysTotal,
  offlineNames,
  agentVersion,
  outdatedAgents,
  gatewaysHref,
}: {
  gatewaysOnline: number
  gatewaysTotal: number
  offlineNames: string[]
  agentVersion: string | null
  outdatedAgents: boolean
  gatewaysHref: string
}) {
  const gwOk = offlineNames.length === 0
  return (
    <SectionCard
      title="Status da plataforma"
      description={`Verificado às ${time(MOCK_NOW)}`}
      action={
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-state-running/12 px-2.5 py-1 text-[11px] font-semibold text-state-running">
          <span className="size-1.5 animate-pulse rounded-full bg-state-running" />
          Operacional
        </span>
      }
    >
      <div className="flex items-center gap-2 rounded-xl border border-state-running/25 bg-state-running/8 px-3 py-2.5 text-sm font-medium">
        <CheckCircle2Icon className="size-4 shrink-0 text-state-running" />
        Todos os serviços operando normalmente
      </div>
      <ul className="mt-3 grid gap-2.5">
        {SERVICES.map((s) => (
          <li key={s.name} className="flex items-center gap-3">
            <s.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm">{s.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{s.detail}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-state-running">
              <span className="size-2 rounded-full bg-state-running" />
              Operacional
            </span>
          </li>
        ))}
      </ul>

      <Link
        href={gatewaysHref}
        className={cn(
          "mt-4 flex items-center gap-3 rounded-xl border p-3 transition hover:bg-muted/50",
          !gwOk && "border-state-stopped/40 bg-state-stopped/8 hover:bg-state-stopped/12",
        )}
      >
        <IconCircle icon={ActivityIcon} tone={gwOk ? "teal" : "amber"} soft size="sm" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-sm font-medium">
            Seus gateways: {gatewaysOnline} de {gatewaysTotal} conectados
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {gwOk ? "Nenhum gateway offline agora" : `${offlineNames.join(", ")} offline · os dados ficam guardados no gateway`}
          </span>
        </span>
      </Link>

      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/60 p-3">
        <div className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">Plataforma</dt>
          <dd className="truncate text-sm font-semibold tabular-nums">v{PLATFORM_VERSION}</dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">Agente gateway</dt>
          <dd className="truncate text-sm font-semibold tabular-nums">
            {agentVersion ? `v${agentVersion}` : "—"}
            {outdatedAgents && (
              <span title="Há gateways com versão anterior do agente" className="ml-1.5 inline-block size-1.5 rounded-full bg-state-stopped align-middle">
                <span className="sr-only">Há gateways com versão anterior do agente</span>
              </span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">Atualizado em</dt>
          <dd className="truncate text-sm font-semibold tabular-nums">{date(MOCK_NOW)}</dd>
        </div>
      </dl>
    </SectionCard>
  )
}
