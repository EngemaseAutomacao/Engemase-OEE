import Link from "next/link"
import {
  ArrowRightIcon,
  BellRingIcon,
  Building2Icon,
  CpuIcon,
  EyeIcon,
  FactoryIcon,
  LockIcon,
  type LucideIcon,
  PaletteIcon,
  PlusIcon,
  RouterIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"

import type { ClientBranding } from "@/lib/mock"
import { num, pct } from "@/lib/format"
import { CLIENT_ROLE_LABEL, USER_STATUS_LABEL } from "@/lib/roles"
import { STATE_META, STATE_ORDER, TONE_HEX, oeeTone } from "@/lib/states"
import { cn } from "@/lib/utils"
import { Ring } from "@/components/dashboard/ring"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import type { ClientDetail, GatewayRow, MachineRow, UnitRow, UserRow } from "./admin-data"
import { GatewayStatusBadge, SoftBadge, SquareLink, TD, TH } from "./bits"
import { ResendEmailButton } from "./resend-email-button"
import type { SoftTone } from "./labels"

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
function EmptyBlock({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: React.ReactNode }) {
  return (
    <Empty className="border border-dashed p-6 md:p-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

/** Botão-link; `compact` esconde o texto no celular (ações no cabeçalho dos cartões). */
function LinkButton({
  href,
  icon: Icon,
  children,
  variant = "outline",
  compact = false,
}: {
  href: string
  icon: LucideIcon
  children: string
  variant?: "outline" | "default"
  compact?: boolean
}) {
  return (
    <Button variant={variant} size="sm" asChild className="shrink-0">
      <Link href={href} aria-label={children} title={children}>
        <Icon />
        <span className={cn(compact && "hidden sm:inline")}>{children}</span>
      </Link>
    </Button>
  )
}

function TableWrap({ minWidth, children }: { minWidth: number; children: React.ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Visão geral: indicadores e OEE
// ---------------------------------------------------------------------------
export function OverviewStats({ s }: { s: ClientDetail["summary"] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={Building2Icon}
        tone="blue"
        label="Unidades"
        value={s.units}
        hint={s.terminals === 0 ? "Nenhum terminal pareado" : `${s.terminals} ${s.terminals === 1 ? "terminal" : "terminais"} · ${s.terminalsOnline} online`}
      />
      <StatCard
        icon={FactoryIcon}
        tone="navy"
        label="Máquinas produzindo"
        value={
          <>
            {s.running}
            <span className="text-base font-semibold text-muted-foreground"> / {s.machines}</span>
          </>
        }
        hint={`${s.oee.machinesWithData} com dados no turno`}
      />
      <StatCard
        icon={CpuIcon}
        tone="teal"
        label="Gateways online"
        value={
          <>
            {s.gatewaysOnline}
            <span className="text-base font-semibold text-muted-foreground"> / {s.gateways}</span>
          </>
        }
        hint={s.gatewaysProblem > 0 ? `${s.gatewaysProblem} com problema` : s.gateways === 0 ? "Nenhum provisionado" : "Todos respondendo"}
      />
      <StatCard icon={BellRingIcon} tone="orange" label="Alertas abertos" value={s.alerts} hint={s.alertsCritical > 0 ? `${s.alertsCritical} ${s.alertsCritical === 1 ? "crítico" : "críticos"}` : "Nenhum crítico"} />
    </div>
  )
}

export function OeeCard({ s, history, slug, className }: { s: ClientDetail["summary"]; history: ClientDetail["oeeHistory"]; slug: string; className?: string }) {
  const hasData = s.oee.machinesWithData > 0
  const tone = oeeTone(s.oee.oee)
  const max = Math.max(1, ...history.map((h) => h.oee))
  return (
    <SectionCard title="OEE do cliente" description="Turno corrente e últimos 14 dias" href={`/${slug}/relatorios/oee`} linkLabel="Ver relatório" className={className}>
      {!hasData && history.length === 0 ? (
        <EmptyBlock icon={FactoryIcon} title="Ainda sem dados de produção" description="O OEE aparece assim que o gateway for ativado e as máquinas tiverem tags configuradas." />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Ring value={hasData ? s.oee.oee : 0} size={96} stroke={10} color={TONE_HEX[tone]} />
              <span className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
                <span className="text-lg font-bold tabular-nums">{hasData ? pct(s.oee.oee) : "—"}</span>
                <span className="text-[10px] text-muted-foreground">no turno</span>
              </span>
            </div>
            <dl className="grid flex-1 gap-2 text-xs">
              {(
                [
                  ["Disponibilidade", s.oee.availability, "#257bb4"],
                  ["Performance", s.oee.performance, "#0e9384"],
                  ["Qualidade", s.oee.quality, "#2c4e73"],
                ] as const
              ).map(([label, v, color]) => (
                <div key={label} className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full" style={{ width: `${hasData ? Math.min(100, v * 100) : 0}%`, background: color }} />
                  </dd>
                  <dd className="text-right font-semibold tabular-nums">{hasData ? pct(v) : "—"}</dd>
                </div>
              ))}
            </dl>
          </div>
          {history.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>OEE médio por dia</span>
                <span className="tabular-nums">média {pct(history.reduce((a, h) => a + h.oee, 0) / history.length)}</span>
              </div>
              <div className="flex h-20 items-end gap-1" role="img" aria-label="OEE médio por dia nos últimos 14 dias">
                {history.map((h) => (
                  <div key={h.label} className="group relative flex h-full flex-1 flex-col justify-end" title={`${h.label}: ${pct(h.oee)}`}>
                    <span className="block rounded-t-sm" style={{ height: `${(h.oee / max) * 100}%`, background: TONE_HEX[oeeTone(h.oee)], opacity: 0.85 }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
                <span>{history[0]!.label}</span>
                <span>{history[history.length - 1]!.label}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Unidades
// ---------------------------------------------------------------------------
export function UnitsSection({ units, slug }: { units: UnitRow[]; slug: string }) {
  return (
    <SectionCard
      title="Unidades"
      description={`${units.length} ${units.length === 1 ? "planta" : "plantas"} · escopo de acesso por unidade`}
      action={<LinkButton compact href={`/${slug}/config/unidades`} icon={Building2Icon}>Gerenciar no cliente</LinkButton>}
    >
      {units.length === 0 ? (
        <EmptyBlock icon={Building2Icon} title="Nenhuma unidade" description="Crie a primeira unidade para cadastrar linhas, máquinas e o gateway." />
      ) : (
        <TableWrap minWidth={760}>
          <thead className="border-b">
            <tr>
              <th className={TH}>Unidade</th>
              <th className={TH}>Fuso</th>
              <th className={cn(TH, "text-right")}>Linhas</th>
              <th className={cn(TH, "text-right")}>Máquinas</th>
              <th className={cn(TH, "text-right")}>Gateways</th>
              <th className={TH}>Turnos</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {units.map((u) => (
              <tr key={u.id} className="hover:bg-muted/40">
                <td className={TD}>
                  <div className="font-semibold">{u.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {u.city}/{u.state}
                  </div>
                </td>
                <td className={cn(TD, "text-xs whitespace-nowrap")}>{u.timezone}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{u.lines}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{u.machines}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{u.gateways}</td>
                <td className={TD}>
                  {u.shifts.length === 0 ? (
                    <SoftBadge tone="amber" dot>
                      Sem turnos
                    </SoftBadge>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {u.shifts.map((s) => (
                        <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap tabular-nums">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Máquinas
// ---------------------------------------------------------------------------
export function MachinesSection({ machines, slug, limit }: { machines: MachineRow[]; slug: string; limit: number }) {
  const counts = STATE_ORDER.map((st) => ({ st, n: machines.filter((m) => m.state === st).length })).filter((x) => x.n > 0)
  return (
    <SectionCard
      title="Máquinas"
      description={`${machines.length} em uso de ${limit} contratadas · estado agora`}
      action={<LinkButton compact href={`/${slug}/config/maquinas`} icon={FactoryIcon}>Cadastro no cliente</LinkButton>}
    >
      {machines.length === 0 ? (
        <EmptyBlock
          icon={FactoryIcon}
          title="Nenhuma máquina cadastrada"
          description="Cadastre as máquinas depois de ativar o gateway; o assistente mapeia as tags Modbus."
          action={<LinkButton href={`/${slug}/config/maquinas/nova`} icon={PlusIcon} variant="default">Nova máquina</LinkButton>}
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {counts.map(({ st, n }) => (
              <span key={st} className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", STATE_META[st].soft, STATE_META[st].text)}>
                <span className={cn("size-1.5 rounded-full", STATE_META[st].dot)} aria-hidden />
                {STATE_META[st].short} · {n}
              </span>
            ))}
          </div>
          <TableWrap minWidth={860}>
            <thead className="border-b">
              <tr>
                <th className={TH}>Máquina</th>
                <th className={TH}>Unidade · linha</th>
                <th className={TH}>Gateway</th>
                <th className={TH}>Estado</th>
                <th className={cn(TH, "text-right")}>OEE do turno</th>
                <th className={TH}>
                  <span className="sr-only">Abrir</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {machines.map((m) => {
                const meta = STATE_META[m.state]
                return (
                  <tr key={m.id} className="hover:bg-muted/40">
                    <td className={TD}>
                      <div className="font-semibold">{m.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.code} · {m.type}
                      </div>
                    </td>
                    <td className={cn(TD, "text-xs")}>
                      <div>{m.unit}</div>
                      <div className="text-muted-foreground">{m.line}</div>
                    </td>
                    <td className={cn(TD, "text-xs")}>
                      {m.gateway ?? <span className="text-muted-foreground">—</span>}
                      {!m.hasPlc && <div className="font-medium text-amber-700 dark:text-state-stopped">Sem CLP vinculado</div>}
                    </td>
                    <td className={TD}>
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", meta.soft, meta.text)}>
                        <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
                        {meta.label}
                      </span>
                    </td>
                    <td className={cn(TD, "text-right font-bold tabular-nums")} style={{ color: m.oee !== null ? TONE_HEX[oeeTone(m.oee)] : undefined }}>
                      {m.oee !== null ? pct(m.oee) : <span className="text-xs font-normal text-muted-foreground">sem dados</span>}
                    </td>
                    <td className={cn(TD, "text-right")}>
                      <SquareLink href={m.href} icon={EyeIcon} label={`Ver ${m.name}`} tone="teal" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        </>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Gateways
// ---------------------------------------------------------------------------
export function GatewaysSection({ gateways, limit }: { gateways: GatewayRow[]; limit: number }) {
  return (
    <SectionCard
      title="Gateways"
      description={`${gateways.length} de ${limit} do plano`}
      action={<LinkButton compact href="/admin/gateways" icon={RouterIcon}>Provisionar gateway</LinkButton>}
    >
      {gateways.length === 0 ? (
        <EmptyBlock icon={CpuIcon} title="Nenhum gateway provisionado" description="Gere um código de ativação na frota de gateways e instale o equipamento na planta." />
      ) : (
        <TableWrap minWidth={940}>
          <thead className="border-b">
            <tr>
              <th className={TH}>Gateway</th>
              <th className={TH}>Status</th>
              <th className={TH}>Último contato</th>
              <th className={TH}>Agente</th>
              <th className={TH}>Configuração</th>
              <th className={cn(TH, "text-right")}>Buffer</th>
              <th className={cn(TH, "text-right")}>Máquinas</th>
              <th className={TH}>
                <span className="sr-only">Abrir</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {gateways.map((g) => (
              <tr key={g.id} className="align-top hover:bg-muted/40">
                <td className={TD}>
                  <div className="font-semibold">{g.name}</div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{g.hostname}</span> · {g.unit}
                  </div>
                  {g.problems.length > 0 && (
                    <ul className="mt-1 grid gap-0.5">
                      {g.problems.slice(0, 2).map((p) => (
                        <li
                          key={p}
                          className={cn(
                            "max-w-72 text-xs",
                            g.status === "pending" ? "text-muted-foreground" : g.status === "offline" ? "text-state-fault" : "text-amber-700 dark:text-state-stopped",
                          )}
                        >
                          {p}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className={TD}>
                  <GatewayStatusBadge status={g.status} />
                </td>
                <td className={cn(TD, "text-xs whitespace-nowrap")}>{g.lastSeen}</td>
                <td className={cn(TD, "font-mono text-xs")}>{g.agentVersion ? `v${g.agentVersion}` : "—"}</td>
                <td className={cn(TD, "text-xs whitespace-nowrap", g.configOutdated && g.status !== "pending" && "font-semibold text-amber-700 dark:text-state-stopped")}>{g.config}</td>
                <td className={cn(TD, "text-right text-xs tabular-nums", g.buffer >= 100 && "font-semibold text-state-fault")}>{num(g.buffer)}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{g.machines}</td>
                <td className={cn(TD, "text-right")}>
                  <SquareLink href={g.href} icon={ArrowRightIcon} label={`Abrir ${g.name}`} tone="slate" />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Os gateways do cliente vêm só da própria unidade; suspender o cliente não revoga tokens de gateway.</p>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------
const USER_TONE: Record<UserRow["status"], SoftTone> = { active: "green", invited: "amber", disabled: "slate" }

export function UsersSection({ users, slug, limit }: { users: UserRow[]; slug: string; limit: number }) {
  return (
    <SectionCard
      title="Usuários do cliente"
      description={`${users.length} de ${limit} do plano · a equipe Engemase não aparece aqui`}
      action={<LinkButton compact href={`/${slug}/config/usuarios`} icon={UsersIcon}>Gerenciar no cliente</LinkButton>}
    >
      {users.length === 0 ? (
        <EmptyBlock icon={UsersIcon} title="Nenhum usuário" description="Crie o primeiro admin do cliente para ele convidar a equipe." />
      ) : (
        <TableWrap minWidth={860}>
          <thead className="border-b">
            <tr>
              <th className={TH}>Pessoa</th>
              <th className={TH}>Papel</th>
              <th className={TH}>Escopo</th>
              <th className={TH}>Status</th>
              <th className={TH}>2FA</th>
              <th className={TH}>Último acesso</th>
              <th className={TH}>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-muted/40">
                <td className={TD}>
                  <div className="font-semibold">{u.name}</div>
                  <div className={cn("text-xs text-muted-foreground", u.isUsername && "font-mono")}>{u.login}</div>
                </td>
                <td className={cn(TD, "text-xs whitespace-nowrap")}>{CLIENT_ROLE_LABEL[u.role]}</td>
                <td className={cn(TD, "max-w-56 text-xs")}>{u.scope}</td>
                <td className={TD}>
                  <SoftBadge tone={USER_TONE[u.status]} dot>
                    {u.status === "invited" ? "Senha não definida" : USER_STATUS_LABEL[u.status]}
                  </SoftBadge>
                </td>
                <td className={TD}>
                  {u.twoFactor ? (
                    <SoftBadge tone="teal" icon={ShieldCheckIcon}>
                      Ativo
                    </SoftBadge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className={cn(TD, "text-xs whitespace-nowrap text-muted-foreground")}>{u.lastLogin}</td>
                <td className={cn(TD, "text-right")}>{u.status === "invited" && !u.isUsername && <ResendEmailButton name={u.name} email={u.login} />}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Aparência
// ---------------------------------------------------------------------------
const ENGEMASE_TOKENS = {
  light: { primary: "#2272ab", ring: "#2272ab", sidebar: "#2c4e73" },
  dark: { primary: "#4a9fd6", ring: "#4a9fd6", sidebar: "#172b42" },
}

const SIDEBAR_LABEL: Record<ClientBranding["sidebarMode"], string> = {
  neutral: "Padrão (azul-marinho Engemase)",
  "brand-dark": "Escuro no tom da marca",
  light: "Claro",
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="size-7 shrink-0 rounded-lg border shadow-xs" style={{ background: color }} aria-hidden />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
        <span className="block font-mono text-xs font-semibold uppercase">{color}</span>
      </span>
    </div>
  )
}

function MiniPreview({ mode, tokens, name }: { mode: "light" | "dark"; tokens: { primary: string; sidebar: string }; name: string }) {
  const dark = mode === "dark"
  return (
    <div className={cn("flex h-36 overflow-hidden rounded-xl border", dark ? "bg-[#0f1720]" : "bg-[#f1f5f9]")} aria-label={`Prévia no modo ${dark ? "escuro" : "claro"}`}>
      <div className="flex w-[30%] flex-col gap-1.5 p-2" style={{ background: tokens.sidebar }}>
        <span className="truncate text-[9px] font-bold text-white/90">{name}</span>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-2 rounded-sm", i === 0 ? "bg-white/35" : "bg-white/15")} />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <span className={cn("h-2 w-1/2 rounded-sm", dark ? "bg-white/25" : "bg-slate-300")} />
        <div className={cn("flex flex-1 flex-col gap-1.5 rounded-lg p-2", dark ? "bg-[#1a2430]" : "bg-white")}>
          <span className="flex gap-1">
            {(["RUNNING", "STOPPED", "FAULT", "SETUP"] as const).map((st) => (
              <span key={st} className="h-2 flex-1 rounded-sm" style={{ background: STATE_META[st].hex }} />
            ))}
          </span>
          <span className={cn("h-1.5 w-3/4 rounded-sm", dark ? "bg-white/15" : "bg-slate-200")} />
          <span className="mt-auto h-4 w-16 rounded-md" style={{ background: tokens.primary }} />
        </div>
      </div>
    </div>
  )
}

export function AppearanceSection({ branding, name, slug }: { branding: ClientBranding | null; name: string; slug: string }) {
  const tokens = branding?.tokens ?? ENGEMASE_TOKENS
  const displayName = branding?.displayName ?? name
  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <SectionCard
        title="Identidade visual"
        description={branding ? "Personalizada pelo cliente" : "Usa o padrão Engemase"}
        action={<LinkButton compact href={`/${slug}/config/aparencia`} icon={PaletteIcon}>Abrir editor</LinkButton>}
        className="xl:col-span-7"
      >
        <div className="grid gap-5">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Nome exibido</dt>
              <dd className="font-medium">{displayName}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Paleta</dt>
              <dd className="font-medium">{branding ? (branding.preset ?? "Cor livre") : "Azul Engemase (padrão)"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Menu lateral</dt>
              <dd className="font-medium">{SIDEBAR_LABEL[branding?.sidebarMode ?? "neutral"]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cor da marca</dt>
              <dd className="flex items-center gap-2 font-medium">
                <span className="size-4 rounded-full border" style={{ background: branding?.brandColor ?? "#257BB4" }} aria-hidden />
                <span className="font-mono text-xs uppercase">{branding?.brandColor ?? "#257BB4"}</span>
                {branding?.adjusted && <SoftBadge tone="amber">Ajustada para contraste</SoftBadge>}
              </dd>
            </div>
          </dl>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2 rounded-xl border p-3">
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Modo claro</span>
              <Swatch color={tokens.light.primary} label="Primária" />
              <Swatch color={tokens.light.sidebar} label="Menu lateral" />
            </div>
            <div className="grid gap-2 rounded-xl border p-3">
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Modo escuro</span>
              <Swatch color={tokens.dark.primary} label="Primária" />
              <Swatch color={tokens.dark.sidebar} label="Menu lateral" />
            </div>
          </div>
          <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Cores de estado, faixas de OEE e cor de erro são travadas e não mudam com a marca de nenhum cliente.
          </p>
        </div>
      </SectionCard>
      <SectionCard title="Prévia" description="Como o cliente vê o menu, os estados e os botões" className="xl:col-span-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <MiniPreview mode="light" tokens={tokens.light} name={displayName} />
          <MiniPreview mode="dark" tokens={tokens.dark} name={displayName} />
        </div>
      </SectionCard>
    </div>
  )
}

