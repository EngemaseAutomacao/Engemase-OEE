import Link from "next/link"
import { CableIcon, CpuIcon, RouterIcon, Settings2Icon, TagsIcon, TriangleAlertIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { ago, num } from "@/lib/format"
import { GATEWAY_STATUS_LABEL } from "@/lib/roles"
import type { Device, Gateway, StateMode, Tag } from "@/lib/mock/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReadAllTagsButton, TagReadButton } from "@/components/monitoring/connection-actions"
import {
  DEVICE_STATUS_DOT,
  DEVICE_STATUS_LABEL,
  GATEWAY_STATUS_DOT,
  MODBUS_AREA_LABEL,
  PROTOCOL_LABEL,
  STATE_MODE_LABEL,
  TAG_QUALITY_LABEL,
  TAG_ROLE_LABEL,
  formatTagValue,
  modbusRef,
  serialSummary,
} from "@/components/monitoring/labels"

const QUALITY_STYLE: Record<Tag["quality"], string> = {
  good: "bg-state-running/12 text-state-running",
  bad: "bg-state-fault/12 text-state-fault",
  stale: "bg-state-stopped/15 text-amber-700 dark:text-state-stopped",
}

function StatusDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("size-2 rounded-full", className)} />
      {label}
    </span>
  )
}

