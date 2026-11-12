"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  ActivityIcon,
  CableIcon,
  CopyIcon,
  FactoryIcon,
  NetworkIcon,
  PencilIcon,
  PlugZapIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  SearchIcon,
  SearchXIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { isNetworkProtocol } from "@/lib/mock/types"
import { cn } from "@/lib/utils"
import type { GatewayStatus, Protocol, StateMode } from "@/lib/mock/types"
import { GATEWAY_STATUS_LABEL } from "@/lib/roles"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Ring } from "@/components/dashboard/ring"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { MachineEditSheet } from "@/components/config/machine-edit-sheet"
import { SoftIconButton, SoftIconLink } from "@/components/refresh/soft-action"
import {
  GATEWAY_STATUS_DOT,
  PROTOCOL_LABEL,
  PROTOCOL_SHORT,
  STATE_MODE_LABEL,
  norm,
  piecesPerHour,
  plural,
  seconds,
  serialSummary,
} from "@/components/config/labels"
import { useCanEdit } from "@/components/config/engemase-managed"

export interface ConnInfo {
  protocol: Protocol
  host?: string
  port?: number
  serialPort?: string
  baudRate?: number
  parity?: "N" | "E" | "O"
  dataBits?: 8
  stopBits?: 1 | 2
  unitId: number
  timeoutMs: number
}

export interface MachineRow {
  id: string
  name: string
  code: string
  type: string
  unitId: string
  lineId: string
  gatewayId: string | null
  deviceName: string | null
  conn: ConnInfo | null
  stateMode: StateMode
  idealCycleS: number
  microStopThresholdS: number
  active: boolean
  tagCount: number
}

export interface RegistryUnit {
  id: string
  name: string
}
export interface RegistryLine {
  id: string
  unitId: string
  name: string
  code: string
}
export interface RegistryGateway {
  id: string
  unitId: string
  name: string
  status: GatewayStatus
  configVersion: number
  serialPorts: string[]
}

type ProtoFilter = "all" | Protocol | "none"
type StatusFilter = "all" | "active" | "inactive"

