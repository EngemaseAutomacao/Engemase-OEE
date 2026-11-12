"use client"

import { useState } from "react"
import Link from "next/link"
import {
  ActivityIcon,
  ArrowLeftIcon,
  CableIcon,
  CpuIcon,
  FileCogIcon,
  HeartPulseIcon,
  InboxIcon,
  KeyRoundIcon,
  PowerIcon,
  RefreshCwIcon,
  RouterIcon,
  TagsIcon,
  TerminalSquareIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { StatCard } from "@/components/dashboard/stat-card"
import { EngemaseManagedNote, EngemaseOnlyChip, useCanEdit } from "@/components/config/engemase-managed"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ActivationPanel } from "./activation-panel"
import { useCommandRunner } from "./command-runner"
import { CommandsTab } from "./commands-tab"
import { ConfigTab } from "./config-tab"
import { ConnectionsTab } from "./connections-tab"
import { IssueList, STATUS_TONE } from "./gateway-card"
import type { ConfigVersionVM, GatewayDetail } from "./gateway-detail-data"
import type { GatewayIssue } from "./gateway-view"
import { HealthTab } from "./health-tab"
import { plural } from "./labels"
import { RemoteAccessTab } from "./remote-access-tab"
import { GatewayStatusChip } from "./status-chip"
import { TagsTab } from "./tags-tab"

const TRIGGER =
  "h-8 flex-none rounded-lg px-3 text-[13px] data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-primary/15 dark:data-[state=active]:text-primary"

function TabCount({ n }: { n: number }) {
  return <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">{n}</span>
}

