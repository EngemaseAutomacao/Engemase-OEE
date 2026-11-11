"use client"

import type { LucideIcon } from "lucide-react"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  FactoryIcon,
  GaugeIcon,
  PencilIcon,
  PlugZapIcon,
  RocketIcon,
  TagsIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { STATE_META } from "@/lib/states"
import { Button } from "@/components/ui/button"
import { StateDot } from "@/components/oee/state-badge"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import {
  PARITY_LABEL,
  PROTOCOL_LABEL,
  STATE_MODE_LABEL,
  TAG_ROLE_LABEL,
  piecesPerHour,
  pollLabel,
  rs485Label,
  seconds,
} from "@/components/config/labels"
import { refRange, toNum, type ConnDraft, type IdentDraft, type RulesDraft, type TagDraft, type WizardGateway } from "@/components/config/wizard-model"

export interface ReviewCheck {
  id: string
  label: string
  detail: string
  status: "ok" | "warn" | "error"
}

const CHECK_STYLE: Record<ReviewCheck["status"], { icon: LucideIcon; className: string }> = {
  ok: { icon: CircleCheckIcon, className: "text-state-running" },
  warn: { icon: TriangleAlertIcon, className: "text-amber-600 dark:text-state-stopped" },
  error: { icon: CircleAlertIcon, className: "text-state-fault" },
}

