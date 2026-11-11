"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  BanIcon,
  ExternalLinkIcon,
  HourglassIcon,
  KeyRoundIcon,
  LinkIcon,
  MonitorIcon,
  MonitorSmartphoneIcon,
  MoonIcon,
  PencilIcon,
  PlusIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  SunIcon,
  SunMoonIcon,
  TabletSmartphoneIcon,
  UserRoundXIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { Ring } from "@/components/dashboard/ring"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { ConfirmAction, SettingsTitle, SquareAction, StatusDot, plural } from "@/components/settings/bits"
import { KIND_LABEL, PAIRING_HOST, THEME_LABEL, TerminalDialog, type TerminalFormValue } from "@/components/settings/terminal-dialog"
import type { SettingsUnit, TerminalKind, TerminalLine, TerminalMachine, TerminalRow } from "@/components/settings/types"

const THEME_ICON = { dark: MoonIcon, light: SunIcon, system: SunMoonIcon } as const

export function TerminalsManager({
  clientSlug,
  clientName,
  currentUserName,
  units,
  lines,
  machines,
  initialTerminals,
}: {
  clientSlug: string
  clientName: string
  currentUserName: string
  units: SettingsUnit[]
  lines: TerminalLine[]
  machines: TerminalMachine[]
  initialTerminals: TerminalRow[]
}) {
  const [terminals, setTerminals] = useState(initialTerminals)
  const [kindFilter, setKindFilter] = useState<TerminalKind | "all">("all")
  const [unitFilter, setUnitFilter] = useState<string>("all")
  const [dialog, setDialog] = useState<{ editing: { row: TerminalRow; mode: "edit" | "code" } | null } | null>(null)
  const [revoking, setRevoking] = useState<TerminalRow | null>(null)

  const unitName = useMemo(() => new Map(units.map((u) => [u.id, u.name])), [units])
  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines])
  const machineById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines])

  const online = terminals.filter((t) => t.status === "online").length
  const offline = terminals.filter((t) => t.status === "offline")
  const pending = terminals.filter((t) => t.status === "pending").length
  const tvs = terminals.filter((t) => t.kind === "andon_tv").length

  const visible = terminals
    .filter((t) => kindFilter === "all" || t.kind === kindFilter)
    .filter((t) => unitFilter === "all" || t.unitId === unitFilter)
    .sort((a, b) => a.unitId.localeCompare(b.unitId) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "pt-BR"))

  const create = (v: TerminalFormValue, code: string) => {
    const row: TerminalRow = {
      id: `trm_new_${terminals.length + 1}`,
      unitId: v.unitId,
      name: v.name,
      kind: v.kind,
      lineIds: v.lineIds,
      machineIds: v.machineIds,
      theme: v.theme,
      status: "pending",
      pairedBy: null,
      pairedAt: null,
      lastSeen: "nunca",
      pairingCode: code,
    }
    setTerminals((list) => [...list, row])
    setDialog(null)
    toast.success(`${v.name} aguardando pareamento`, { description: `Digite ${code} no aparelho em até 10 minutos. Ele aparece como online assim que conectar.` })
  }

  const save = (id: string, v: TerminalFormValue) => {
    setTerminals((list) => list.map((t) => (t.id === id ? { ...t, name: v.name, lineIds: v.lineIds, machineIds: v.machineIds, theme: v.theme } : t)))
    setDialog(null)
    toast.success("Terminal atualizado", { description: "O aparelho recarrega com o novo conteúdo em até 1 minuto. Registrado na auditoria." })
  }

  const simulateConnect = (v: TerminalFormValue, _code: string, pendingId: string | null) => {
    const patch = { status: "online" as const, pairedBy: currentUserName, pairedAt: "agora", lastSeen: "agora", pairingCode: null }
    if (pendingId) {
      setTerminals((list) => list.map((t) => (t.id === pendingId ? { ...t, ...patch } : t)))
    } else {
      setTerminals((list) => [
        ...list,
        { id: `trm_new_${list.length + 1}`, unitId: v.unitId, name: v.name, kind: v.kind, lineIds: v.lineIds, machineIds: v.machineIds, theme: v.theme, ...patch },
      ])
    }
    setDialog(null)
    toast.success(`${v.name || "Terminal"} pareado`, { description: "O aparelho já está mostrando a tela escolhida." })
  }

  const revoke = (t: TerminalRow) => {
    setTerminals((list) => list.filter((x) => x.id !== t.id))
    toast.success(t.status === "pending" ? `Pareamento de ${t.name} cancelado` : `${t.name} revogado`, {
      description: t.status === "pending" ? "O código deixou de valer." : "O token do aparelho foi invalidado agora; ele volta para a tela de pareamento.",
    })
  }

  const scopeChips = (t: TerminalRow) =>
    t.kind === "andon_tv" ? t.lineIds.map((id) => lineById.get(id)?.name ?? id) : t.machineIds.map((id) => machineById.get(id)?.name ?? id)

  const openHref = (t: TerminalRow) =>
    t.kind === "andon_tv" ? (t.lineIds[0] ? `/${clientSlug}/andon/${t.lineIds[0]}` : null) : t.machineIds[0] ? `/${clientSlug}/operador/${t.machineIds[0]}` : null

  return (
    <>
      <SettingsTitle
        title="Terminais (TV e tablets)"
        description={`TVs Andon e tablets pareados de ${clientName}. Terminal é um aparelho, não uma pessoa: entra por código de pareamento, sem e-mail nem senha.`}
        actions={
          <Button onClick={() => setDialog({ editing: null })}>
            <PlusIcon />
            Parear novo terminal
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={MonitorSmartphoneIcon} tone="blue" label="Terminais" value={terminals.length} hint={`${plural(tvs, "TV", "TVs")} · ${plural(terminals.length - tvs, "tablet", "tablets")}`} />
        <StatCard
          icon={WifiIcon}
          tone="teal"
          label="Online agora"
          value={
            <>
              {online}
              <span className="text-base font-semibold text-muted-foreground"> / {terminals.length - pending}</span>
            </>
          }
          hint="Contato nos últimos 2 min"
          aside={<Ring value={terminals.length - pending ? online / (terminals.length - pending) : 0} size={52} stroke={6} color="#0e9384" />}
        />
        <StatCard icon={WifiOffIcon} tone="orange" label="Sem contato" value={offline.length} hint={offline.length ? `${offline[0]!.name}: ${offline[0]!.lastSeen}` : "Todos respondendo"} />
        <StatCard icon={HourglassIcon} tone="navy" label="Aguardando pareamento" value={pending} hint={pending ? "Código gerado, aparelho ainda não conectou" : "Nenhum código em aberto"} />
      </div>

      <SectionCard
        title="Terminais pareados"
        description={plural(visible.length, "aparelho", "aparelhos")}
        bodyClassName="px-0 pb-2"
        action={
          <div className="hidden items-center gap-2 md:flex">
            <TerminalFilters kindFilter={kindFilter} setKindFilter={setKindFilter} unitFilter={unitFilter} setUnitFilter={setUnitFilter} units={units} />
          </div>
        }
      >
        <div className="flex flex-col gap-2 px-5 pb-3 md:hidden">
          <TerminalFilters kindFilter={kindFilter} setKindFilter={setKindFilter} unitFilter={unitFilter} setUnitFilter={setUnitFilter} units={units} />
        </div>
        {visible.length === 0 ? (
          <Empty className="mx-5 mb-3 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MonitorSmartphoneIcon />
              </EmptyMedia>
              <EmptyTitle>{terminals.length === 0 ? "Nenhum terminal pareado" : "Nenhum terminal neste filtro"}</EmptyTitle>
              <EmptyDescription>
                {terminals.length === 0 ? "Pareie a TV da linha ou o tablet da máquina com um código de 6 dígitos." : "Troque o tipo ou a unidade para ver os demais aparelhos."}
              </EmptyDescription>
            </EmptyHeader>
            {terminals.length === 0 && (
              <EmptyContent>
                <Button onClick={() => setDialog({ editing: null })}>
                  <PlusIcon />
                  Parear novo terminal
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="py-2.5 pr-3 pl-5 font-medium">Terminal</th>
                  <th className="px-3 py-2.5 font-medium">Unidade</th>
                  <th className="px-3 py-2.5 font-medium">Mostra</th>
                  <th className="px-3 py-2.5 font-medium">Tema</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="px-3 py-2.5 font-medium">Pareado por</th>
                  <th className="px-3 py-2.5 font-medium">Último contato</th>
                  <th className="py-2.5 pr-5 pl-3 text-right font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((t) => {
                  const ThemeIcon = THEME_ICON[t.theme]
                  const href = openHref(t)
                  return (
                    <tr key={t.id} className="transition-colors hover:bg-muted/30">
                      <td className="py-3 pr-3 pl-5">
                        <div className="flex items-center gap-3">
                          <IconCircle icon={t.kind === "andon_tv" ? MonitorIcon : TabletSmartphoneIcon} tone={t.kind === "andon_tv" ? "navy" : "teal"} soft size="sm" />
                          <div className="min-w-0 leading-tight">
                            <div className="truncate font-medium">{t.name}</div>
                            <div className="text-xs text-muted-foreground">{KIND_LABEL[t.kind]}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap">{unitName.get(t.unitId) ?? "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-[240px] flex-wrap gap-1">
                          {scopeChips(t).map((c) => (
                            <span key={c} className="rounded-md border bg-card px-1.5 py-0.5 text-[11px] whitespace-nowrap">
                              {c}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <ThemeIcon className="size-3.5 text-muted-foreground" />
                          {THEME_LABEL[t.theme]}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {t.status === "online" && (
                          <StatusDot tone="green" pulse>
                            Online
                          </StatusDot>
                        )}
                        {t.status === "offline" && <StatusDot tone="red">Sem contato</StatusDot>}
                        {t.status === "pending" && (
                          <div className="flex flex-col gap-1">
                            <StatusDot tone="amber">Aguardando</StatusDot>
                            {t.pairingCode && <span className="font-mono text-xs font-semibold tracking-wider">{t.pairingCode}</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs leading-tight">
                        {t.pairedBy ? (
                          <>
                            <div className="font-medium">{t.pairedBy}</div>
                            <div className="text-muted-foreground">{t.pairedAt}</div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={cn("px-3 py-3 text-xs whitespace-nowrap tabular-nums", t.status === "offline" ? "font-medium text-state-fault" : "text-muted-foreground")}>
                        {t.lastSeen}
                      </td>
                      <td className="py-3 pr-5 pl-3">
                        <div className="flex justify-end gap-1.5">
                          {t.status === "pending" ? (
                            <SquareAction icon={QrCodeIcon} label="Ver código de pareamento" onClick={() => setDialog({ editing: { row: t, mode: "code" } })} />
                          ) : (
                            href && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Link
                                    href={href}
                                    aria-label={`Abrir a tela de ${t.name}`}
                                    className="flex size-8 items-center justify-center rounded-lg bg-[#0e9384]/10 text-[#0e9384] transition hover:bg-[#0e9384]/20"
                                  >
                                    <ExternalLinkIcon className="size-4" />
                                  </Link>
                                </TooltipTrigger>
                                <TooltipContent>Ver a tela deste terminal</TooltipContent>
                              </Tooltip>
                            )
                          )}
                          {t.status !== "pending" && <SquareAction icon={PencilIcon} label="Editar nome, escopo e tema" tone="slate" onClick={() => setDialog({ editing: { row: t, mode: "edit" } })} />}
                          <SquareAction icon={BanIcon} label={t.status === "pending" ? "Cancelar pareamento" : "Revogar terminal"} tone="red" onClick={() => setRevoking(t)} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard title="Terminal não é conta de pessoa" description="Por que TV e tablet não usam e-mail e senha" className="lg:col-span-3">
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              { icon: KeyRoundIcon, tone: "blue" as const, title: "Token de aparelho", text: "O pareamento entrega um token só deste aparelho, com prazo de 12 meses. Não há senha para vazar nem para trocar." },
              { icon: ShieldCheckIcon, tone: "teal" as const, title: "Vê só o escolhido", text: "A TV mostra apenas as linhas e o tablet apenas as máquinas definidas aqui, dentro de uma única unidade." },
              { icon: UserRoundXIcon, tone: "orange" as const, title: "Operador sem login", text: "No tablet, o operador se identifica na própria tela (lista de nomes; crachá ou PIN em breve). Não é preciso criar usuário." },
              { icon: LinkIcon, tone: "navy" as const, title: "Separado das pessoas", text: `O terminal roda em ${PAIRING_HOST}, nunca junto com a sessão de uma pessoa no mesmo navegador.` },
            ].map((x) => (
              <li key={x.title} className="flex gap-3">
                <IconCircle icon={x.icon} tone={x.tone} soft size="sm" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{x.title}</div>
                  <p className="text-xs leading-snug text-muted-foreground">{x.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title="Quem pareou saiu da empresa?" description="O terminal continua funcionando" className="lg:col-span-2">
          <div className="grid gap-3 text-sm">
            <p className="text-muted-foreground">
              Desativar a pessoa não derruba a TV da linha. Por isso registramos <span className="font-medium text-foreground">quem pareou e quando</span>: revise a lista e revogue em
              um clique o que não reconhecer.
            </p>
            <ol className="grid gap-2 rounded-xl bg-muted/60 p-3 text-xs">
              <li className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">1</span>
                Revogar invalida o token na hora; o aparelho volta para a tela de pareamento.
              </li>
              <li className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">2</span>
                Para reaproveitar o aparelho, gere um novo código e digite nele.
              </li>
              <li className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">3</span>
                Pareamento, edição e revogação ficam na auditoria do cliente.
              </li>
            </ol>
          </div>
        </SectionCard>
      </div>

      <TerminalDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        editing={dialog?.editing ?? null}
        units={units}
        lines={lines}
        machines={machines}
        onCreate={create}
        onSave={save}
        onSimulateConnect={simulateConnect}
      />

      <ConfirmAction
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking?.status === "pending" ? `Cancelar o pareamento de ${revoking?.name}?` : `Revogar ${revoking?.name ?? "terminal"}?`}
        description={
          revoking?.status === "pending" ? (
            <p>O código {revoking.pairingCode} deixa de valer. Você pode gerar outro quando o aparelho estiver pronto.</p>
          ) : (
            <p>O aparelho para de mostrar dados imediatamente e volta para a tela de pareamento. Para usá-lo de novo, gere um novo código.</p>
          )
        }
        confirmLabel={revoking?.status === "pending" ? "Cancelar pareamento" : "Revogar agora"}
        onConfirm={() => {
          if (revoking) revoke(revoking)
          setRevoking(null)
        }}
      />
    </>
  )
}

function TerminalFilters({
  kindFilter,
  setKindFilter,
  unitFilter,
  setUnitFilter,
  units,
}: {
  kindFilter: TerminalKind | "all"
  setKindFilter: (v: TerminalKind | "all") => void
  unitFilter: string
  setUnitFilter: (v: string) => void
  units: SettingsUnit[]
}) {
  return (
    <>
      <ToggleGroup type="single" variant="outline" size="sm" value={kindFilter} onValueChange={(v) => v && setKindFilter(v as TerminalKind | "all")} className="bg-card">
        <ToggleGroupItem value="all" className="px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          Todos
        </ToggleGroupItem>
        <ToggleGroupItem value="andon_tv" className="px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          TVs Andon
        </ToggleGroupItem>
        <ToggleGroupItem value="operator_tablet" className="px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          Tablets
        </ToggleGroupItem>
      </ToggleGroup>
      {units.length > 1 && (
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger size="sm" className="w-full md:w-44" aria-label="Filtrar por unidade">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as unidades</SelectItem>
            {units.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  )
}
