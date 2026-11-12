"use client"

import { useState } from "react"
import Link from "next/link"
import { ExternalLinkIcon, InfoIcon } from "lucide-react"

import { isNetworkProtocol } from "@/lib/mock/types"
import { cn } from "@/lib/utils"
import type { Protocol, StateMode } from "@/lib/mock/types"
import { GATEWAY_STATUS_LABEL } from "@/lib/roles"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ConnInfo, MachineRow, RegistryGateway, RegistryLine, RegistryUnit } from "@/components/config/machine-registry"
import {
  GATEWAY_STATUS_DOT,
  IPV4_RE,
  MACHINE_TYPES,
  STATE_MODE_HINT,
  STATE_MODE_LABEL,
  piecesPerHour,
  serialSummary,
} from "@/components/config/labels"

/** Painel lateral de edição rápida de uma máquina do cadastro. */
export function MachineEditSheet({
  clientSlug,
  open,
  onOpenChange,
  machine,
  units,
  lines,
  gateways,
  existingCodes,
  onSave,
}: {
  clientSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  machine: MachineRow | null
  units: RegistryUnit[]
  lines: RegistryLine[]
  gateways: RegistryGateway[]
  existingCodes: string[]
  onSave: (row: MachineRow) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        {machine && (
          <EditForm
            key={machine.id}
            clientSlug={clientSlug}
            machine={machine}
            units={units}
            lines={lines}
            gateways={gateways}
            existingCodes={existingCodes}
            onCancel={() => onOpenChange(false)}
            onSave={onSave}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function EditForm({
  clientSlug,
  machine,
  units,
  lines,
  gateways,
  existingCodes,
  onCancel,
  onSave,
}: {
  clientSlug: string
  machine: MachineRow
  units: RegistryUnit[]
  lines: RegistryLine[]
  gateways: RegistryGateway[]
  existingCodes: string[]
  onCancel: () => void
  onSave: (row: MachineRow) => void
}) {
  const [name, setName] = useState(machine.name)
  const [code, setCode] = useState(machine.code)
  const [type, setType] = useState(machine.type)
  const [unitId, setUnitId] = useState(machine.unitId)
  const [lineId, setLineId] = useState(machine.lineId)
  const [gatewayId, setGatewayId] = useState(machine.gatewayId ?? "")
  const [protocol, setProtocol] = useState<Protocol>(machine.conn?.protocol ?? "modbus-tcp")
  const [host, setHost] = useState(machine.conn?.host ?? "")
  const [port, setPort] = useState(String(machine.conn?.port ?? 502))
  const [serialPort, setSerialPort] = useState(machine.conn?.serialPort ?? "")
  const [slaveId, setSlaveId] = useState(String(machine.conn?.unitId ?? 1))
  const [stateMode, setStateMode] = useState<StateMode>(machine.stateMode)
  const [cycle, setCycle] = useState(String(machine.idealCycleS).replace(".", ","))
  const [micro, setMicro] = useState(String(machine.microStopThresholdS))
  const [active, setActive] = useState(machine.active)
  const [submitted, setSubmitted] = useState(false)

  const unitLines = lines.filter((l) => l.unitId === unitId)
  const unitGateways = gateways.filter((g) => g.unitId === unitId)
  const gateway = gateways.find((g) => g.id === gatewayId)
  const types = MACHINE_TYPES.includes(machine.type) ? MACHINE_TYPES : [machine.type, ...MACHINE_TYPES]
  const cycleNum = Number(cycle.replace(",", "."))
  const portNum = Number(port)
  const slaveNum = Number(slaveId)
  const isTcp = isNetworkProtocol(protocol)

  const errors = {
    name: name.trim().length < 3 ? "Informe o nome." : null,
    code: !code.trim()
      ? "Informe o código."
      : existingCodes.some((c) => c.toUpperCase() === code.trim().toUpperCase())
        ? "Código já usado por outra máquina."
        : null,
    line: !lineId ? "Escolha a linha." : null,
    host: gatewayId && isTcp && !IPV4_RE.test(host.trim()) ? "IP inválido (ex.: 192.168.10.25)." : null,
    port: gatewayId && isTcp && !(Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535) ? "Porta de 1 a 65535." : null,
    serialPort: gatewayId && !isTcp && !serialPort ? "Escolha a porta serial." : null,
    slave:
      gatewayId && !(Number.isInteger(slaveNum) && (isTcp ? slaveNum >= 0 && slaveNum <= 255 : slaveNum >= 1 && slaveNum <= 247))
        ? isTcp
          ? "Unit ID de 0 a 255."
          : "Endereço do escravo de 1 a 247."
        : null,
    cycle: !(cycleNum > 0) ? "Ciclo ideal maior que zero." : null,
    micro: !(Number(micro) >= 0) ? "Valor inválido." : null,
  }
  const valid = Object.values(errors).every((e) => !e)
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (!valid) return
    const prevConn = machine.conn
    const conn: ConnInfo | null = !gatewayId
      ? null
      : isTcp
        ? { protocol, host: host.trim(), port: portNum, unitId: slaveNum, timeoutMs: prevConn?.protocol === protocol ? prevConn.timeoutMs : 1000 }
        : {
            protocol,
            serialPort,
            unitId: slaveNum,
            baudRate: prevConn?.baudRate ?? 19200,
            parity: prevConn?.parity ?? "E",
            dataBits: prevConn?.dataBits ?? 8,
            stopBits: prevConn?.stopBits ?? 1,
            timeoutMs: prevConn?.protocol === protocol ? prevConn.timeoutMs : 500,
          }
    onSave({
      ...machine,
      name: name.trim(),
      code: code.trim().toUpperCase(),
      type,
      unitId,
      lineId,
      gatewayId: gatewayId || null,
      conn,
      stateMode,
      idealCycleS: cycleNum,
      microStopThresholdS: Number(micro),
      active,
    })
  }

  return (
    <form onSubmit={submit} className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b pr-12">
        <SheetTitle>Editar {machine.name}</SheetTitle>
        <SheetDescription>
          <span className="font-mono">{machine.code}</span> · ao salvar, uma nova versão de configuração é publicada no gateway.
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <FieldGroup className="gap-6">
          <FieldSet className="gap-4">
            <FieldLegend variant="label" className="mb-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Identificação
            </FieldLegend>
            <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
              <Field data-invalid={!!err("name")}>
                <FieldLabel htmlFor="edit-name">Nome</FieldLabel>
                <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!err("name")} />
                <FieldError>{err("name")}</FieldError>
              </Field>
              <Field data-invalid={!!err("code")}>
                <FieldLabel htmlFor="edit-code">Código</FieldLabel>
                <Input id="edit-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono" aria-invalid={!!err("code")} />
                <FieldError>{err("code")}</FieldError>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="edit-type">Tipo</FieldLabel>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="edit-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="edit-unit">Unidade</FieldLabel>
                <Select
                  value={unitId}
                  onValueChange={(v) => {
                    setUnitId(v)
                    setLineId(lines.find((l) => l.unitId === v)?.id ?? "")
                    setGatewayId(gateways.find((g) => g.unitId === v)?.id ?? "")
                  }}
                >
                  <SelectTrigger id="edit-unit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field data-invalid={!!err("line")}>
                <FieldLabel htmlFor="edit-line">Linha</FieldLabel>
                <Select value={lineId} onValueChange={setLineId}>
                  <SelectTrigger id="edit-line" className="w-full" aria-invalid={!!err("line")}>
                    <SelectValue placeholder="Escolha a linha" />
                  </SelectTrigger>
                  <SelectContent>
                    {unitLines.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name} <span className="font-mono text-xs text-muted-foreground">{l.code}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError>{err("line")}</FieldError>
              </Field>
            </div>
          </FieldSet>

          <Separator />

          <FieldSet className="gap-4">
            <FieldLegend variant="label" className="mb-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Conexão com o CLP
            </FieldLegend>
            <Field>
              <FieldLabel htmlFor="edit-gw">Gateway</FieldLabel>
              <Select value={gatewayId} onValueChange={setGatewayId}>
                <SelectTrigger id="edit-gw" className="w-full">
                  <SelectValue placeholder={unitGateways.length ? "Escolha o gateway" : "Nenhum gateway nesta unidade"} />
                </SelectTrigger>
                <SelectContent>
                  {unitGateways.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      <span className={cn("size-2 rounded-full", GATEWAY_STATUS_DOT[g.status])} />
                      {g.name}
                      <span className="text-xs text-muted-foreground">{GATEWAY_STATUS_LABEL[g.status]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {gateway && (
              <>
                <Field>
                  <FieldLabel>Protocolo</FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={protocol}
                    onValueChange={(v) => v && setProtocol(v as Protocol)}
                    className="w-full"
                  >
                    <ToggleGroupItem value="modbus-tcp" className="flex-1">
                      Modbus TCP/IP
                    </ToggleGroupItem>
                    <ToggleGroupItem value="modbus-rtu" className="flex-1" disabled={gateway.serialPorts.length === 0}>
                      Modbus RTU (RS-485)
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>
                {isTcp ? (
                  <div className="grid grid-cols-[1fr_5.5rem_5.5rem] gap-3">
                    <Field data-invalid={!!err("host")}>
                      <FieldLabel htmlFor="edit-host">IP do CLP</FieldLabel>
                      <Input id="edit-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.10.25" className="font-mono" inputMode="decimal" aria-invalid={!!err("host")} />
                    </Field>
                    <Field data-invalid={!!err("port")}>
                      <FieldLabel htmlFor="edit-port">Porta</FieldLabel>
                      <Input id="edit-port" value={port} onChange={(e) => setPort(e.target.value)} className="font-mono" inputMode="numeric" aria-invalid={!!err("port")} />
                    </Field>
                    <Field data-invalid={!!err("slave")}>
                      <FieldLabel htmlFor="edit-slave">Unit ID</FieldLabel>
                      <Input id="edit-slave" value={slaveId} onChange={(e) => setSlaveId(e.target.value)} className="font-mono" inputMode="numeric" aria-invalid={!!err("slave")} />
                    </Field>
                    <FieldError className="col-span-3">{err("host") ?? err("port") ?? err("slave")}</FieldError>
                  </div>
                ) : (
                  <div className="grid grid-cols-[1fr_7rem] gap-3">
                    <Field data-invalid={!!err("serialPort")}>
                      <FieldLabel htmlFor="edit-serial">Porta serial</FieldLabel>
                      <Select value={serialPort} onValueChange={setSerialPort}>
                        <SelectTrigger id="edit-serial" className="w-full font-mono" aria-invalid={!!err("serialPort")}>
                          <SelectValue placeholder="Escolha" />
                        </SelectTrigger>
                        <SelectContent>
                          {gateway.serialPorts.map((p) => (
                            <SelectItem key={p} value={p} className="font-mono">
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field data-invalid={!!err("slave")}>
                      <FieldLabel htmlFor="edit-slave">Unit ID</FieldLabel>
                      <Input id="edit-slave" value={slaveId} onChange={(e) => setSlaveId(e.target.value)} className="font-mono" inputMode="numeric" aria-invalid={!!err("slave")} />
                    </Field>
                    <FieldDescription className="col-span-2 text-xs">
                      Formato do barramento: {serialSummary(machine.conn?.protocol === "modbus-rtu" ? machine.conn : { baudRate: 19200, dataBits: 8, parity: "E", stopBits: 1 })}.
                      Todos os escravos da mesma porta usam a mesma configuração.
                    </FieldDescription>
                    <FieldError className="col-span-2">{err("serialPort") ?? err("slave")}</FieldError>
                  </div>
                )}
                <Alert className="py-2.5">
                  <InfoIcon />
                  <AlertDescription className="text-xs">
                    {machine.tagCount > 0
                      ? `Os ${machine.tagCount} sinais mapeados são mantidos. Para editar registros e testar leituras, abra o gateway.`
                      : "Nenhum sinal mapeado ainda. Mapeie os registros na tela do gateway."}{" "}
                    <Link href={`/${clientSlug}/config/gateways/${gateway.id}`} className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-4">
                      Abrir {gateway.name}
                      <ExternalLinkIcon className="size-3" />
                    </Link>
                  </AlertDescription>
                </Alert>
              </>
            )}
          </FieldSet>

          <Separator />

          <FieldSet className="gap-4">
            <FieldLegend variant="label" className="mb-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Regras de OEE
            </FieldLegend>
            <Field>
              <FieldLabel htmlFor="edit-mode">Modo de estado</FieldLabel>
              <Select value={stateMode} onValueChange={(v) => setStateMode(v as StateMode)}>
                <SelectTrigger id="edit-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATE_MODE_LABEL) as StateMode[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {STATE_MODE_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription className="text-xs">{STATE_MODE_HINT[stateMode]}</FieldDescription>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!err("cycle")}>
                <FieldLabel htmlFor="edit-cycle">Ciclo ideal</FieldLabel>
                <InputGroup>
                  <InputGroupInput id="edit-cycle" value={cycle} onChange={(e) => setCycle(e.target.value)} inputMode="decimal" aria-invalid={!!err("cycle")} />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>s</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription className="text-xs">{err("cycle") ?? `${piecesPerHour(cycleNum)} · padrão quando o produto não tem ciclo próprio`}</FieldDescription>
              </Field>
              <Field data-invalid={!!err("micro")}>
                <FieldLabel htmlFor="edit-micro">Limite de micro-parada</FieldLabel>
                <InputGroup>
                  <InputGroupInput id="edit-micro" value={micro} onChange={(e) => setMicro(e.target.value)} inputMode="numeric" aria-invalid={!!err("micro")} />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>s</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription className="text-xs">Paradas menores contam como perda de performance.</FieldDescription>
              </Field>
            </div>
          </FieldSet>

          <Separator />

          <Field orientation="horizontal" className="rounded-lg border p-3">
            <div className="flex flex-1 flex-col gap-0.5">
              <FieldLabel htmlFor="edit-active">Máquina ativa</FieldLabel>
              <FieldDescription className="text-xs">Inativa: o gateway não lê os sinais e ela some dos dashboards.</FieldDescription>
            </div>
            <Switch id="edit-active" checked={active} onCheckedChange={setActive} />
          </Field>
        </FieldGroup>
      </div>

      <SheetFooter className="flex-row justify-end border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">Salvar alterações</Button>
      </SheetFooter>
    </form>
  )
}