/** Etapa 5: revisão de tudo o que será publicado no gateway, com checagens antes de ativar. */
export function ReviewStep({
  ident,
  conn,
  tags,
  rules,
  unitName,
  lineName,
  gateway,
  checks,
  nextVersion,
  onEdit,
}: {
  ident: IdentDraft
  conn: ConnDraft
  tags: TagDraft[]
  rules: RulesDraft
  unitName: string
  lineName: string
  gateway: WizardGateway | undefined
  checks: ReviewCheck[]
  nextVersion: number | null
  onEdit: (step: number) => void
}) {
  const isTcp = conn.protocol === "modbus-tcp"
  const cycle = toNum(rules.idealCycleS)
  const read = tags.filter((t) => t.lastValue !== null).length

  return (
    <div className="flex flex-col gap-5">
      <ul className="grid gap-2 sm:grid-cols-2">
        {checks.map((c) => {
          const s = CHECK_STYLE[c.status]
          return (
            <li key={c.id} className="flex items-start gap-2.5 rounded-xl border bg-muted/30 px-3 py-2.5">
              <s.icon className={cn("mt-0.5 size-4 shrink-0", s.className)} />
              <div className="min-w-0 leading-tight">
                <div className="text-sm font-medium">{c.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{c.detail}</div>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReviewBlock icon={FactoryIcon} tone="navy" title="Identificação" onEdit={() => onEdit(0)}>
          <Dl
            rows={[
              ["Nome", ident.name || "—"],
              ["Código", <span key="c" className="font-mono">{ident.code || "—"}</span>],
              ["Tipo", ident.type || "—"],
              ["Unidade · linha", `${unitName} · ${lineName}`],
            ]}
          />
        </ReviewBlock>

        <ReviewBlock icon={PlugZapIcon} tone="blue" title="Conexão" onEdit={() => onEdit(1)}>
          <Dl
            rows={[
              ["Gateway", gateway ? `${gateway.name} (v${gateway.configVersion})` : "—"],
              ["Protocolo", PROTOCOL_LABEL[conn.protocol]],
              ...(isTcp
                ? ([
                    ["Endereço", <span key="h" className="font-mono">{`${conn.host || "—"}:${conn.port}`}</span>],
                    ["Unit ID · timeout", <span key="u" className="font-mono">{`${conn.tcpUnitId} · ${conn.tcpTimeout} ms`}</span>],
                  ] as [string, React.ReactNode][])
                : ([
                    ["Porta", <span key="p" className="font-mono">{conn.serialPort ? `${conn.serialPort} (${rs485Label(conn.serialPort)})` : "—"}</span>],
                    [
                      "Formato",
                      <span key="f" className="font-mono">
                        {`${conn.baudRate} bps · ${conn.dataBits}${conn.parity}${conn.stopBits}`}
                        <span className="font-sans text-muted-foreground"> · paridade {PARITY_LABEL[conn.parity].toLowerCase()}</span>
                      </span>,
                    ],
                    ["Unit ID · timeout", <span key="u" className="font-mono">{`${conn.rtuUnitId || "—"} · ${conn.rtuTimeout} ms`}</span>],
                  ] as [string, React.ReactNode][])),
            ]}
          />
        </ReviewBlock>

        <ReviewBlock icon={TagsIcon} tone="teal" title={`Sinais (${tags.length})`} onEdit={() => onEdit(2)} aside={`${read} de ${tags.length} lidos`}>
          <ul className="divide-y text-xs">
            {tags.map((t) => (
              <li key={t.key} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                <span className="w-28 shrink-0 truncate text-muted-foreground">{TAG_ROLE_LABEL[t.role]}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                <span className="shrink-0 font-mono text-muted-foreground">{refRange(t)}</span>
                <span className="hidden w-12 shrink-0 text-right text-muted-foreground sm:block">{pollLabel(t.pollMs)}</span>
              </li>
            ))}
            {tags.length === 0 && <li className="py-2 text-muted-foreground">Nenhum sinal mapeado.</li>}
          </ul>
        </ReviewBlock>

        <ReviewBlock icon={GaugeIcon} tone="orange" title="Regras de OEE" onEdit={() => onEdit(3)}>
          <Dl
            rows={[
              ["Modo de estado", STATE_MODE_LABEL[rules.stateMode]],
              ["Ciclo ideal", cycle > 0 ? `${seconds(cycle)} · ${piecesPerHour(cycle)}` : "—"],
              ["Micro-parada até", `${rules.microStopS} s`],
              ["Debounce · sem comunicação", `${rules.debounceS} s · ${rules.commLossS} s`],
            ]}
          />
          {rules.stateMode === "state_code" && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {rules.stateMap.map((r) => (
                <span key={r.key} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", STATE_META[r.state].soft)}>
                  <span className="font-mono font-semibold">{r.code}</span>
                  <StateDot state={r.state} />
                  {r.label || STATE_META[r.state].short}
                </span>
              ))}
            </div>
          )}
        </ReviewBlock>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
        <IconCircle icon={RocketIcon} tone="blue" soft size="sm" />
        <div className="text-sm leading-relaxed">
          <div className="font-semibold">O que acontece ao ativar</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {gateway && nextVersion !== null && (
              <li>
                A configuração de <span className="font-medium text-foreground">{gateway.name}</span> passa de v{gateway.configVersion} para{" "}
                <span className="font-medium text-foreground">v{nextVersion}</span> (+1 conexão, +{tags.length} tags). A versão anterior fica disponível para reverter.
              </li>
            )}
            <li>
              {gateway?.status === "online" || gateway?.status === "degraded"
                ? "O gateway recebe a nova versão na próxima sincronização (≈ 10 s) e a máquina aparece ao vivo no dashboard."
                : "O gateway não está conectado: a versão fica pendente e é aplicada automaticamente quando ele voltar."}
            </li>
            <li>A alteração fica registrada na auditoria do cliente, com o seu nome.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function ReviewBlock({
  icon,
  tone,
  title,
  aside,
  onEdit,
  children,
}: {
  icon: LucideIcon
  tone: IconTone
  title: string
  aside?: string
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
      <header className="flex items-center gap-2.5">
        <IconCircle icon={icon} tone={tone} soft size="sm" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
        <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Editar ${title}`} className="text-primary">
          <PencilIcon />
        </Button>
      </header>
      {children}
    </section>
  )
}

function Dl({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-1.5 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
