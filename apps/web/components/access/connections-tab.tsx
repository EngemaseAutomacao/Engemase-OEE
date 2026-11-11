"use client"

import { useState } from "react"
import Link from "next/link"
import { CableIcon, CircuitBoardIcon, NetworkIcon, PlugZapIcon, PlusIcon, RouterIcon, TriangleAlertIcon, WifiOffIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { IconCircle, type IconTone } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import type { RunCommand } from "./command-runner"
import type { BusVM, DeviceVM } from "./gateway-detail-data"
import { plural } from "./labels"
import { DeviceStatusChip } from "./status-chip"

const DEVICE_TONE: Record<DeviceVM["status"], IconTone> = { connected: "teal", error: "red", disabled: "slate" }

function Figure({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="min-w-[4.5rem] text-right">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-semibold tabular-nums", alert && "text-state-fault")}>{value}</div>
    </div>
  )
}

function DeviceRow({ d, offline, onTest }: { d: DeviceVM; offline: boolean; onTest: (d: DeviceVM) => Promise<void> }) {
  const [testing, setTesting] = useState(false)
  const test = async () => {
    setTesting(true)
    await onTest(d)
    setTesting(false)
  }
  const tcp = d.protocol === "modbus-tcp"
  return (
    <li className="grid gap-3 py-3.5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <IconCircle icon={tcp ? NetworkIcon : CircuitBoardIcon} tone={DEVICE_TONE[d.status]} soft size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{d.name}</span>
            <DeviceStatusChip status={d.status} />
          </div>
          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
            {tcp ? d.endpoint : `${d.serialPort} · ${d.endpoint.toLowerCase()}`} · unit id {d.unitId} · timeout {d.timeoutMs.toLocaleString("pt-BR")} ms
          </div>
          <div className="text-xs text-muted-foreground">
            {d.machines.length > 0 ? d.machines.join(", ") : "Nenhuma máquina vinculada"} · {plural(d.tagCount, "tag", "tags")}
          </div>
          {d.lastError && (
            <div className="mt-1 flex items-start gap-1.5 text-xs text-state-fault">
              <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
              <span>Último erro: {d.lastError}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 pl-11 md:justify-end md:pl-0">
        <div className="flex items-center gap-4">
          <Figure label="Latência" value={offline || d.latencyMs === null ? "—" : `${d.latencyMs} ms`} />
          <Figure label="Erros/min" value={offline ? "—" : String(d.errors1m)} alert={!offline && d.errors1m > 0} />
        </div>
        <Button variant="outline" size="sm" onClick={test} disabled={testing}>
          {testing ? <Spinner /> : <PlugZapIcon />}
          {testing ? "Testando…" : "Testar conexão"}
        </Button>
      </div>
    </li>
  )
}

/** Desenho do barramento em cascata: gateway (mestre) → escravos → terminação. */
function BusChain({ bus }: { bus: BusVM }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <ol className="relative flex w-max min-w-full items-start gap-6 py-1">
        <span aria-hidden className="absolute top-[22px] right-6 left-6 border-t-2 border-dashed border-border" />
        <li className="relative flex w-20 flex-col items-center text-center">
          <IconCircle icon={RouterIcon} tone="navy" className="ring-4 ring-card" />
          <span className="mt-1.5 text-[11px] font-semibold">Gateway</span>
          <span className="text-[11px] text-muted-foreground">mestre</span>
        </li>
        {bus.devices.map((d) => (
          <li key={d.id} className="relative flex w-20 flex-col items-center text-center">
            <IconCircle icon={CircuitBoardIcon} tone={DEVICE_TONE[d.status]} className="ring-4 ring-card" />
            <span className="mt-1.5 text-[11px] font-semibold tabular-nums">Escravo {d.unitId}</span>
            <span className={cn("text-[11px]", d.status === "error" ? "text-state-fault" : "text-muted-foreground")}>
              {d.status === "error" ? "com erro" : d.status === "disabled" ? "desativado" : `${d.latencyMs ?? "—"} ms`}
            </span>
          </li>
        ))}
        <li className="relative flex w-20 flex-col items-center text-center">
          <span className="flex size-11 items-center justify-center rounded-full border-2 border-dashed bg-card text-[11px] font-semibold text-muted-foreground ring-4 ring-card">
            120 Ω
          </span>
          <span className="mt-1.5 text-[11px] font-semibold">Terminação</span>
          <span className="text-[11px] text-muted-foreground">fim do cabo</span>
        </li>
      </ol>
    </div>
  )
}

/** Aba "Conexões Modbus": TCP e RTU (escravos agrupados por barramento RS-485). */
export function ConnectionsTab({
  tcp,
  buses,
  offline,
  lastSeenAgo,
  ipOt,
  newConnectionHref,
  run,
}: {
  tcp: DeviceVM[]
  buses: BusVM[]
  offline: boolean
  lastSeenAgo: string
  ipOt: string | null
  newConnectionHref: string
  run: RunCommand
}) {
  const rtuCount = buses.reduce((s, b) => s + b.devices.length, 0)

  const onTest = async (d: DeviceVM) => {
    const target = d.protocol === "modbus-tcp" ? `${d.name} · ${d.endpoint}` : `${d.name} · ${d.serialPort} #${d.unitId}`
    const out = await run("device.test", target, () => {
      if (d.status === "error") return { ok: false, result: d.lastError ?? "Falha de comunicação", durationMs: d.timeoutMs }
      if (d.status === "disabled") return { ok: false, result: "Conexão desativada na configuração", durationMs: 4 }
      const ms = (d.latencyMs ?? 20) + 3
      return { ok: true, result: `Conectado · unit id ${d.unitId} respondeu em ${ms} ms`, durationMs: ms }
    })
    if (!out) return
    if (out.ok) toast.success(`${d.name}: conexão OK`, { description: out.result })
    else toast.error(`${d.name}: falha no teste`, { description: out.result })
  }

  const newConnection = (
    <Button asChild variant="outline" size="sm" className="shrink-0">
      <Link href={newConnectionHref}>
        <PlusIcon />
        Nova conexão
      </Link>
    </Button>
  )

  if (tcp.length === 0 && rtuCount === 0) {
    return (
      <Empty className="rounded-2xl border border-dashed bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CableIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhuma conexão de CLP</EmptyTitle>
          <EmptyDescription>Cadastre a primeira conexão Modbus TCP ou um escravo Modbus RTU (RS-485) pelo assistente de nova máquina.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>{newConnection}</EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {offline && (
        <Alert className="rounded-2xl">
          <WifiOffIcon />
          <AlertTitle>Gateway offline</AlertTitle>
          <AlertDescription>Estado das conexões conforme o último contato ({lastSeenAgo}). Testes ficam na fila até o gateway voltar a sincronizar.</AlertDescription>
        </Alert>
      )}

      <SectionCard
        title="Modbus TCP/IP"
        description={tcp.length > 0 ? `${plural(tcp.length, "conexão", "conexões")} na rede OT${ipOt ? ` · gateway em ${ipOt}` : ""}` : "Nenhuma conexão TCP"}
        action={newConnection}
      >
        {tcp.length > 0 ? (
          <ul className="divide-y">
            {tcp.map((d) => (
              <DeviceRow key={d.id} d={d} offline={offline} onTest={onTest} />
            ))}
          </ul>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">Os CLPs deste gateway estão todos em RS-485.</p>
        )}
      </SectionCard>

      <SectionCard
        title="Modbus RTU · RS-485"
        description={rtuCount > 0 ? `${plural(rtuCount, "escravo", "escravos")} em ${plural(buses.filter((b) => b.devices.length > 0).length, "barramento", "barramentos")}` : "Nenhum escravo cadastrado"}
      >
        {buses.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Este gateway não tem portas RS-485.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {buses.map((b) =>
              b.devices.length === 0 ? (
                <div key={b.port} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-medium">{b.port}</div>
                    <div className="text-xs text-muted-foreground">Porta livre · nenhum escravo cadastrado</div>
                  </div>
                  <span className="text-xs text-muted-foreground">Até ~10 escravos a 19200 bps</span>
                </div>
              ) : (
                <div key={b.port} className="flex flex-col gap-3 rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">
                        Barramento <span className="font-mono">{b.port}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {b.serial} · {plural(b.devices.length, "escravo", "escravos")} · varredura ≈ {b.cycleMs.toLocaleString("pt-BR")} ms
                      </div>
                    </div>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Gateway é o único mestre</span>
                  </div>
                  <BusChain bus={b} />
                  {b.devices.some((d) => d.status === "error") && (
                    <p className="flex items-start gap-1.5 rounded-lg bg-state-stopped/12 px-2.5 py-1.5 text-xs text-amber-800 dark:text-state-stopped">
                      <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
                      Escravo com erro consome o timeout inteiro a cada varredura. Verifique terminação de 120 Ω, fio de comum (0 V) e paridade iguais em todo o barramento.
                    </p>
                  )}
                  <ul className="divide-y border-t pt-3">
                    {b.devices.map((d) => (
                      <DeviceRow key={d.id} d={d} offline={offline} onTest={onTest} />
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
