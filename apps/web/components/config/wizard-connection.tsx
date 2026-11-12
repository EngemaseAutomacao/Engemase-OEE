"use client"

import Link from "next/link"
import {
  CableIcon,
  NetworkIcon,
  CheckCircle2Icon,
  EthernetPortIcon,
  InfoIcon,
  PlugZapIcon,
  RouterIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { isNetworkProtocol, type Protocol } from "@/lib/mock/types"
import { GATEWAY_STATUS_LABEL } from "@/lib/roles"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { BAUD_RATES, GATEWAY_STATUS_DOT, PARITY_LABEL, rs485Label, serialSummary } from "@/components/config/labels"
import type { ConnDraft, Errors, WizardDevice, WizardGateway } from "@/components/config/wizard-model"

export interface ConnTest {
  status: "idle" | "testing" | "ok"
  latencyMs?: number
  signature?: string
}

/** Etapa 2: gateway da unidade + Modbus TCP ou Modbus RTU (RS-485), com teste de conexão. */
export function ConnectionStep({
  clientSlug,
  draft,
  onChange,
  errors,
  show,
  warnings,
  gateways,
  gateway,
  busDevices,
  test,
  testValid,
  onTest,
}: {
  clientSlug: string
  draft: ConnDraft
  onChange: (patch: Partial<ConnDraft>) => void
  errors: Errors
  show: boolean
  warnings: string[]
  gateways: WizardGateway[]
  gateway: WizardGateway | undefined
  busDevices: WizardDevice[]
  test: ConnTest
  testValid: boolean
  onTest: () => void
}) {
  const err = (k: string) => (show ? (errors[k] ?? null) : null)
  const isTcp = isNetworkProtocol(draft.protocol)
  const canTest = !!gateway && (gateway.status === "online" || gateway.status === "degraded")
  const fieldsOk = Object.values(errors).every((e) => !e)

  if (gateways.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RouterIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhum gateway nesta unidade</EmptyTitle>
          <EmptyDescription>
            A máquina é lida por um gateway instalado na mesma unidade. Provisione um gateway (código de ativação) e volte para concluir o cadastro.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link href={`/${clientSlug}/config/gateways`}>Ir para gateways</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Field data-invalid={!!err("gatewayId")}>
        <FieldLabel htmlFor="wz-gw">Gateway</FieldLabel>
        <Select value={draft.gatewayId} onValueChange={(v) => onChange({ gatewayId: v, serialPort: "" })}>
          <SelectTrigger id="wz-gw" className="w-full sm:max-w-md" aria-invalid={!!err("gatewayId")}>
            <SelectValue placeholder="Escolha o gateway" />
          </SelectTrigger>
          <SelectContent>
            {gateways.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                <span className={cn("size-2 rounded-full", GATEWAY_STATUS_DOT[g.status])} />
                {g.name}
                <span className="text-xs text-muted-foreground">· {GATEWAY_STATUS_LABEL[g.status]}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {gateway && (
          <FieldDescription className="text-xs">
            Configuração atual v{gateway.configVersion}
            {gateway.ipOt && <> · rede OT {gateway.ipOt}</>}
            {gateway.serialPorts.length > 0 && <> · {gateway.serialPorts.length}× RS-485</>}
          </FieldDescription>
        )}
        <FieldError>{err("gatewayId")}</FieldError>
      </Field>

      {gateway && (
        <>
          <Field>
            <FieldLabel>Protocolo</FieldLabel>
            <RadioGroup
              value={draft.protocol}
              onValueChange={(v) => onChange({ protocol: v as Protocol })}
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            >
              <FieldLabel htmlFor="wz-proto-tcp">
                <Field orientation="horizontal">
                  <EthernetPortIcon className="mt-0.5 size-5 text-muted-foreground" />
                  <FieldContent>
                    <FieldTitle>Modbus TCP/IP</FieldTitle>
                    <FieldDescription className="text-xs">CLP na rede Ethernet OT. Aceita vários clientes (IHM, SCADA, gateway).</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="modbus-tcp" id="wz-proto-tcp" />
                </Field>
              </FieldLabel>
              <FieldLabel htmlFor="wz-proto-rtu" className={cn(gateway.serialPorts.length === 0 && "opacity-50")}>
                <Field orientation="horizontal">
                  <CableIcon className="mt-0.5 size-5 text-muted-foreground" />
                  <FieldContent>
                    <FieldTitle>Modbus RTU · RS-485</FieldTitle>
                    <FieldDescription className="text-xs">
                      {gateway.serialPorts.length === 0
                        ? "Este gateway não tem porta RS-485."
                        : "Barramento serial; vários escravos na mesma porta, cada um com seu unit ID."}
                    </FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="modbus-rtu" id="wz-proto-rtu" disabled={gateway.serialPorts.length === 0} />
                </Field>
              </FieldLabel>
              <FieldLabel htmlFor="wz-proto-rtutcp">
                <Field orientation="horizontal">
                  <NetworkIcon className="mt-0.5 size-5 text-muted-foreground" />
                  <FieldContent>
                    <FieldTitle>Modbus RTU sobre TCP</FieldTitle>
                    <FieldDescription className="text-xs">Escravo RS-485 atrás de um conversor serial↔Ethernet que repassa o quadro RTU sem traduzir.</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="modbus-rtu-over-tcp" id="wz-proto-rtutcp" />
                </Field>
              </FieldLabel>
            </RadioGroup>
          </Field>

          {isTcp ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
              <Field data-invalid={!!err("host")}>
                <FieldLabel htmlFor="wz-host">{draft.protocol === "modbus-rtu-over-tcp" ? "IP do conversor" : "IP do CLP"}</FieldLabel>
                <Input
                  id="wz-host"
                  value={draft.host}
                  onChange={(e) => onChange({ host: e.target.value })}
                  placeholder={gateway.ipOt ? `${gateway.ipOt.split(".").slice(0, 3).join(".")}.25` : "192.168.10.25"}
                  inputMode="decimal"
                  className="font-mono"
                  aria-invalid={!!err("host")}
                />
                <FieldError>{err("host")}</FieldError>
              </Field>
              <Field data-invalid={!!err("port")}>
                <FieldLabel htmlFor="wz-port">Porta</FieldLabel>
                <Input id="wz-port" value={draft.port} onChange={(e) => onChange({ port: e.target.value })} inputMode="numeric" className="font-mono" aria-invalid={!!err("port")} />
                <FieldError>{err("port")}</FieldError>
              </Field>
              <Field data-invalid={!!err("tcpUnitId")}>
                <FieldLabel htmlFor="wz-tcp-uid">{draft.protocol === "modbus-rtu-over-tcp" ? "Endereço do escravo" : "Unit ID"}</FieldLabel>
                <Input id="wz-tcp-uid" value={draft.tcpUnitId} onChange={(e) => onChange({ tcpUnitId: e.target.value })} inputMode="numeric" className="font-mono" aria-invalid={!!err("tcpUnitId")} />
                <FieldError>{err("tcpUnitId")}</FieldError>
              </Field>
              <Field data-invalid={!!err("tcpTimeout")}>
                <FieldLabel htmlFor="wz-tcp-to">Timeout</FieldLabel>
                <InputGroup>
                  <InputGroupInput id="wz-tcp-to" value={draft.tcpTimeout} onChange={(e) => onChange({ tcpTimeout: e.target.value })} inputMode="numeric" className="font-mono" aria-invalid={!!err("tcpTimeout")} />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>ms</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldError>{err("tcpTimeout")}</FieldError>
              </Field>
            </div>
          ) : (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field data-invalid={!!err("serialPort")}>
                  <FieldLabel htmlFor="wz-serial">Porta serial do gateway</FieldLabel>
                  <Select value={draft.serialPort} onValueChange={(v) => onChange({ serialPort: v })}>
                    <SelectTrigger id="wz-serial" className="w-full" aria-invalid={!!err("serialPort")}>
                      <SelectValue placeholder="Escolha a porta" />
                    </SelectTrigger>
                    <SelectContent>
                      {gateway.serialPorts.map((p) => (
                        <SelectItem key={p} value={p}>
                          <span className="font-mono">{p}</span>
                          <span className="text-xs text-muted-foreground">borne {rs485Label(p)}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError>{err("serialPort")}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor="wz-baud">Velocidade</FieldLabel>
                  <Select value={String(draft.baudRate)} onValueChange={(v) => onChange({ baudRate: Number(v) })}>
                    <SelectTrigger id="wz-baud" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BAUD_RATES.map((b) => (
                        <SelectItem key={b} value={String(b)}>
                          {b.toLocaleString("pt-BR")} bps{b === 19200 ? " (padrão Modbus)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field data-invalid={!!err("rtuUnitId")}>
                  <FieldLabel htmlFor="wz-rtu-uid">Unit ID (escravo)</FieldLabel>
                  <Input
                    id="wz-rtu-uid"
                    value={draft.rtuUnitId}
                    onChange={(e) => onChange({ rtuUnitId: e.target.value })}
                    placeholder="1 a 247"
                    inputMode="numeric"
                    className="font-mono"
                    aria-invalid={!!err("rtuUnitId")}
                  />
                  <FieldError>{err("rtuUnitId")}</FieldError>
                </Field>
                <Field>
                  <FieldLabel>Paridade</FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={draft.parity}
                    onValueChange={(v) => v && onChange({ parity: v as ConnDraft["parity"] })}
                    className="w-full"
                  >
                    {(["N", "E", "O"] as const).map((p) => (
                      <ToggleGroupItem key={p} value={p} className="flex-1" aria-label={PARITY_LABEL[p]} title={PARITY_LABEL[p]}>
                        {p}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
                <Field>
                  <FieldLabel>Data bits</FieldLabel>
                  {/* Modbus RTU exige 8 bits de dados (o contrato só aceita 8). */}
                  <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground" title="O Modbus RTU usa sempre 8 bits de dados">
                    8 <span className="ml-1 text-xs">(fixo no Modbus RTU)</span>
                  </div>
                </Field>
                <Field>
                  <FieldLabel>Stop bits</FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={String(draft.stopBits)}
                    onValueChange={(v) => v && onChange({ stopBits: Number(v) as 1 | 2 })}
                    className="w-full"
                  >
                    <ToggleGroupItem value="1" className="flex-1">
                      1
                    </ToggleGroupItem>
                    <ToggleGroupItem value="2" className="flex-1">
                      2
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>
                <Field data-invalid={!!err("rtuTimeout")}>
                  <FieldLabel htmlFor="wz-rtu-to">Timeout</FieldLabel>
                  <InputGroup>
                    <InputGroupInput id="wz-rtu-to" value={draft.rtuTimeout} onChange={(e) => onChange({ rtuTimeout: e.target.value })} inputMode="numeric" className="font-mono" aria-invalid={!!err("rtuTimeout")} />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>ms</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldError>{err("rtuTimeout")}</FieldError>
                </Field>
                <div className="flex items-end sm:col-span-2">
                  <p className="text-xs text-muted-foreground">
                    Formato: <span className="font-mono font-medium text-foreground">{serialSummary(draft)}</span>. Timeout curto (200–500 ms) evita que um escravo desligado atrase o barramento inteiro.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="text-sm font-medium">
                  Escravos em <span className="font-mono">{draft.serialPort || "—"}</span>
                </div>
                {!draft.serialPort ? (
                  <p className="text-xs text-muted-foreground">Escolha a porta para ver os escravos já cadastrados neste barramento.</p>
                ) : busDevices.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum escravo cadastrado. Esta será a primeira estação do barramento.</p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-1.5 text-xs">
                      {busDevices.map((d) => (
                        <li key={d.id} className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1.5">
                          <span className="truncate">{d.name}</span>
                          <span className="shrink-0 font-mono text-muted-foreground">ID {d.unitId}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      Barramento em <span className="font-mono text-foreground">{serialSummary(busDevices[0])}</span>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() =>
                          onChange({
                            baudRate: busDevices[0].baudRate ?? 19200,
                            parity: busDevices[0].parity ?? "E",
                            dataBits: busDevices[0].dataBits ?? 8,
                            stopBits: busDevices[0].stopBits ?? 1,
                          })
                        }
                      >
                        Usar este formato
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {warnings.length > 0 && (
            <Alert className="border-state-stopped/40 bg-state-stopped/5">
              <TriangleAlertIcon className="text-amber-600 dark:text-state-stopped" />
              <AlertTitle>Atenção</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {isTcp ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>Dicas para Modbus TCP</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 text-xs leading-relaxed">
                  <li>O CLP precisa estar na rede OT (porta OT do gateway). Modbus TCP não tem autenticação: nunca exponha na rede IT.</li>
                  <li>Confira o limite de conexões simultâneas do CLP: IHM e SCADA também consomem conexões.</li>
                  <li>Unit ID costuma ser 1 (alguns CLPs usam 255). Em gateways TCP↔RTU, é o endereço do escravo serial.</li>
                </ul>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <InfoIcon />
              <AlertTitle>Boas práticas RS-485</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 text-xs leading-relaxed">
                  <li>
                    <strong>Um único mestre por barramento:</strong> se a IHM já é mestre nesta serial do CLP, o gateway não pode entrar. Use Modbus TCP ou a 2ª porta serial do CLP.
                  </li>
                  <li>
                    <strong>Terminação de 120 Ω só nas duas pontas</strong> do barramento e um único par de resistores de polarização (no gateway).
                  </li>
                  <li>Ligação em cascata (sem estrela), par trançado blindado + condutor de comum (0 V), malha aterrada em um só ponto.</li>
                  <li>Todos os escravos com a mesma velocidade e formato; endereços de 1 a 247.</li>
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-md",
                  testValid ? "bg-state-running/12 text-state-running" : "bg-muted text-muted-foreground",
                )}
              >
                {testValid ? <CheckCircle2Icon className="size-5" /> : <PlugZapIcon className="size-5" />}
              </div>
              <div className="text-sm">
                <div className="font-medium">
                  {testValid ? `CLP respondeu em ${test.latencyMs} ms` : test.status === "testing" ? "Testando conexão…" : "Teste de conexão"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {!canTest
                    ? "Disponível quando o gateway estiver online."
                    : testValid
                      ? `Leitura de teste via ${gateway.name}. Parâmetros conferidos.`
                      : test.status === "ok"
                        ? "Os parâmetros mudaram desde o último teste. Teste de novo."
                        : "O gateway abre a conexão e lê 1 registrador para validar endereço e formato."}
                </div>
              </div>
            </div>
            <Button type="button" variant={testValid ? "outline" : "default"} onClick={onTest} disabled={!canTest || !fieldsOk || test.status === "testing"}>
              {test.status === "testing" ? <Spinner /> : <PlugZapIcon />}
              {testValid ? "Testar de novo" : "Testar conexão"}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
