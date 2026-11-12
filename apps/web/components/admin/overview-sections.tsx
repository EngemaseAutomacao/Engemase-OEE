import Link from "next/link"
import {
  ArrowRightIcon,
  Building2Icon,
  CircleCheckBigIcon,
  ClipboardCheckIcon,
  CpuIcon,
  FileCogIcon,
  KeyRoundIcon,
  type LucideIcon,
  PauseCircleIcon,
  RocketIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  UserPlusIcon,
  WifiOffIcon,
} from "lucide-react"

import { pct } from "@/lib/format"
import { GATEWAY_STATUS_LABEL, PLAN_LABEL } from "@/lib/roles"
import { TONE_HEX, oeeTone } from "@/lib/states"
import { cn } from "@/lib/utils"
import { Donut } from "@/components/dashboard/donut"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import type { ActivityItem, AttentionItem, AttentionKind, ClientRow } from "./admin-data"
import { ClientStatusBadge, SquareLink, TD, TH } from "./bits"

const ATTENTION: Record<AttentionKind, { icon: LucideIcon; tone: IconTone; label: string }> = {
  gateway_offline: { icon: WifiOffIcon, tone: "red", label: "Gateway" },
  gateway_degraded: { icon: TriangleAlertIcon, tone: "amber", label: "Gateway" },
  onboarding: { icon: RocketIcon, tone: "blue", label: "Implantação" },
  remote_request: { icon: KeyRoundIcon, tone: "violet", label: "Acesso remoto" },
}

const TONE_DOT: Partial<Record<IconTone, string>> = { red: "#dc2626", amber: "#f59e0b", blue: "#257bb4", violet: "#8b5cf6" }