/** Cadastro de máquinas: tabela com busca, filtros, edição em painel lateral, duplicar e desativar. */
export function MachineRegistry({
  clientSlug,
  initialRows,
  units,
  lines,
  gateways,
  machineLimit,
}: {
  clientSlug: string
  initialRows: MachineRow[]
  units: RegistryUnit[]
  lines: RegistryLine[]
  gateways: RegistryGateway[]
  machineLimit: number
}) {
  const [rows, setRows] = useState(initialRows)
  const canEdit = useCanEdit()
  const [query, setQuery] = useState("")
  const [unitId, setUnitId] = useState("all")
  const [proto, setProto] = useState<ProtoFilter>("all")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [editing, setEditing] = useState<MachineRow | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [toggling, setToggling] = useState<MachineRow | null>(null)

  const unitName = useMemo(() => new Map(units.map((u) => [u.id, u.name])), [units])
  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines])
  const gatewayById = useMemo(() => new Map(gateways.map((g) => [g.id, g])), [gateways])

  const filtered = useMemo(() => {
    const q = norm(query.trim())
    return rows.filter((m) => {
      if (unitId !== "all" && m.unitId !== unitId) return false
      if (status === "active" && !m.active) return false
      if (status === "inactive" && m.active) return false
      if (proto === "none" && m.conn) return false
      if (proto !== "all" && proto !== "none" && m.conn?.protocol !== proto) return false
      if (!q) return true
      const line = lineById.get(m.lineId)
      return [m.name, m.code, m.type, line?.name ?? "", m.conn?.host ?? "", m.deviceName ?? ""].some((v) => norm(v).includes(q))
    })
  }, [rows, query, unitId, status, proto, lineById])

  const activeCount = rows.filter((r) => r.active).length
  const counts = {
    tcp: rows.filter((r) => r.conn?.protocol === "modbus-tcp").length,
    rtu: rows.filter((r) => r.conn?.protocol === "modbus-rtu").length,
    none: rows.filter((r) => !r.conn).length,
    inactive: rows.filter((r) => !r.active).length,
  }
  const hasFilters = query !== "" || unitId !== "all" || proto !== "all" || status !== "all"
  const clearFilters = () => {
    setQuery("")
    setUnitId("all")
    setProto("all")
    setStatus("all")
  }

  const openEdit = (row: MachineRow) => {
    setEditing(row)
    setSheetOpen(true)
  }

  const saveEdit = (next: MachineRow) => {
    setRows((prev) => prev.map((r) => (r.id === next.id ? next : r)))
    setSheetOpen(false)
    const gw = next.gatewayId ? gatewayById.get(next.gatewayId) : undefined
    toast.success(`${next.name} atualizada`, {
      description: gw
        ? `Nova configuração v${gw.configVersion + 1} enviada ao ${gw.name}. O gateway aplica em até 10 s.`
        : "Alterações salvas.",
    })
  }

  const duplicate = (row: MachineRow) => {
    if (rows.length >= machineLimit) {
      toast.error("Todas as máquinas contratadas estão em uso", { description: `O contrato cobre ${machineLimit} máquinas (cobrança por máquina). Para mais, amplie o contrato.` })
      return
    }
    const copy: MachineRow = {
      ...row,
      id: `mch_copy_${Date.now().toString(36)}`,
      name: `${row.name} (cópia)`,
      code: `${row.code}-C`,
      active: false,
      conn: row.conn ? { ...row.conn } : null,
    }
    setRows((prev) => {
      const i = prev.findIndex((r) => r.id === row.id)
      return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)]
    })
    toast.success(`${row.name} duplicada`, {
      description: "A cópia foi criada inativa, com os mesmos sinais. Ajuste nome, código e endereço do CLP antes de ativar.",
      action: { label: "Editar cópia", onClick: () => openEdit(copy) },
    })
  }

  const confirmToggle = () => {
    if (!toggling) return
    const next = !toggling.active
    if (next && activeCount >= machineLimit) {
      toast.error("Todas as máquinas contratadas estão ativas", { description: `O contrato cobre ${machineLimit} máquinas ativas (cobrança por máquina).` })
      setToggling(null)
      return
    }
    setRows((prev) => prev.map((r) => (r.id === toggling.id ? { ...r, active: next } : r)))
    toast.success(next ? `${toggling.name} reativada` : `${toggling.name} desativada`, {
      description: next
        ? "O gateway volta a ler os sinais desta máquina na próxima versão de configuração."
        : "O gateway para de ler esta máquina. O histórico de OEE fica preservado.",
    })
    setToggling(null)
  }

  const usage = machineLimit > 0 ? activeCount / machineLimit : 0
  const usageColor = usage >= 1 ? "#dc2626" : usage >= 0.8 ? "#f59e0b" : "#257bb4"

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FactoryIcon}
          tone="blue"
          label="Máquinas ativas / contratadas"
          value={
            <>
              {activeCount}
              <span className="text-base font-semibold text-muted-foreground"> / {machineLimit}</span>
            </>
          }
          hint={usage >= 1 ? "Todas as contratadas em uso" : usage >= 0.8 ? "Perto do total contratado" : `${counts.inactive} ${counts.inactive === 1 ? "inativa" : "inativas"}`}
          aside={<Ring value={usage} size={52} stroke={6} color={usageColor} />}
        />
        <StatCard icon={NetworkIcon} tone="teal" label="Modbus TCP" value={counts.tcp} hint="CLPs na rede Ethernet" />
        <StatCard icon={CableIcon} tone="navy" label="Modbus RTU" value={counts.rtu} hint="CLPs no barramento RS-485" />
        <StatCard
          icon={PlugZapIcon}
          tone="orange"
          label="Sem conexão"
          value={counts.none}
          hint={counts.none > 0 ? "Configure o CLP para medir o OEE" : "Todas com CLP configurado"}
        />
      </div>

      <SectionCard
        title="Máquinas cadastradas"
        description="Clique no nome para editar. Alterações geram uma nova versão de configuração para o gateway."
        className="overflow-hidden"
        bodyClassName="px-0 pb-0"
      >
        <div className="flex flex-col gap-2 px-5 pb-4 lg:flex-row lg:items-center">
          <InputGroup className="lg:w-72">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar nome, código, linha ou IP"
              aria-label="Buscar máquina"
            />
            {query && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Limpar busca" onClick={() => setQuery("")}>
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            {units.length > 1 && (
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger className="w-full sm:w-44" aria-label="Unidade">
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
            <Select value={proto} onValueChange={(v) => setProto(v as ProtoFilter)}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Protocolo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os protocolos</SelectItem>
                <SelectItem value="modbus-tcp">Modbus TCP ({counts.tcp})</SelectItem>
                <SelectItem value="modbus-rtu">Modbus RTU ({counts.rtu})</SelectItem>
                <SelectItem value="none">Sem conexão ({counts.none})</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Situação">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Ativas e inativas</SelectItem>
                <SelectItem value="active">Só ativas</SelectItem>
                <SelectItem value="inactive">Só inativas ({counts.inactive})</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                <XIcon />
                Limpar
              </Button>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <Empty className="mx-5 mb-5 rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FactoryIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhuma máquina cadastrada</EmptyTitle>
              <EmptyDescription>Use o assistente para cadastrar a primeira máquina, conectar o CLP via Modbus e mapear os sinais.</EmptyDescription>
            </EmptyHeader>
            {canEdit && (
              <EmptyContent>
                <Button asChild>
                  <Link href={`/${clientSlug}/config/maquinas/nova`}>
                    <PlusIcon />
                    Nova máquina
                  </Link>
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty className="mx-5 mb-5 rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhuma máquina encontrada</EmptyTitle>
              <EmptyDescription>Nenhuma máquina corresponde aos filtros aplicados.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={clearFilters}>
                Limpar filtros
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-5">Máquina</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Unidade / linha</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>Conexão</TableHead>
                  <TableHead>Modo de estado</TableHead>
                  <TableHead className="text-right">Ciclo ideal</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="pr-5 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => {
                  const line = lineById.get(m.lineId)
                  const gw = m.gatewayId ? gatewayById.get(m.gatewayId) : undefined
                  return (
                    <TableRow key={m.id} className={cn(!m.active && "text-muted-foreground")}>
                      <TableCell className="pl-5">
                        {canEdit ? (
                          <button type="button" onClick={() => openEdit(m)} className="text-left font-medium text-foreground hover:text-primary hover:underline">
                            {m.name}
                          </button>
                        ) : (
                          <span className="font-medium text-foreground">{m.name}</span>
                        )}
                        <div className="font-mono text-xs text-muted-foreground">{m.code}</div>
                      </TableCell>
                      <TableCell>{m.type}</TableCell>
                      <TableCell>
                        <div>{line?.name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{unitName.get(m.unitId) ?? "—"}</div>
                      </TableCell>
                      <TableCell>
                        {gw ? (
                          <Link
                            href={`/${clientSlug}/config/gateways/${gw.id}`}
                            className="inline-flex items-center gap-1.5 hover:underline"
                            title={GATEWAY_STATUS_LABEL[gw.status]}
                          >
                            <span className={cn("size-2 shrink-0 rounded-full", GATEWAY_STATUS_DOT[gw.status])} />
                            {gw.name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <ConnCell conn={m.conn} />
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{STATE_MODE_LABEL[m.stateMode]}</span>
                        <div className="text-xs text-muted-foreground">{plural(m.tagCount, "sinal", "sinais")}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{seconds(m.idealCycleS)}</div>
                        <div className="text-xs text-muted-foreground">{piecesPerHour(m.idealCycleS)}</div>
                      </TableCell>
                      <TableCell>
                        {m.active ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-state-running/12 px-2 py-0.5 text-xs font-semibold text-state-running">
                            <span className="size-1.5 rounded-full bg-state-running" />
                            Ativa
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                            <span className="size-1.5 rounded-full bg-state-nocomm" />
                            Inativa
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="pr-5">
                        <div className="flex items-center justify-end gap-1.5">
                          {canEdit && (
                            <>
                              <SoftIconButton label={`Editar ${m.name}`} onClick={() => openEdit(m)}>
                                <PencilIcon />
                              </SoftIconButton>
                              <SoftIconButton label={`Duplicar ${m.name}`} tone="slate" onClick={() => duplicate(m)}>
                                <CopyIcon />
                              </SoftIconButton>
                            </>
                          )}
                          {m.id.startsWith("mch_copy_") ? (
                            <SoftIconButton label="Ver ao vivo (disponível após salvar e ativar)" tone="teal" disabled>
                              <ActivityIcon />
                            </SoftIconButton>
                          ) : (
                            <SoftIconLink href={`/${clientSlug}/maquinas/${m.id}`} label={`Ver ${m.name} ao vivo`} tone="teal">
                              <ActivityIcon />
                            </SoftIconLink>
                          )}
                          {canEdit &&
                            (m.active ? (
                              <SoftIconButton label={`Desativar ${m.name}`} tone="red" onClick={() => setToggling(m)}>
                                <PowerOffIcon />
                              </SoftIconButton>
                            ) : (
                              <SoftIconButton label={`Reativar ${m.name}`} tone="teal" onClick={() => setToggling(m)}>
                                <PowerIcon />
                              </SoftIconButton>
                            ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <div className="border-t px-5 py-2.5 text-xs text-muted-foreground">
              {filtered.length === rows.length
                ? plural(rows.length, "máquina", "máquinas")
                : `${filtered.length} de ${plural(rows.length, "máquina", "máquinas")}`}
              {" · "}
              {counts.tcp} Modbus TCP · {counts.rtu} Modbus RTU
              {counts.none > 0 && ` · ${counts.none} sem conexão configurada`}
            </div>
          </>
        )}
      </SectionCard>

      <MachineEditSheet
        clientSlug={clientSlug}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        machine={editing}
        units={units}
        lines={lines}
        gateways={gateways}
        existingCodes={rows.filter((r) => r.id !== editing?.id).map((r) => r.code)}
        onSave={saveEdit}
      />

      <AlertDialog open={toggling !== null} onOpenChange={(o) => !o && setToggling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{toggling?.active ? `Desativar ${toggling?.name}?` : `Reativar ${toggling?.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {toggling?.active
                ? "O gateway deixa de ler os sinais desta máquina e ela sai dos dashboards, da TV e da tela do operador. O histórico de OEE é preservado e você pode reativar depois."
                : "A máquina volta a ser lida pelo gateway e a aparecer nos dashboards. Confira o endereço do CLP antes de reativar."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmToggle} variant={toggling?.active ? "destructive" : "default"}>
              {toggling?.active ? "Desativar" : "Reativar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ConnCell({ conn }: { conn: ConnInfo | null }) {
  if (!conn) return <span className="text-xs text-muted-foreground">Não configurada</span>
  const tcp = isNetworkProtocol(conn.protocol)
  return (
    <div className="flex items-start gap-2">
      <Badge
        variant="outline"
        title={PROTOCOL_LABEL[conn.protocol]}
        className={cn(
          "mt-0.5 border-transparent font-mono text-[10px]",
          tcp ? "bg-[#0e9384]/10 text-[#0e9384]" : "bg-[#2c4e73]/10 text-[#2c4e73] dark:bg-white/10 dark:text-[#9cc3e6]",
        )}
      >
        {PROTOCOL_SHORT[conn.protocol]}
      </Badge>
      <div className="min-w-0">
        <div className="font-mono text-xs">{tcp ? `${conn.host}:${conn.port}` : conn.serialPort}</div>
        <div className="text-xs text-muted-foreground">
          Unit ID {conn.unitId}
          {!tcp && ` · ${serialSummary(conn)}`}
        </div>
      </div>
    </div>
  )
}
