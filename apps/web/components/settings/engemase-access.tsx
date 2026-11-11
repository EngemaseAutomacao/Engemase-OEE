"use client"

import { useState } from "react"
import Link from "next/link"
import { BadgeCheckIcon, ClockIcon, HardHatIcon, HeadsetIcon, KeyRoundIcon, ShieldCheckIcon, ShieldIcon, TimerOffIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { ConfirmAction, SoftBadge, SquareAction } from "@/components/settings/bits"
import type { EngemaseAccessKind, EngemaseAccessRow } from "@/components/settings/types"

type SupportPolicy = "logged" | "approval"

const KIND_META: Record<EngemaseAccessKind, { label: string; icon: typeof ShieldIcon; tone: IconTone }> = {
  super_admin: { label: "Acesso de plataforma", icon: ShieldCheckIcon, tone: "navy" },
  support_grant: { label: "Concessão de suporte", icon: HeadsetIcon, tone: "orange" },
  assignment: { label: "Atribuição de campo", icon: HardHatIcon, tone: "teal" },
}

const POLICIES: { value: SupportPolicy; title: string; hint: string }[] = [
  {
    value: "logged",
    title: "Liberado com registro",
    hint: "Padrão. O suporte entra com motivo, chamado e prazo de até 4 h. Tudo aparece aqui e na auditoria.",
  },
  {
    value: "approval",
    title: "Mediante aprovação",
    hint: "Cada concessão de suporte espera a aprovação de um admin do cliente antes de começar.",
  },
]

export function EngemaseAccess({
  clientSlug,
  managedByEngemase,
  initialPolicy,
  initialRows,
}: {
  clientSlug: string
  managedByEngemase: boolean
  initialPolicy: SupportPolicy
  initialRows: EngemaseAccessRow[]
}) {
  const [policy, setPolicy] = useState<SupportPolicy>(initialPolicy)
  const [rows, setRows] = useState(initialRows)
  const [ending, setEnding] = useState<EngemaseAccessRow | null>(null)

  const changePolicy = (v: SupportPolicy) => {
    setPolicy(v)
    toast.success("Política de suporte atualizada", {
      description:
        v === "approval"
          ? "Novas concessões de suporte vão aguardar a aprovação de um admin do cliente."
          : "O suporte entra com registro e prazo, sem esperar aprovação. Você continua vendo tudo aqui.",
    })
  }

  const active = rows.filter((r) => r.status !== "ended")
  const ended = rows.filter((r) => r.status === "ended")

  return (
    <SectionCard
      title="Acesso da equipe Engemase"
      description="Quem da Engemase pode ver os dados deste cliente, por quê e até quando"
      href={`/${clientSlug}/config/auditoria`}
      linkLabel="Ver na auditoria"
    >
      <div className="grid gap-5">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <KeyRoundIcon className="size-3.5" />
            Política de suporte
          </div>
          <RadioGroup value={policy} onValueChange={(v) => changePolicy(v as SupportPolicy)} className="grid gap-2 sm:grid-cols-2">
            {POLICIES.map((p) => (
              <Label
                key={p.value}
                htmlFor={`policy-${p.value}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal transition hover:bg-muted/50",
                  policy === p.value && "border-primary bg-primary/5 ring-1 ring-primary/30",
                )}
              >
                <RadioGroupItem id={`policy-${p.value}`} value={p.value} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="text-sm font-semibold">{p.title}</span>
                  <span className="text-xs leading-snug text-muted-foreground">{p.hint}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Acessos vigentes</span>
            <span className="text-xs text-muted-foreground">{active.length}</span>
          </div>
          <ul className="grid gap-2">
            {active.map((r) => (
              <AccessItem key={r.id} row={r} onEnd={r.kind === "support_grant" && r.status === "active" ? () => setEnding(r) : undefined} />
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
            Suporte e engenheiros de campo não alteram usuários nem papéis deste cliente.
          </li>
          {managedByEngemase && (
            <li className="flex gap-2">
              <BadgeCheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
              Cliente gerenciado pela Engemase: gateways, conexões e tags são configurados pela equipe de campo.
            </li>
          )}
          <li className="flex gap-2">
            <BadgeCheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>
              Acesso remoto aos gateways (VPN) é outra coisa e sempre segue a política em{" "}
              <Link href={`/${clientSlug}/acesso-remoto`} className="font-semibold text-primary hover:underline">
                Acesso remoto
              </Link>
              .
            </span>
          </li>
        </ul>
      </div>

      <ConfirmAction
        open={ending !== null}
        onOpenChange={(o) => !o && setEnding(null)}
        title="Encerrar a concessão de suporte?"
        description={
          <p>
            {ending?.person} perde o acesso aos dados deste cliente agora{ending?.ticket ? ` (chamado ${ending.ticket})` : ""}. Se o atendimento ainda não terminou, o suporte
            precisará pedir uma nova concessão.
          </p>
        }
        confirmLabel="Encerrar agora"
        onConfirm={() => {
          if (ending) {
            setRows((list) => list.map((x) => (x.id === ending.id ? { ...x, status: "ended", remaining: null, endLabel: "agora (encerrada pelo cliente)" } : x)))
            toast.success(`Concessão de ${ending.person} encerrada`, { description: "A Engemase foi avisada por e-mail. Registrado na auditoria." })
          }
          setEnding(null)
        }}
      />
    </SectionCard>
  )
}

function AccessItem({ row, onEnd }: { row: EngemaseAccessRow; onEnd?: () => void }) {
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
          {row.status === "ended" && <SoftBadge tone="slate">Encerrada</SoftBadge>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {meta.label} · {row.reason}
          {row.ticket && <span className="font-medium text-foreground"> · chamado {row.ticket}</span>}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {row.status === "permanent" ? `Desde ${row.startLabel} · sem prazo, sempre auditado` : `${row.startLabel} → ${row.endLabel ?? "—"}`} · {row.units}
        </p>
      </div>
      {onEnd && <SquareAction icon={TimerOffIcon} label="Encerrar concessão agora" tone="red" onClick={onEnd} />}
    </li>
  )
}
