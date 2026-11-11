"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { CircleCheckIcon, FlaskConicalIcon, PauseIcon, PlayIcon, RocketIcon, ShieldCheckIcon, SkipForwardIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { IconCircle } from "@/components/dashboard/icon-circle"
import { SectionCard } from "@/components/dashboard/section-card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { SoftBadge } from "./bits"
import { useFleet } from "./fleet-context"
import type { AgentChannel, FleetRow } from "./fleet-data"
import { GATEWAY_TONE, compareVersions } from "./labels"

type Strategy = "gradual" | "pilot" | "all"
type Interval = "1h" | "6h" | "24h"

const STRATEGY: Record<Strategy, { label: string; hint: string }> = {
  gradual: { label: "Gradual em ondas", hint: "10% → 50% → 100% da seleção, avançando só se a onda anterior sincronizar bem" },
  pilot: { label: "Piloto primeiro", hint: "1 gateway online recebe antes; o restante vai depois da janela de observação" },
  all: { label: "Todos de uma vez", hint: "Use só para correções urgentes; o rollback automático continua valendo" },
}
const INTERVAL_LABEL: Record<Interval, string> = { "1h": "1 hora", "6h": "6 horas", "24h": "24 horas" }

interface Wave {
  label: string
  ids: string[]
}
type WaveStatus = "done" | "running" | "waiting"
interface Rollout {
  version: string
  channel: AgentChannel
  waves: Wave[]
  current: number
  paused: boolean
  interval: Interval
}

function buildWaves(list: FleetRow[], strategy: Strategy): Wave[] {
  const n = list.length
  if (n === 0) return []
  const ids = list.map((r) => r.id)
  if (strategy === "all") return [{ label: "Onda única · 100%", ids }]
  if (strategy === "pilot") {
    return [
      { label: "Piloto", ids: ids.slice(0, 1) },
      { label: "Restante", ids: ids.slice(1) },
    ].filter((w) => w.ids.length > 0)
  }
  const cuts = [Math.max(1, Math.ceil(n * 0.1)), Math.max(1, Math.ceil(n * 0.5)), n]
  const waves: Wave[] = []
  let from = 0
  for (const to of cuts) {
    if (to > from) {
      waves.push({ label: `Onda ${waves.length + 1} · ${Math.round((to / n) * 100)}%`, ids: ids.slice(from, to) })
      from = to
    }
  }
  return waves
}