/** Detalhe do gateway: cabeçalho de status, KPIs e abas (ou o fluxo de ativação, se pendente). */
export function GatewayDetailView({ data, nowLabel }: { data: GatewayDetail; nowLabel: string }) {
  const offline = data.status === "offline"
  const pending = data.status === "pending"
  const base = `/${data.clientSlug}`
  const me = data.remote.me.name

  const { commands, run } = useCommandRunner({ initial: data.commands, offline, me, nowLabel })
  const [published, setPublished] = useState(data.configVersion)
  const [applied, setApplied] = useState(data.configApplied)
  const [versions, setVersions] = useState<ConfigVersionVM[]>(data.configVersions)
  const [reloading, setReloading] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [tab, setTab] = useState("conexoes")
  const canEdit = useCanEdit()

  const reload = async (target: number) => {
    setReloading(true)
    const out = await run("config.reload", `Recarregar configuração · ${data.hostname}`, () => ({
      ok: true,
      result: `Configuração v${target} aplicada`,
      durationMs: 1240,
    }))
    setReloading(false)
    if (!out) return
    setApplied(target)
    toast.success(`Configuração v${target} aplicada`, { description: `${data.name} baixou, validou e confirmou a nova versão.` })
  }

  const revert = (v: number) => {
    const next = published + 1
    const undone = published > v ? `desfaz ${published - v === 1 ? `a v${published}` : `as versões v${v + 1} a v${published}`}` : "republica o conteúdo"
    setVersions((vs) => [
      {
        version: next,
        publishedLabel: nowLabel,
        publishedAgo: "agora",
        author: me,
        summary: `Reversão para a v${v}`,
        changes: [{ kind: "change", text: `Conteúdo da v${v} restaurado (${undone})` }],
        revertOf: v,
      },
      ...vs,
    ])
    setPublished(next)
    toast.success(`v${next} publicada`, { description: `Mesmo conteúdo da v${v}. Registrado na auditoria.` })
    void reload(next)
  }

  const restart = async () => {
    setRestarting(true)
    const out = await run("agent.restart", `Reiniciar agente · ${data.hostname}`, () => ({
      ok: true,
      result: "Serviço reiniciado; primeiro sincronismo em 8 s",
      durationMs: 7900,
    }))
    setRestarting(false)
    if (out) toast.success("Agente reiniciado", { description: "A coleta voltou em 8 s. As leituras do intervalo ficaram no buffer local." })
  }

  // Pendência de configuração recalculada no cliente (muda com recarregar/reverter).
  const issues: GatewayIssue[] = [
    ...data.issues.filter((i) => i.kind !== "config"),
    ...(applied !== null && applied < published
      ? [{ kind: "config" as const, tone: "warn" as const, text: `Configuração v${published} publicada e ainda não aplicada (em uso: v${applied})` }]
      : []),
  ]

  const connected = data.devices.filter((d) => d.status === "connected").length
  const deviceErrors = data.devices.filter((d) => d.status === "error").length
  const hasActive = data.remote.sessions.some((s) => s.status === "active")
  const hasRequest = data.remote.sessions.some((s) => s.status === "requested")

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <Link href={`${base}/config/gateways`} className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary">
        <ArrowLeftIcon className="size-3.5" />
        Gateways
      </Link>
      <EngemaseManagedNote clientSlug={data.clientSlug} subject="Gateway, conexões com os CLPs, tags e publicação de configuração" />

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <IconCircle icon={RouterIcon} tone={STATUS_TONE[data.status]} soft size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
              <GatewayStatusChip status={data.status} />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data.hostname !== "—" && <span className="font-mono">{data.hostname} · </span>}
              {data.unitName} · {data.hardware}
            </p>
          </div>
        </div>
        {!pending && canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <EngemaseOnlyChip className="h-8 px-2.5" />
            <Button variant="outline" size="sm" onClick={() => reload(published)} disabled={reloading}>
              {reloading ? <Spinner /> : <RefreshCwIcon />}
              Recarregar configuração
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={restarting}>
                  {restarting ? <Spinner /> : <PowerIcon />}
                  Reiniciar agente
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reiniciar o agente do {data.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A coleta pausa por cerca de 10 s. As leituras desse intervalo ficam no buffer local e nenhum dado se perde. Use quando o suporte pedir.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={restart}>Reiniciar agente</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {pending && data.activation && !canEdit ? (
        <section className="rounded-2xl border border-dashed bg-card px-5 py-6 text-sm">
          <h2 className="text-[15px] font-semibold">Aguardando ativação pela Engemase</h2>
          <p className="mt-1 text-muted-foreground">
            A equipe Engemase instala o gateway no quadro da planta e faz a ativação. Depois disso, a saúde, as conexões e as tags aparecem aqui.
            {data.machines.length > 0 && ` Máquinas previstas: ${data.machines.map((m) => m.name).join(", ")}.`}
          </p>
        </section>
      ) : pending && data.activation ? (
        <ActivationPanel
          name={data.name}
          activation={data.activation}
          machines={data.machines}
          machineHref={(id) => `${base}/maquinas/${id}`}
          machinesHref={`${base}/config/maquinas`}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={ActivityIcon}
              tone="teal"
              label="Último contato"
              value={<span className={cn(offline && "text-state-fault")}>{data.lastSeenAgo}</span>}
              hint={offline ? `Em ${data.lastSeenLabel ?? "—"} · sem sincronismo` : `Ligado há ${data.uptime ?? "—"} · agente v${data.agentVersion ?? "—"}`}
            />
            <StatCard
              icon={FileCogIcon}
              tone="navy"
              label="Configuração aplicada"
              value={
                <>
                  {applied !== null ? `v${applied}` : "—"}
                  {applied !== published && <span className="text-base font-semibold text-muted-foreground"> / v{published}</span>}
                </>
              }
              hint={applied !== null && applied >= published ? "Igual à publicada" : `v${published} publicada, pendente`}
            />
            <StatCard
              icon={InboxIcon}
              tone="orange"
              label="Fila do buffer"
              value={data.bufferPending.toLocaleString("pt-BR")}
              hint={offline ? "Leituras guardadas no gateway" : data.bufferPending > 20 ? "Acima do normal (rede lenta?)" : "Leituras aguardando envio"}
            />
            <StatCard
              icon={CpuIcon}
              tone="blue"
              label="CLPs conectados"
              value={
                <>
                  {connected}
                  <span className="text-base font-semibold text-muted-foreground"> / {data.devices.length}</span>
                </>
              }
              hint={`${deviceErrors > 0 ? `${deviceErrors} com erro · ` : ""}${plural(data.machines.length, "máquina", "máquinas")} · ${plural(data.tags.length, "tag", "tags")}`}
            />
          </div>

          {issues.length > 0 && (
            <section className="rounded-2xl border bg-card px-5 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <h2 className="mb-2.5 text-[15px] font-semibold">Pendências</h2>
              <IssueList issues={issues} />
            </section>
          )}

          <Tabs value={tab} onValueChange={setTab} className="gap-4">
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList className="h-10 w-max rounded-xl border bg-card p-1 shadow-xs">
                <TabsTrigger value="conexoes" className={TRIGGER}>
                  <CableIcon />
                  Conexões Modbus
                  <TabCount n={data.devices.length} />
                </TabsTrigger>
                <TabsTrigger value="tags" className={TRIGGER}>
                  <TagsIcon />
                  Tags
                  <TabCount n={data.tags.length} />
                </TabsTrigger>
                <TabsTrigger value="config" className={TRIGGER}>
                  <FileCogIcon />
                  Configuração
                  {applied !== null && applied < published && <span className="size-2 rounded-full bg-state-stopped" aria-label="pendente" />}
                </TabsTrigger>
                <TabsTrigger value="comandos" className={TRIGGER}>
                  <TerminalSquareIcon />
                  Comandos
                  <TabCount n={commands.length} />
                </TabsTrigger>
                <TabsTrigger value="saude" className={TRIGGER}>
                  <HeartPulseIcon />
                  Saúde
                </TabsTrigger>
                <TabsTrigger value="acesso" className={TRIGGER}>
                  <KeyRoundIcon />
                  Acesso remoto
                  {(hasActive || hasRequest) && (
                    <span
                      className={cn("size-2 rounded-full", hasActive ? "bg-state-running" : "bg-state-stopped")}
                      aria-label={hasActive ? "sessão ativa" : "pedido pendente"}
                    />
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="conexoes">
              <ConnectionsTab
                tcp={data.tcpDevices}
                buses={data.buses}
                offline={offline}
                lastSeenAgo={data.lastSeenAgo}
                ipOt={data.ipOt}
                newConnectionHref={`${base}/config/maquinas/nova`}
                run={run}
              />
            </TabsContent>
            <TabsContent value="tags" forceMount className="data-[state=inactive]:hidden">
              <TagsTab tags={data.tags} devices={data.devices} run={run} />
            </TabsContent>
            <TabsContent value="config">
              <ConfigTab
                versions={versions}
                published={published}
                applied={applied}
                offline={offline}
                reloading={reloading}
                onReload={() => reload(published)}
                onRevert={revert}
              />
            </TabsContent>
            <TabsContent value="comandos">
              <CommandsTab commands={commands} />
            </TabsContent>
            <TabsContent value="saude">
              <HealthTab
                health={data.health}
                info={{
                  hardware: data.hardware,
                  hostname: data.hostname,
                  ipIt: data.ipIt,
                  ipOt: data.ipOt,
                  agentVersion: data.agentVersion,
                  agentOutdated: data.agentOutdated,
                  latestAgent: data.latestAgent,
                  uptime: data.uptime,
                  clockText: data.clockText,
                  clockAlert: data.clockAlert,
                  diskFreePct: data.diskFreePct,
                  offline,
                  lastSeenAgo: data.lastSeenAgo,
                }}
              />
            </TabsContent>
            <TabsContent value="acesso" forceMount className="data-[state=inactive]:hidden">
              <RemoteAccessTab remote={data.remote} gatewayName={data.name} hostname={data.hostname} offline={offline} nowLabel={nowLabel} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
