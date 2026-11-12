import { ArrowUpFromLineIcon, FileClockIcon, KeyRoundIcon, PowerOffIcon, SplitIcon, TimerIcon, type LucideIcon } from "lucide-react"

import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"

const ITEMS: { icon: LucideIcon; tone: IconTone; title: string; text: React.ReactNode }[] = [
  { icon: PowerOffIcon, tone: "navy", title: "Desligada por padrão", text: "A VPN só existe durante uma sessão aprovada e nunca religa sozinha após um reboot." },
  { icon: ArrowUpFromLineIcon, tone: "blue", title: "Só conexões de saída (443)", text: "Nenhuma porta aberta no firewall da fábrica." },
  { icon: SplitIcon, tone: "teal", title: "O gateway não roteia", text: "Acesso a CLP é um único IP:porta, aprovado caso a caso." },
  { icon: TimerIcon, tone: "orange", title: "Expira sozinha", text: "Por prazo, inatividade ou teto local de 8 h — mesmo sem internet." },
  {
    icon: KeyRoundIcon,
    tone: "violet",
    title: "Você tem a palavra final",
    text: (
      <>
        O kill switch local <code className="rounded bg-muted px-1 font-mono text-[11px]">oee-gateway remote-access off --lock</code> prevalece sobre a plataforma.
      </>
    ),
  },
  { icon: FileClockIcon, tone: "slate", title: "Tudo auditado", text: "Pedido, aprovação, conexões, tráfego e encerramento, com resumo por e-mail." },
]

/** Garantias do acesso remoto (docs/12), para o cliente entender o que está aprovando. */
export function RemoteGuarantees({ className, guideHref }: { className?: string; guideHref: string }) {
  return (
    <SectionCard title="Como sua fábrica fica protegida" href={guideHref} linkLabel="Ver guia" className={className}>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        {ITEMS.map((it) => (
          <li key={it.title} className="flex items-start gap-3">
            <IconCircle icon={it.icon} tone={it.tone} soft size="sm" />
            <div className="min-w-0 leading-snug">
              <div className="text-sm font-medium">{it.title}</div>
              <p className="text-xs text-muted-foreground">{it.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}
