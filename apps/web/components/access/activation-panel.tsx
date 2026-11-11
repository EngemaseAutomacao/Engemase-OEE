"use client"

import { useState } from "react"
import Link from "next/link"
import { ActivityIcon, CableIcon, CloudUploadIcon, FactoryIcon, KeyRoundIcon, PlusIcon, TagsIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { ActivityTimeline, type TimelineEvent } from "@/components/dashboard/activity-timeline"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { Checkbox } from "@/components/ui/checkbox"
import { ActivationSteps, useActivationCode } from "./activation-steps"
import type { GatewayDetail } from "./gateway-detail-data"
import { Chip } from "./status-chip"

const CHECKLIST = [
  "Computador industrial com Debian 12 e acesso de administrador (sudo)",
  "Rede de TI (eth0): saída HTTPS 443 para oee.engemase.com.br e NTP liberados",
  "Rede OT (eth1): IP fixo na faixa dos CLPs, sem rota para a rede de TI",
  "RS-485: cabo blindado com fio de comum (0 V) e terminação de 120 Ω nas pontas",
  "Mapa Modbus dos CLPs em mãos (ou bloco OEE padrão Engemase no programa)",
  "Contato da TI do cliente para liberar o firewall, se preciso",
]

/** Detalhe de um gateway "aguardando ativação": o fluxo de ativação em destaque. */
export function ActivationPanel({
  name,
  activation,
  machines,
  machineHref,
  machinesHref,
}: {
  name: string
  activation: NonNullable<GatewayDetail["activation"]>
  machines: GatewayDetail["machines"]
  machineHref: (id: string) => string
  machinesHref: string
}) {
  const act = useActivationCode(
    name,
    { code: activation.code, expired: activation.expired, expiresLabel: activation.expiresLabel },
    activation.freshExpiresLabel,
  )
  const [done, setDone] = useState<Set<number>>(new Set())

  const toggle = (i: number) =>
    setDone((d) => {
      const n = new Set(d)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })

  const timeline: TimelineEvent[] = [
    {
      id: "created",
      icon: PlusIcon,
      tone: "teal",
      title: "Gateway criado",
      subtitle: activation.createdBy ? `por ${activation.createdBy}` : "na plataforma",
      time: activation.createdLabel ?? "—",
    },
    { id: "activate", icon: KeyRoundIcon, tone: "blue", title: "Ativação no local", subtitle: "código + comandos", time: "agora" },
    { id: "conn", icon: CableIcon, tone: "slate", title: "Conexões Modbus", subtitle: "TCP ou RS-485", time: "testar conexão" },
    { id: "tags", icon: TagsIcon, tone: "slate", title: "Tags por papel", subtitle: "rodando, contagem…", time: "ler cada tag" },
    { id: "publish", icon: CloudUploadIcon, tone: "slate", title: "Publicar configuração", subtitle: "v2 no gateway", time: "ativar" },
    { id: "live", icon: ActivityIcon, tone: "slate", title: "Acompanhar ao vivo", subtitle: "OEE em tempo real", time: "pronto" },
  ]

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <SectionCard
        title="Ative este gateway"
        description="Instale o agente e use o código no terminal do gateway, na fábrica. O código vale para uma única ativação."
        className="border-primary/40 ring-4 ring-primary/10 xl:col-span-7"
      >
        <ActivationSteps code={act.code} expired={act.expired} expiresLabel={act.expiresLabel} onRegenerate={act.regenerate} />
      </SectionCard>

      <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
        <SectionCard title="Antes de ir à fábrica" description={`Pré-requisitos · ${done.size} de ${CHECKLIST.length} conferidos`}>
          <ul className="flex flex-col gap-2.5">
            {CHECKLIST.map((item, i) => (
              <li key={item}>
                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <Checkbox checked={done.has(i)} onCheckedChange={() => toggle(i)} className="mt-0.5" />
                  <span className={cn(done.has(i) && "text-muted-foreground line-through")}>{item}</span>
                </label>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Máquinas previstas" description="Serão alimentadas por este gateway" href={machinesHref} linkLabel="Ver máquinas">
          {machines.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma máquina vinculada ainda.</p>
          ) : (
            <ul className="divide-y">
              {machines.map((m) => (
                <li key={m.id}>
                  <Link href={machineHref(m.id)} className="group flex items-center gap-3 py-2.5">
                    <IconCircle icon={FactoryIcon} tone="navy" soft size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium group-hover:text-primary">{m.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{m.code}</span>
                    </span>
                    <Chip className={m.hasDevice ? "bg-state-running/12 text-state-running" : "bg-muted text-muted-foreground"}>
                      {m.hasDevice ? "CLP mapeado" : "Sem conexão de CLP"}
                    </Chip>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Do código à máquina no ar" description="Depois da ativação, sem SSH e sem desenvolvedor" className="xl:col-span-12">
        <ActivityTimeline events={timeline} />
      </SectionCard>
    </div>
  )
}