function Fields({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function BlockTitle({ icon: Icon, title, status }: { icon: typeof CpuIcon; title: string; status: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        {status}
      </div>
    </div>
  )
}

/** Card "Conexão": gateway, CLP (Modbus TCP ou RTU), tags e últimos valores. */
export function ConnectionCard({
  clientSlug,
  gateway,
  device,
  busPeers,
  tags,
  stateMode,
}: {
  clientSlug: string
  gateway: Gateway | undefined
  device: Device | undefined
  /** Outros escravos no mesmo barramento RS-485 (Modbus RTU). */
  busPeers: Device[]
  tags: Tag[]
  stateMode: StateMode
}) {
  const gatewayOffline = !gateway || gateway.status === "offline" || gateway.status === "pending"
  const readCtx = { gatewayOffline, deviceError: device?.lastError, latencyMs: device?.latencyMs ?? null }

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Conexão</CardTitle>
        <CardDescription>Gateway, CLP e tags lidas para calcular estado, contagem e OEE</CardDescription>
        {gateway && (
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${clientSlug}/config/gateways/${gateway.id}`}>
                <Settings2Icon />
                <span className="hidden sm:inline">Configurar</span>
              </Link>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-6 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          {gateway ? (
            <div>
              <BlockTitle
                icon={RouterIcon}
                title={gateway.name}
                status={<StatusDot className={GATEWAY_STATUS_DOT[gateway.status]} label={GATEWAY_STATUS_LABEL[gateway.status]} />}
              />
              <Fields
                items={[
                  ["Último contato", gateway.lastSeen ? ago(gateway.lastSeen) : "nunca conectou"],
                  ["Host", gateway.hostname],
                  ["IP rede OT", gateway.ipOt ?? "—"],
                  [
                    "Configuração",
                    gateway.configApplied === null
                      ? `v${gateway.configVersion} (não aplicada)`
                      : gateway.configApplied < gateway.configVersion
                        ? `v${gateway.configApplied} · v${gateway.configVersion} pendente`
                        : `v${gateway.configApplied}`,
                  ],
                  ["Buffer local", `${num(gateway.bufferPending)} leituras`],
                ]}
              />
              {gateway.status === "pending" && gateway.enrollmentCode && (
                <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Aguardando ativação no local com o código <span className="font-mono font-semibold text-foreground">{gateway.enrollmentCode}</span>.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum gateway vinculado a esta máquina.</p>
          )}

          {device ? (
            <div className="border-t pt-5">
              <BlockTitle
                icon={CpuIcon}
                title={device.name}
                status={<StatusDot className={DEVICE_STATUS_DOT[device.status]} label={DEVICE_STATUS_LABEL[device.status]} />}
              />
              <Fields
                items={[
                  ["Protocolo", PROTOCOL_LABEL[device.protocol]],
                  ...(device.protocol === "modbus-tcp"
                    ? ([
                        ["Endereço", `${device.params.host}:${device.params.port}`],
                        ["Unit ID", String(device.params.unitId)],
                      ] as [string, string][])
                    : ([
                        ["Porta serial", device.params.serialPort ?? "—"],
                        ["Parâmetros", serialSummary(device.params)],
                        ["Escravo (unit id)", String(device.params.unitId)],
                      ] as [string, string][])),
                  ["Timeout", `${num(device.params.timeoutMs)} ms`],
                  ["Latência", device.latencyMs !== null ? `${device.latencyMs} ms` : "—"],
                  ["Erros (1 min)", String(device.errors1m)],
                  ["Modo de estado", STATE_MODE_LABEL[stateMode]],
                ]}
              />
              {device.lastError && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-state-fault/10 px-3 py-2 text-xs text-state-fault">
                  <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
                  <span>{device.lastError}</span>
                </div>
              )}
              {device.protocol === "modbus-rtu" && busPeers.length > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <CableIcon className="mt-px size-3.5 shrink-0" />
                  <span>
                    Barramento RS-485 compartilhado com{" "}
                    {busPeers.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && ", "}
                        <span className="font-medium text-foreground">{p.name}</span> (escravo {p.params.unitId})
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="border-t pt-5 text-sm text-muted-foreground">Nenhum CLP vinculado. Cadastre a conexão Modbus TCP ou RTU no gateway.</div>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <TagsIcon className="size-4 text-muted-foreground" />
              Tags mapeadas
              <Badge variant="secondary" className="tabular-nums">
                {tags.length}
              </Badge>
            </div>
            {tags.length > 0 && <ReadAllTagsButton total={tags.length} good={tags.filter((t) => t.quality === "good").length} {...readCtx} />}
          </div>
          {tags.length === 0 ? (
            <Empty className="border border-dashed py-8 md:py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <TagsIcon />
                </EmptyMedia>
                <EmptyTitle className="text-base">Nenhuma tag mapeada</EmptyTitle>
                <EmptyDescription>
                  Mapeie ao menos as tags de <strong>rodando</strong> e <strong>contagem total</strong> para o OEE ser calculado.
                </EmptyDescription>
              </EmptyHeader>
              {gateway && (
                <EmptyContent>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/${clientSlug}/config/gateways/${gateway.id}`}>Mapear tags no gateway</Link>
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-3">Tag</TableHead>
                    <TableHead>Endereço</TableHead>
                    <TableHead className="text-right">Último valor</TableHead>
                    <TableHead>Qualidade</TableHead>
                    <TableHead className="text-right">Ciclo</TableHead>
                    <TableHead className="pr-3">
                      <span className="sr-only">Testar</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tags.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="pl-3">
                        <div className="max-w-56 truncate font-medium">{t.name}</div>
                        <div className="text-xs text-muted-foreground">{TAG_ROLE_LABEL[t.role]}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs">{modbusRef(t.area, t.address)}</div>
                        <div className="text-xs text-muted-foreground">
                          {MODBUS_AREA_LABEL[t.area]} {t.address} · {t.dataType}
                          {t.dataType.endsWith("32") && ` · ${t.byteOrder}`}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatTagValue(t.lastValue, t.dataType, t.role)}</TableCell>
                      <TableCell>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", QUALITY_STYLE[t.quality])}>{TAG_QUALITY_LABEL[t.quality]}</span>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{num(t.pollMs)} ms</TableCell>
                      <TableCell className="pr-3 text-right">
                        <TagReadButton tagName={t.name} value={formatTagValue(t.lastValue, t.dataType, t.role)} quality={t.quality} {...readCtx} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
