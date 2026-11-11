"use client"

import { CalendarRangeIcon, CheckIcon, FingerprintIcon, KeyRoundIcon, TriangleAlertIcon, UsersIcon, XIcon } from "lucide-react"

import type { PlatformRole } from "@/lib/mock/types"
import { pct } from "@/lib/format"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { Ring } from "@/components/dashboard/ring"
import { StatCard } from "@/components/dashboard/stat-card"
import { SoftBadge, plural } from "./bits"
import { ROLE_META, useTeam } from "./team-context"
import { useOpsClock } from "./use-ops-clock"

/** Indicadores da equipe Engemase. */
export function TeamStats() {
  const { members, assignments, grants } = useTeam()
  const { now } = useOpsClock(30_000)
  const active = members.filter((m) => m.status !== "disabled")
  const invited = members.filter((m) => m.status === "invited").length
  const with2fa = active.filter((m) => m.twoFactor).length
  const missing2fa = active.filter((m) => !m.twoFactor && m.status === "active")
  const valid = assignments.filter((a) => Date.parse(a.validUntil) > now)
  const expiring = valid.filter((a) => Date.parse(a.validUntil) - now < 30 * 86_400_000).length
  const liveGrants = grants.filter((g) => g.endedAt === null && Date.parse(g.endsAt) > now)
  const ratio = active.length > 0 ? with2fa / active.length : 0

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard icon={UsersIcon} tone="blue" label="Membros da equipe" value={active.length} hint={invited > 0 ? `${plural(invited, "convite pendente", "convites pendentes")}` : "todos com acesso ativo"} />
      <StatCard
        icon={FingerprintIcon}
        tone="teal"
        label="2FA cadastrado"
        value={
          <>
            {with2fa}
            <span className="text-base font-semibold text-muted-foreground"> / {active.length}</span>
          </>
        }
        hint={missing2fa.length > 0 ? `Pendente: ${missing2fa.map((m) => m.name.split(" ")[0]).join(", ")}` : "obrigatório para toda a equipe"}
        aside={<Ring value={ratio} size={58} stroke={7} color={ratio < 1 ? "#e96549" : "#0e9384"} label={pct(ratio, 0)} />}
      />
      <StatCard
        icon={CalendarRangeIcon}
        tone="orange"
        label="Atribuições vigentes"
        value={valid.length}
        hint={expiring > 0 ? `${expiring} vence${expiring === 1 ? "" : "m"} em até 30 dias` : "engenheiros de campo × clientes"}
      />
      <StatCard
        icon={KeyRoundIcon}
        tone="navy"
        label="Concessões de suporte ativas"
        value={liveGrants.length}
        hint={liveGrants.length > 0 ? liveGrants.map((g) => g.clientName).join(", ") : "nenhum suporte em andamento"}
      />
    </div>
  )
}

/** Cartões explicando os três papéis de plataforma. */
export function RoleCards() {
  const { members } = useTeam()
  const count = (r: PlatformRole) => members.filter((m) => m.role === r && m.status !== "disabled").length
  const supers = count("super_admin")

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {(Object.keys(ROLE_META) as PlatformRole[]).map((r) => {
        const meta = ROLE_META[r]
        return (
          <div key={r} className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex items-center gap-3">
              <IconCircle icon={meta.icon} tone={meta.tone} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{meta.label}</div>
                <div className="truncate text-xs text-muted-foreground">{meta.who}</div>
              </div>
              <SoftBadge tone={meta.tone}>{plural(count(r), "pessoa", "pessoas")}</SoftBadge>
            </div>
            <p className="text-sm">{meta.summary}</p>
            <ul className="grid gap-1 text-xs">
              {meta.can.map((c) => (
                <li key={c} className="flex items-start gap-1.5">
                  <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-state-running" aria-hidden />
                  <span>{c}</span>
                </li>
              ))}
              {meta.cannot.map((c) => (
                <li key={c} className="flex items-start gap-1.5 text-muted-foreground">
                  <XIcon className="mt-0.5 size-3.5 shrink-0 text-state-fault" aria-hidden />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
            {r === "super_admin" && supers < 2 && (
              <p className="mt-auto flex items-start gap-1.5 rounded-lg bg-state-stopped/15 px-2.5 py-2 text-[11px] text-amber-800 dark:text-state-stopped">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Só {supers} super admin. Recomendado ter 2 ou 3: o último super admin não pode ser removido nem rebaixado.
              </p>
            )}
            {r !== "super_admin" && <p className="mt-auto text-[11px] text-muted-foreground">2FA obrigatório. Toda entrada num cliente aparece com faixa na tela e na auditoria visível ao cliente.</p>}
          </div>
        )
      })}
    </div>
  )
}