/** Seção "Atualização do agente (OTA)": canais, distribuição de versões e rollout gradual. */
export function OtaPanel() {
  const { rows, releases, clients, latest, schedule, unschedule } = useFleet()
  const [channel, setChannel] = useState<AgentChannel>("stable")
  const [version, setVersion] = useState(latest)
  const [target, setTarget] = useState("outdated")
  const [strategy, setStrategy] = useState<Strategy>("gradual")
  const [interval, setWaveInterval] = useState<Interval>("6h")
  const [offHours, setOffHours] = useState(true)
  const [autoPause, setAutoPause] = useState(true)
  const [rollout, setRollout] = useState<Rollout | null>(null)

  const stable = releases.find((r) => r.channel === "stable" && r.version === latest)
  const beta = releases.find((r) => r.channel === "beta")
  const channelReleases = releases.filter((r) => r.channel === channel)
  const activated = useMemo(() => rows.filter((r) => r.agentVersion), [rows])
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])

  const distribution = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) map.set(r.agentVersion ?? "—", (map.get(r.agentVersion ?? "—") ?? 0) + 1)
    return [...map.entries()]
      .map(([v, count]) => {
        const sample = rows.find((r) => (r.agentVersion ?? "—") === v)!
        return { version: v, count, state: sample.versionState }
      })
      .sort((a, b) => (a.version === "—" ? 1 : b.version === "—" ? -1 : compareVersions(b.version, a.version)))
  }, [rows])

  const eligible = useMemo(() => {
    const list = activated.filter((r) => compareVersions(r.agentVersion!, version) < 0)
    const scoped =
      target === "outdated"
        ? list.filter((r) => r.versionState === "outdated" || r.versionState === "unsupported")
        : target.startsWith("client:")
          ? list.filter((r) => r.clientId === target.slice(7))
          : list
    // online primeiro (melhor candidato a piloto), depois por cliente
    const rank = (r: FleetRow) => (r.status === "online" ? 0 : r.status === "degraded" ? 1 : 2)
    return [...scoped].sort((a, b) => rank(a) - rank(b) || a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name))
  }, [activated, version, target])

  const waves = buildWaves(eligible, strategy)
  const offline = eligible.filter((r) => r.status === "offline").length

  const changeChannel = (c: AgentChannel) => {
    setChannel(c)
    const first = releases.find((r) => r.channel === c)
    if (first) setVersion(first.version)
    setTarget(c === "beta" ? "all" : "outdated")
    setStrategy(c === "beta" ? "pilot" : "gradual")
  }

  const start = () => {
    if (waves.length === 0) return
    const ids = waves.flatMap((w) => w.ids)
    schedule(ids, version)
    setRollout({ version, channel, waves, current: 0, paused: false, interval })
    const first = waves[0]!.ids.map((id) => byId.get(id)?.hostname ?? id).join(", ")
    toast.success(`Rollout da ${version} iniciado`, {
      description: `${waves[0]!.label}: ${first}. ${waves.length > 1 ? `Próxima onda em ${INTERVAL_LABEL[interval]}, se não houver falha.` : "Rollback automático se algum gateway não sincronizar em 5 min."}`,
    })
  }

  const statusOf = (i: number): WaveStatus => (!rollout ? "waiting" : i < rollout.current ? "done" : i === rollout.current ? "running" : "waiting")

  const advance = () => {
    if (!rollout) return
    const next = rollout.current + 1
    if (next >= rollout.waves.length) {
      toast.success(`Rollout da ${rollout.version} concluído`, { description: "Todos os gateways da seleção receberam o comando de atualização." })
      setRollout({ ...rollout, current: rollout.waves.length })
      return
    }
    setRollout({ ...rollout, current: next, paused: false })
    toast(`${rollout.waves[next]!.label} liberada`, { description: `${rollout.waves[next]!.ids.length} gateway(s) recebem agent.update no próximo /sync.` })
  }

  const togglePause = () => {
    if (!rollout) return
    setRollout({ ...rollout, paused: !rollout.paused })
    toast(rollout.paused ? "Rollout retomado" : "Rollout pausado", {
      description: rollout.paused ? "As próximas ondas seguem o intervalo configurado." : "Gateways que já atualizaram continuam na nova versão; os demais aguardam.",
    })
  }

  const cancel = () => {
    if (!rollout) return
    const pending = rollout.waves.slice(rollout.current).flatMap((w) => w.ids)
    unschedule(pending)
    setRollout(null)
    toast("Rollout cancelado", { description: `${pending.length} gateway(s) deixaram de receber a ${rollout.version}.` })
  }

  const finished = rollout !== null && rollout.current >= rollout.waves.length

  return (
    <SectionCard
      title="Atualização do agente (OTA)"
      description="Pacote .deb assinado (Ed25519) baixado pelo gateway · rollback automático se não houver /sync em até 5 min"
    >
      <div className="grid gap-5 xl:grid-cols-12">
        {/* Canais e distribuição */}
        <div className="flex flex-col gap-3 xl:col-span-5">
          {stable && (
            <ChannelCard
              icon={ShieldCheckIcon}
              tone="teal"
              name="Canal stable"
              version={stable.version}
              published={stable.publishedLabel}
              notes={stable.notes}
              count={activated.filter((r) => r.agentVersion === stable.version).length}
              total={activated.length}
              caption="gateways ativados nesta versão"
            />
          )}
          {beta && (
            <ChannelCard
              icon={FlaskConicalIcon}
              tone="violet"
              name="Canal beta"
              version={beta.version}
              published={beta.publishedLabel}
              notes={beta.notes}
              count={activated.filter((r) => r.agentVersion === beta.version).length}
              total={activated.length}
              caption="gateways no beta · indicado para o Engemase Lab e pilotos"
            />
          )}
          <div className="rounded-xl bg-muted/60 p-3">
            <div className="mb-2 text-xs font-semibold">Versões em campo</div>
            <ul className="grid gap-2">
              {distribution.map((d) => {
                const color = { current: "bg-[#0e9384]", outdated: "bg-state-stopped", unsupported: "bg-state-fault", none: "bg-state-nocomm" }[d.state]
                return (
                  <li key={d.version} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-xs">
                    <span className="truncate font-mono font-medium">{d.version === "—" ? "não ativado" : d.version}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-background">
                      <span className={cn("block h-full rounded-full", color)} style={{ width: `${(d.count / Math.max(1, rows.length)) * 100}%` }} />
                    </span>
                    <span className="w-24 text-right">
                      <span className="font-semibold tabular-nums">{d.count}</span>{" "}
                      <span className="text-muted-foreground">
                        {d.state === "current" ? "atual" : d.state === "outdated" ? "desatualiz." : d.state === "unsupported" ? "sem suporte" : "pendente"}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {/* Novo rollout */}
        <div className="flex flex-col gap-4 rounded-xl border p-4 xl:col-span-7">
          <div className="flex items-center gap-3">
            <IconCircle icon={RocketIcon} tone="blue" soft size="sm" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">Novo rollout</div>
              <div className="text-xs text-muted-foreground">Defina canal, versão-alvo e a seleção de gateways</div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">Canal</Label>
              <div role="radiogroup" aria-label="Canal" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                {(["stable", "beta"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={channel === c}
                    onClick={() => changeChannel(c)}
                    className={cn(
                      "h-7 rounded-md text-xs font-semibold transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      channel === c ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ota-version" className="text-xs">
                Versão-alvo
              </Label>
              <Select value={version} onValueChange={setVersion}>
                <SelectTrigger id="ota-version" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {channelReleases.map((r) => (
                    <SelectItem key={r.version} value={r.version} disabled={r.version !== latest && r.channel === "stable" && compareVersions(r.version, latest) < 0}>
                      {r.version} · {r.publishedLabel}
                      {r.channel === "stable" && r.version !== latest ? " (anterior)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="ota-target" className="text-xs">
                Gateways
              </Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger id="ota-target" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="outdated">Só os desatualizados</SelectItem>
                  <SelectItem value="all">Todos os gateways ativados</SelectItem>
                  {clients
                    .filter((c) => activated.some((r) => r.clientId === c.id))
                    .map((c) => (
                      <SelectItem key={c.id} value={`client:${c.id}`}>
                        Cliente: {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Estratégia</Label>
            <RadioGroup value={strategy} onValueChange={(v) => setStrategy(v as Strategy)} className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(STRATEGY) as Strategy[]).map((s) => (
                <label
                  key={s}
                  htmlFor={`ota-strategy-${s}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors",
                    strategy === s ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <RadioGroupItem id={`ota-strategy-${s}`} value={s} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">{STRATEGY[s].label}</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">{STRATEGY[s].hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ota-interval" className="text-xs">
                Observação entre ondas
              </Label>
              <Select value={interval} onValueChange={(v) => setWaveInterval(v as Interval)} disabled={strategy === "all"}>
                <SelectTrigger id="ota-interval" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(INTERVAL_LABEL) as Interval[]).map((i) => (
                    <SelectItem key={i} value={i}>
                      {INTERVAL_LABEL[i]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid content-end gap-2">
              <label className="flex items-center justify-between gap-3 text-xs">
                <span>Só fora do horário de produção</span>
                <Switch size="sm" checked={offHours} onCheckedChange={setOffHours} aria-label="Só fora do horário de produção" />
              </label>
              <label className="flex items-center justify-between gap-3 text-xs">
                <span>Pausar se uma onda falhar</span>
                <Switch size="sm" checked={autoPause} onCheckedChange={setAutoPause} aria-label="Pausar se uma onda falhar" />
              </label>
            </div>
          </div>

          {/* Prévia das ondas */}
          <div className="rounded-xl bg-muted/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold">Prévia · {eligible.length} gateway(s)</span>
              {offline > 0 && <span className="text-muted-foreground">{offline} offline: atualiza quando voltar a sincronizar</span>}
            </div>
            {waves.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum gateway abaixo da {version} nesta seleção.</p>
            ) : (
              <ol className="grid gap-2">
                {waves.map((w) => (
                  <li key={w.label} className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="w-28 shrink-0 font-medium">{w.label}</span>
                    {w.ids.map((id) => {
                      const r = byId.get(id)
                      return r ? (
                        <SoftBadge key={id} tone={GATEWAY_TONE[r.status]} dot title={`${r.name} · ${r.clientName}`}>
                          <span className="font-mono">{r.hostname}</span>
                        </SoftBadge>
                      ) : null
                    })}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-muted-foreground">
              {offHours ? "Respeita os turnos de cada unidade. " : ""}
              {autoPause ? "Falha em qualquer gateway pausa as próximas ondas." : "Sem pausa automática."}
            </p>
            <Button onClick={start} disabled={waves.length === 0 || (rollout !== null && !finished)}>
              <RocketIcon />
              Iniciar rollout
            </Button>
          </div>

          {rollout && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  Rollout {rollout.version} <span className="text-xs font-normal text-muted-foreground">· canal {rollout.channel}</span>
                </div>
                {finished ? (
                  <SoftBadge tone="green" icon={CircleCheckIcon}>
                    Concluído
                  </SoftBadge>
                ) : rollout.paused ? (
                  <SoftBadge tone="amber" icon={PauseIcon}>
                    Pausado
                  </SoftBadge>
                ) : (
                  <SoftBadge tone="blue" dot>
                    Em andamento
                  </SoftBadge>
                )}
              </div>
              <ol className="grid gap-1.5">
                {rollout.waves.map((w, i) => {
                  const st = statusOf(i)
                  return (
                    <li key={w.label} className="flex items-center gap-2 text-xs">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          st === "done" ? "bg-state-running" : st === "running" ? (rollout.paused ? "bg-state-stopped" : "animate-pulse bg-primary") : "bg-state-nocomm",
                        )}
                        aria-hidden
                      />
                      <span className="w-28 shrink-0 font-medium">{w.label}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{w.ids.map((id) => byId.get(id)?.hostname ?? id).join(", ")}</span>
                      <span className="shrink-0 text-muted-foreground">{st === "done" ? "concluída" : st === "running" ? "em andamento" : "aguardando"}</span>
                    </li>
                  )
                })}
              </ol>
              {!finished && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={advance} disabled={rollout.paused}>
                    <SkipForwardIcon />
                    {rollout.current + 1 >= rollout.waves.length ? "Concluir" : "Liberar próxima onda"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={togglePause}>
                    {rollout.paused ? <PlayIcon /> : <PauseIcon />}
                    {rollout.paused ? "Retomar" : "Pausar"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancel} className="text-state-fault hover:text-state-fault">
                    <XIcon />
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  )
}

function ChannelCard({
  icon,
  tone,
  name,
  version,
  published,
  notes,
  count,
  total,
  caption,
}: {
  icon: typeof ShieldCheckIcon
  tone: "teal" | "violet"
  name: string
  version: string
  published: string
  notes: string[]
  count: number
  total: number
  caption: string
}) {
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center gap-3">
        <IconCircle icon={icon} tone={tone} soft size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{name}</div>
          <div className="font-mono text-base leading-tight font-bold">{version}</div>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">publicada {published}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-2 text-xs">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <span className={cn("block h-full rounded-full", tone === "teal" ? "bg-[#0e9384]" : "bg-state-setup")} style={{ width: `${(count / Math.max(1, total)) * 100}%` }} />
        </span>
        <span className="shrink-0 font-semibold tabular-nums">
          {count}/{total}
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{caption}</div>
      {notes.length > 0 && (
        <ul className="mt-2 grid list-disc gap-0.5 pl-4 text-[11px] text-muted-foreground">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