/** "Precisa de atenção": gateways com problema, implantações pendentes e pedidos de acesso remoto. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <Empty className="border border-dashed p-6 md:p-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleCheckBigIcon />
          </EmptyMedia>
          <EmptyTitle>Tudo em ordem</EmptyTitle>
          <EmptyDescription>Nenhum gateway com problema, implantação parada ou pedido pendente.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ul className="divide-y">
      {items.map((it) => {
        const meta = ATTENTION[it.kind]
        return (
          <li key={it.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <IconCircle icon={meta.icon} tone={meta.tone} soft size="sm" className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">{it.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{it.when}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">{it.subtitle}</div>
              {it.details.length > 0 && (
                <ul className="mt-1.5 grid gap-0.5">
                  {it.details.slice(0, 2).map((d) => (
                    <li key={d} className="flex gap-1.5 text-xs leading-snug">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full" style={{ background: TONE_DOT[meta.tone] }} aria-hidden />
                      <span className="min-w-0 text-foreground/80">{d}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <SquareLink href={it.href} icon={ArrowRightIcon} label={it.actionLabel} />
          </li>
        )
      })}
    </ul>
  )
}

/** Tabela compacta de clientes com o OEE do turno corrente. */
export function OverviewClientsTable({ rows }: { rows: ClientRow[] }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[600px] text-sm [&_td]:px-2.5 [&_td:first-child]:pl-0 [&_td:last-child]:pr-0 [&_th]:px-2.5 [&_th:first-child]:pl-0 [&_th:last-child]:pr-0">
        <thead className="border-b">
          <tr>
            <th className={TH}>Cliente</th>
            <th className={TH}>Status</th>
            <th className={TH}>Máquinas</th>
            <th className={TH}>Gateways</th>
            <th className={TH}>OEE do turno</th>
            <th className={TH}>
              <span className="sr-only">Abrir</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const tone = oeeTone(r.oee)
            const hasData = r.machinesWithData > 0
            return (
              <tr key={r.id} className="hover:bg-muted/40">
                <td className={TD}>
                  <Link href={`/admin/clientes/${r.id}`} className="group block min-w-0 leading-tight">
                    <span className="block truncate font-semibold group-hover:text-primary">{r.name}</span>
                    <span className="block max-w-52 truncate text-xs text-muted-foreground">
                      {r.city}/{r.state} · {PLAN_LABEL[r.plan]} · {r.machinesLimit} máq. contratadas
                    </span>
                  </Link>
                </td>
                <td className={TD}>
                  <ClientStatusBadge status={r.status} />
                </td>
                <td className={cn(TD, "text-xs whitespace-nowrap tabular-nums")}>
                  <span className="font-semibold">{r.running}</span>
                  <span className="text-muted-foreground"> / {r.machines} produzindo</span>
                </td>
                <td className={cn(TD, "text-xs whitespace-nowrap tabular-nums")}>
                  <span className={cn("font-semibold", r.gatewaysProblem > 0 && "text-state-fault")}>{r.gatewaysOnline}</span>
                  <span className="text-muted-foreground"> / {r.gateways} online</span>
                </td>
                <td className={TD}>
                  {hasData ? (
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, r.oee * 100)}%`, background: TONE_HEX[tone] }} />
                      </span>
                      <span className="w-12 text-right text-sm font-bold tabular-nums" style={{ color: TONE_HEX[tone] }}>
                        {pct(r.oee)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs whitespace-nowrap text-muted-foreground">Sem dados no turno</span>
                  )}
                </td>
                <td className={cn(TD, "text-right")}>
                  <SquareLink href={`/admin/clientes/${r.id}`} icon={ArrowRightIcon} label={`Abrir ${r.name}`} tone="slate" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const ACTIVITY_ICON: Record<string, { icon: LucideIcon; tone: IconTone }> = {
  "config.publish": { icon: FileCogIcon, tone: "blue" },
  "tag.test_read": { icon: SlidersHorizontalIcon, tone: "teal" },
  "user.invite": { icon: UserPlusIcon, tone: "navy" },
  "stop.classify": { icon: ClipboardCheckIcon, tone: "green" },
  "support.impersonate": { icon: ShieldCheckIcon, tone: "violet" },
  "shift.update": { icon: SlidersHorizontalIcon, tone: "navy" },
  "client.create": { icon: Building2Icon, tone: "blue" },
  "client.suspend": { icon: PauseCircleIcon, tone: "orange" },
  "gateway.create": { icon: CpuIcon, tone: "teal" },
  "platform.user_create": { icon: UserPlusIcon, tone: "navy" },
}

/** Atividade recente (auditoria global), em lista com ícones. */
export function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <ol className="relative grid gap-4">
      <span className="absolute top-2 bottom-2 left-4 border-l-2 border-dashed border-border" aria-hidden />
      {items.map((a) => {
        const meta = ACTIVITY_ICON[a.action] ?? { icon: ClipboardCheckIcon, tone: "slate" as const }
        return (
          <li key={a.id} className="relative flex min-w-0 items-start gap-3">
            <IconCircle icon={meta.icon} tone={meta.tone} size="sm" className="ring-4 ring-card" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">
                  {a.actionLabel} <span className="font-normal text-muted-foreground">· {a.entityName}</span>
                </span>
                <time className="shrink-0 text-[11px] text-muted-foreground tabular-nums" title={a.at}>
                  {a.when}
                </time>
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {a.actor}
                {a.impersonatedBy && " (Engemase)"} · {a.clientName}
              </div>
              {a.details && <div className="mt-0.5 line-clamp-1 text-xs text-foreground/80">{a.details}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Frota de gateways: rosca por status + versões do agente. */
export function FleetSummary({
  fleet,
  versions,
  remote,
}: {
  fleet: { status: keyof typeof GATEWAY_STATUS_LABEL; value: number; color: string }[]
  versions: { version: string; count: number }[]
  remote: { pending: number; active: number }
}) {
  const total = fleet.reduce((s, f) => s + f.value, 0)
  const latest = versions[0]?.version
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <Donut segments={fleet.map((f) => ({ label: GATEWAY_STATUS_LABEL[f.status], value: f.value, color: f.color }))} size={132} stroke={20} center={total} caption="gateways" />
        <ul className="grid w-full max-w-72 gap-2 text-xs">
          {fleet.map((f) => (
            <li key={f.status} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: f.color }} />
              <span className="flex-1 truncate text-muted-foreground">{GATEWAY_STATUS_LABEL[f.status]}</span>
              <span className="font-semibold tabular-nums">{f.value}</span>
            </li>
          ))}
        </ul>
      </div>
      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/60 p-3">
        <div className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">Versões do agente</dt>
          <dd className="flex flex-wrap gap-x-2 text-sm font-semibold tabular-nums">
            {versions.map((v) => (
              <span key={v.version} className={cn(v.version !== latest && "text-amber-700 dark:text-state-stopped")}>
                v{v.version} ×{v.count}
              </span>
            ))}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">Acesso remoto (VPN)</dt>
          <dd className="truncate text-sm font-semibold tabular-nums">
            {remote.active} ativa · {remote.pending} pendente
          </dd>
        </div>
      </dl>
    </div>
  )
}
