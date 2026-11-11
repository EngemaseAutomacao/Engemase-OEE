"use client"

import { useMemo, useState } from "react"
import { FileCogIcon, type LucideIcon, PlugZapIcon, PowerIcon, ScanSearchIcon, TerminalSquareIcon } from "lucide-react"

import { SectionCard } from "@/components/dashboard/section-card"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FilterPills, type PillOption } from "./filter-pills"
import type { CommandVM } from "./gateway-detail-data"
import { COMMAND_STATUS_LABEL, COMMAND_STATUS_STYLE, COMMAND_TYPE_LABEL, type CommandType } from "./labels"
import { Chip } from "./status-chip"

const TYPE_ICON: Record<CommandType, { icon: LucideIcon; tone: IconTone }> = {
  "tag.read": { icon: ScanSearchIcon, tone: "blue" },
  "device.test": { icon: PlugZapIcon, tone: "teal" },
  "config.reload": { icon: FileCogIcon, tone: "navy" },
  "agent.restart": { icon: PowerIcon, tone: "orange" },
}

const TYPES: CommandType[] = ["tag.read", "device.test", "config.reload", "agent.restart"]

const msLabel = (ms: number | null) => (ms === null ? "—" : ms >= 1000 ? `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` : `${ms} ms`)

/** Aba "Comandos": histórico dos comandos enviados ao gateway pelo /sync. */
export function CommandsTab({ commands }: { commands: CommandVM[] }) {
  const [type, setType] = useState<CommandType | "all">("all")
  const visible = useMemo(() => commands.filter((c) => type === "all" || c.type === type), [commands, type])

  const pills: PillOption<CommandType | "all">[] = [
    { value: "all", label: "Todos", count: commands.length },
    ...TYPES.map((t) => ({ value: t, label: COMMAND_TYPE_LABEL[t], count: commands.filter((c) => c.type === t).length })),
  ]

  if (commands.length === 0) {
    return (
      <Empty className="rounded-2xl border border-dashed bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TerminalSquareIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhum comando enviado</EmptyTitle>
          <EmptyDescription>Testes de conexão, leituras de tag, recargas de configuração e reinícios aparecem aqui.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <SectionCard
      title="Histórico de comandos"
      description="Entregues ao gateway no sincronismo. Comandos expiram (leitura de tag: 2 min) e não são executados depois disso."
      bodyClassName="px-0 pb-2"
    >
      <FilterPills label="Filtrar por tipo de comando" options={pills} value={type} onChange={setType} className="mx-4 mb-3" />
      {visible.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nenhum comando deste tipo.</p>
      ) : (
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Comando</TableHead>
              <TableHead>Quando</TableHead>
              <TableHead>Solicitado por</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead className="pr-5 text-right">Duração</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((c) => {
              const t = TYPE_ICON[c.type]
              return (
                <TableRow key={c.id}>
                  <TableCell className="max-w-80 pl-5">
                    <div className="flex items-center gap-3">
                      <IconCircle icon={t.icon} tone={t.tone} soft size="sm" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{COMMAND_TYPE_LABEL[c.type]}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.target}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm tabular-nums">{c.createdLabel}</div>
                    <div className="text-xs text-muted-foreground">{c.createdAgo}</div>
                  </TableCell>
                  <TableCell className="text-sm">{c.requestedBy}</TableCell>
                  <TableCell>
                    <Chip className={COMMAND_STATUS_STYLE[c.status]}>
                      {c.status === "sent" && <Spinner className="size-3" />}
                      {COMMAND_STATUS_LABEL[c.status]}
                    </Chip>
                  </TableCell>
                  <TableCell className="max-w-96 text-xs whitespace-normal text-muted-foreground">{c.result}</TableCell>
                  <TableCell className="pr-5 text-right text-xs tabular-nums">{msLabel(c.durationMs)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  )
}
