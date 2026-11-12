"use client"

import Link from "next/link"
import { BadgeCheckIcon, ClockIcon, EyeIcon, HardHatIcon, HeadsetIcon, ShieldCheckIcon, ShieldIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { SoftBadge } from "@/components/settings/bits"
import type { EngemaseAccessKind, EngemaseAccessRow } from "@/components/settings/types"

const KIND_META: Record<EngemaseAccessKind, { label: string; icon: typeof ShieldIcon; tone: IconTone }> = {
  super_admin: { label: "Acesso de plataforma", icon: ShieldCheckIcon, tone: "navy" },
  support_grant: { label: "Atendimento de suporte", icon: HeadsetIcon, tone: "orange" },
  assignment: { label: "Atribuição de campo", icon: HardHatIcon, tone: "teal" },
}

/**
 * Acesso da Engemase aos dados do cliente (decisão D5): sempre liberado e sempre registrado.
 * Não existe mais a opção "mediante aprovação do cliente"; o quadro é só informativo.
 * A aprovação de sessões de acesso remoto aos gateways (VPN) é outra coisa e continua em "Acesso remoto".
 */
export function EngemaseAccess({ clientSlug, rows }: { clientSlug: string; rows: EngemaseAccessRow[] }) {
  const active = rows.filter((r) => r.status !== "ended")
  const ended = rows.filter((r) => r.status === "ended")

  return (
    <SectionCard
      title="Acesso da equipe Engemase"
      description="A Engemase sempre tem acesso aos dados deste cliente, com registro na auditoria"
      href={`/${clientSlug}/config/auditoria`}
      linkLabel="Ver na auditoria"
    >
      <div className="grid gap-5">
        <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
          <IconCircle icon={EyeIcon} tone="blue" soft size="sm" />
          <div className="grid gap-0.5">
            <span className="text-sm font-semibold">Sempre liberado, sempre registrado</span>
            <span className="text-xs leading-snug text-muted-foreground">
              A Engemase administra a plataforma e a configuração deste cliente e acessa os dados de produção sem pedir aprovação. Faz parte do serviço contratado.
              Quem entrou, quando e por quê fica nesta lista e na auditoria.
            </span>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Acessos vigentes</span>
            <span className="text-xs text-muted-foreground">{active.length}</span>
          </div>
          <ul className="grid gap-2">
            {active.map((r) => (
              <AccessItem key={r.id} row={r} />
            ))}
            {active.length === 0 && <li className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhum acesso da Engemase em andamento.</li>}
          </ul>
        </div>

        {ended.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Encerrados recentemente</div>
            <ul className="grid gap-2">
              {ended.map((r) => (
                <AccessItem key={r.id} row={r} />
              ))}
            </ul>
          </div>
        )}

        <ul className="grid gap-1.5 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
          <li className="flex gap-2">
            <BadgeCheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
            Toda entrada da Engemase mostra uma faixa na tela e fica na auditoria com nome, motivo e chamado.
          </li>
          <li className="flex gap-2">
            <BadgeCheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
            Unidades, máquinas, gateways, tags, terminais, turnos, produtos, motivos e aparência são configurados pela equipe Engemase.
          </li>
          <li className="flex gap-2">
            <BadgeCheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
            Suporte e engenheiros de campo não alteram usuários nem papéis deste cliente: isso é com o admin do cliente.
          </li>
          <li className="flex gap-2">
            <BadgeCheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>
              Acesso remoto aos gateways (VPN) é outra coisa: cada sessão segue a política e a aprovação em{" "}
              <Link href={`/${clientSlug}/acesso-remoto`} className="font-semibold text-primary hover:underline">
                Acesso remoto
              </Link>
              .
            </span>
          </li>
        </ul>
      </div>
    </SectionCard>
  )
}

function AccessItem({ row }: { row: EngemaseAccessRow }) {
  const meta = KIND_META[row.kind]
  return (
    <li className={cn("flex items-start gap-3 rounded-xl border p-3", row.status === "ended" && "bg-muted/30 opacity-75")}>
      <IconCircle icon={meta.icon} tone={meta.tone} soft size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{row.person}</span>
          <SoftBadge tone={meta.tone === "navy" ? "navy" : meta.tone === "orange" ? "orange" : "teal"}>{row.roleLabel}</SoftBadge>
          {row.status === "active" && row.remaining && (
            <SoftBadge tone="blue" icon={ClockIcon}>
              {row.remaining}
            </SoftBadge>
          )}
          {row.status === "ended" && <SoftBadge tone="slate">Encerrado</SoftBadge>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {meta.label} · {row.reason}
          {row.ticket && <span className="font-medium text-foreground"> · chamado {row.ticket}</span>}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {row.status === "permanent" ? `Desde ${row.startLabel} · sem prazo, sempre auditado` : `${row.startLabel} → ${row.endLabel ?? "—"}`} · {row.units}
        </p>
      </div>
    </li>
  )
}
