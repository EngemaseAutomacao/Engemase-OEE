/**
 * Dados DERIVADOS e determinísticos do detalhe do gateway que ainda não existem em `@/lib/mock`:
 * histórico de versões de configuração, histórico de comandos e séries de saúde.
 * Gerados a partir dos cadastros do mock com `seededRandom` e `MOCK_NOW` (seguro em servidor).
 * Quando a camada real existir, isto vira consulta a `config_version`, `gateway_command` e `gateway_health`.
 */
import { MOCK_NOW, nowMs, seededRandom, type Device, type Gateway, type Machine, type Tag } from "@/lib/mock"
import { COMMAND_TYPE_LABEL, type CommandStatus, type CommandType, formatTagValue, modbusRef, pollLabel } from "./labels"

const MIN = 60_000
const HOUR = 60 * MIN
const iso = (ms: number) => new Date(ms).toISOString()

// ---------------------------------------------------------------------------
// Versões de configuração
// ---------------------------------------------------------------------------

export interface ConfigChange {
  kind: "add" | "change" | "remove"
  text: string
}

export interface ConfigVersion {
  version: number
  publishedAt: string
  author: string
  /** Resumo em uma linha ("+2 tags · 1 conexão alterada"). */
  summary: string
  changes: ConfigChange[]
  /** Versão criada por "reverter". */
  revertOf?: number
}

function summarize(changes: ConfigChange[]): string {
  const add = changes.filter((c) => c.kind === "add").length
  const chg = changes.filter((c) => c.kind === "change").length
  const rem = changes.filter((c) => c.kind === "remove").length
  const parts: string[] = []
  if (add) parts.push(`${add} ${add === 1 ? "inclusão" : "inclusões"}`)
  if (chg) parts.push(`${chg} ${chg === 1 ? "alteração" : "alterações"}`)
  if (rem) parts.push(`${rem} ${rem === 1 ? "remoção" : "remoções"}`)
  return parts.join(" · ") || "Sem alterações"
}

export function configHistory(
  gateway: Gateway,
  devices: Device[],
  tags: Tag[],
  machines: Machine[],
  authors: string[],
  /** Última publicação conhecida (ex.: da auditoria), para manter as telas coerentes. */
  latest?: { author: string; at: string; details?: string },
): ConfigVersion[] {
  const rnd = seededRandom(`${gateway.id}:config`)
  const machineName = (id: string) => machines.find((m) => m.id === id)?.name ?? "Máquina"
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]!
  const who = authors.length > 0 ? authors : ["Equipe Engemase"]

  if (gateway.configVersion <= 1 || devices.length === 0) {
    return [
      {
        version: gateway.configVersion,
        publishedAt: iso(nowMs() - 7 * 24 * HOUR),
        author: who[0]!,
        summary: "Configuração inicial",
        changes: [
          { kind: "add", text: `Gateway "${gateway.name}" criado com intervalo de sincronização de 10 s` },
          { kind: "add", text: "Nenhuma conexão de CLP cadastrada ainda" },
        ],
      },
    ]
  }

  // Mudanças plausíveis a partir das conexões e tags reais do gateway (só as aplicáveis ao que existe).
  const tagTemplates: (() => ConfigChange)[] = [
    () => {
      const t = pick(tags)
      return { kind: "change", text: `${machineName(t.machineId)} · ${t.name}: intervalo de leitura ${pollLabel(t.pollMs * 2)} → ${pollLabel(t.pollMs)}` }
    },
    () => {
      const t = pick(tags.filter((x) => x.dataType.endsWith("32")).length ? tags.filter((x) => x.dataType.endsWith("32")) : tags)
      return { kind: "change", text: `${machineName(t.machineId)} · ${t.name}: ordem das words ABCD → ${t.byteOrder}` }
    },
    () => {
      const t = pick(tags)
      return { kind: "add", text: `${machineName(t.machineId)} · tag "${t.name}" (${modbusRef(t.area, t.address)})` }
    },
    () => {
      const t = pick(tags)
      return { kind: "remove", text: `${machineName(t.machineId)} · tag "Temperatura do óleo (°C)" (não usada no OEE)` }
    },
  ]
  const deviceTemplates: (() => ConfigChange)[] = [
    () => {
      const d = pick(devices)
      return { kind: "change", text: `${d.name}: timeout ${d.params.timeoutMs * 2} ms → ${d.params.timeoutMs} ms` }
    },
    () => {
      const d = pick(devices)
      return d.protocol === "modbus-tcp"
        ? { kind: "add", text: `Conexão "${d.name}" (${d.params.host}:${d.params.port}, unit id ${d.params.unitId})` }
        : { kind: "add", text: `Escravo "${d.name}" no barramento ${d.params.serialPort} (unit id ${d.params.unitId})` }
    },
  ]
  const templates = tags.length > 0 ? [...tagTemplates, ...deviceTemplates] : deviceTemplates

  const count = Math.min(gateway.configVersion, 6)
  const versions: ConfigVersion[] = []
  let at = latest ? Date.parse(latest.at) : gateway.status === "offline" && gateway.lastSeen ? Date.parse(gateway.lastSeen) - 2 * HOUR : nowMs() - 44 * MIN
  for (let i = 0; i < count; i++) {
    const version = gateway.configVersion - i
    const n = 1 + Math.floor(rnd() * 3)
    const named = i === 0 && latest?.details ? machines.find((m) => latest.details!.includes(m.name)) : undefined
    const namedTags = named ? tags.filter((t) => t.machineId === named.id) : []
    const changes: ConfigChange[] =
      namedTags.length >= 2
        ? [
            { kind: "change", text: `${named!.name} · ${namedTags[3]?.name ?? namedTags[0]!.name}: ordem das words ABCD → CDAB` },
            { kind: "change", text: `${named!.name} · ${namedTags[1]!.name}: intervalo de leitura 1 s → ${pollLabel(namedTags[1]!.pollMs)}` },
          ]
        : Array.from({ length: n }, () => pick(templates)())
    // dedup por texto
    const unique = changes.filter((c, idx) => changes.findIndex((x) => x.text === c.text) === idx)
    versions.push({
      version,
      publishedAt: iso(at),
      author: i === 0 ? (latest?.author ?? who[0]!) : pick(who),
      summary: summarize(unique),
      changes: unique,
    })
    at -= (6 + Math.floor(rnd() * 90)) * HOUR
  }
  return versions
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

export interface GatewayCommand {
  id: string
  type: CommandType
  target: string
  requestedBy: string
  createdAt: string
  status: CommandStatus
  result: string
  durationMs: number | null
}

export function commandHistory(
  gateway: Gateway,
  devices: Device[],
  tags: Tag[],
  machines: Machine[],
  requesters: string[],
  /** Quando a versão publicada atual foi publicada (para não "aplicar" versão antiga depois dela). */
  latestPublishMs?: number,
): GatewayCommand[] {
  if (gateway.status === "pending") return []
  const rnd = seededRandom(`${gateway.id}:commands`)
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]!
  const who = requesters.length > 0 ? requesters : ["Equipe Engemase"]
  const machineName = (id: string) => machines.find((m) => m.id === id)?.name ?? "Máquina"
  const lastSeenMs = gateway.lastSeen ? Date.parse(gateway.lastSeen) : nowMs()
  const offline = gateway.status === "offline"

  const out: GatewayCommand[] = []
  let at = nowMs() - (4 + Math.floor(rnd() * 8)) * MIN
  for (let i = 0; i < 14; i++) {
    // Offline: só os 2 comandos mais recentes foram pedidos depois da perda de contato; o resto é anterior.
    if (offline && i >= 2 && at > lastSeenMs) at = lastSeenMs - (5 + Math.floor(rnd() * 25)) * MIN
    const roll = rnd()
    let type: CommandType = roll < 0.5 ? "tag.read" : roll < 0.8 ? "device.test" : roll < 0.93 ? "config.reload" : "agent.restart"
    // Só gera tipos que fazem sentido para o que o gateway tem.
    if (type === "tag.read" && tags.length === 0) type = "device.test"
    if (type === "device.test" && devices.length === 0) type = "config.reload"
    // Recarga depois de uma publicação ainda não aplicada não pode "aplicar" a versão antiga.
    const pendingConfig = gateway.configApplied !== null && gateway.configApplied < gateway.configVersion
    if (type === "config.reload" && pendingConfig && latestPublishMs !== undefined && at > latestPublishMs)
      type = devices.length ? "device.test" : "agent.restart"
    const afterContact = at > lastSeenMs
    let status: CommandStatus = "done"
    let target = gateway.name
    let result = ""
    let durationMs: number | null = null

    if (type === "tag.read" && tags.length > 0) {
      const t = pick(tags)
      const d = devices.find((x) => x.id === t.deviceId)
      target = `${machineName(t.machineId)} · ${t.name}`
      if (t.quality === "bad" || d?.status === "error") {
        status = "failed"
        result = d?.lastError ?? "Sem resposta do escravo"
        durationMs = d?.params.timeoutMs ?? 1000
      } else {
        durationMs = (d?.latencyMs ?? 20) + Math.round(rnd() * 12)
        result = `Valor ${formatTagValue(t.lastValue === "—" ? "0" : t.lastValue, t.dataType)} (${modbusRef(t.area, t.address)})`
      }
    } else if (type === "device.test" && devices.length > 0) {
      const d = pick(devices)
      target = d.protocol === "modbus-tcp" ? `${d.name} · ${d.params.host}:${d.params.port}` : `${d.name} · ${d.params.serialPort} #${d.params.unitId}`
      if (d.status === "error") {
        status = "failed"
        result = d.lastError ?? "Falha de comunicação"
        durationMs = d.params.timeoutMs
      } else if (d.status === "disabled") {
        status = "failed"
        result = "Conexão desativada na configuração"
        durationMs = 4
      } else {
        durationMs = (d.latencyMs ?? 20) + Math.round(rnd() * 8)
        result = `Conectado · unit id ${d.params.unitId} respondeu em ${durationMs} ms`
      }
    } else if (type === "config.reload") {
      durationMs = 900 + Math.round(rnd() * 900)
      result = `Configuração v${gateway.configApplied ?? gateway.configVersion} aplicada`
    } else {
      durationMs = 6000 + Math.round(rnd() * 4000)
      result = "Serviço reiniciado; primeiro /sync em 8 s"
    }

    if (offline && afterContact) {
      // Comandos criados depois do último contato: na fila ou expirados (tag.read expira em 2 min).
      const ageMin = (nowMs() - at) / MIN
      status = type === "tag.read" && ageMin > 2 ? "expired" : "queued"
      result = status === "expired" ? "Expirou sem ser entregue (gateway sem contato)" : "Aguardando o gateway voltar a se conectar"
      durationMs = null
    }

    out.push({
      id: `cmd_${gateway.id}_${i}`,
      type,
      target: type === "config.reload" || type === "agent.restart" ? `${COMMAND_TYPE_LABEL[type]} · ${gateway.hostname}` : target,
      requestedBy: pick(who),
      createdAt: iso(at),
      status,
      result,
      durationMs,
    })
    at -= (8 + Math.floor(rnd() * 150)) * MIN
  }
  return out
}

// ---------------------------------------------------------------------------
// Saúde (últimas 6 horas, a cada 5 min)
// ---------------------------------------------------------------------------

export interface HealthSeries {
  labels: string[]
  cpu: (number | null)[]
  memMb: (number | null)[]
  buffer: (number | null)[]
  /** Índice do primeiro ponto sem contato (gateway offline), ou null. */
  lostAt: number | null
}

export function healthSeries(gateway: Gateway, formatLabel: (iso: string) => string): HealthSeries | null {
  if (gateway.status === "pending") return null
  const rnd = seededRandom(`${gateway.id}:health`)
  const end = Date.parse(MOCK_NOW)
  const step = 5 * MIN
  const points = 72
  const lastSeen = gateway.lastSeen ? Date.parse(gateway.lastSeen) : end
  const baseCpu = gateway.cpuPct ?? 6
  const baseMem = gateway.memMb ?? 36
  const labels: string[] = []
  const cpu: (number | null)[] = []
  const memMb: (number | null)[] = []
  const buffer: (number | null)[] = []
  let lostAt: number | null = null
  let mem = baseMem - 3
  for (let i = 0; i < points; i++) {
    const t = end - (points - 1 - i) * step
    labels.push(formatLabel(iso(t)))
    if (t > lastSeen + step) {
      if (lostAt === null) lostAt = i
      cpu.push(null)
      memMb.push(null)
      buffer.push(null)
      continue
    }
    const spike = rnd() < 0.06 ? 8 + rnd() * 10 : 0
    cpu.push(Math.round(Math.max(1, baseCpu + (rnd() - 0.5) * 4 + spike) * 10) / 10)
    mem = Math.max(baseMem - 6, Math.min(baseMem + 6, mem + (rnd() - 0.45) * 1.2))
    memMb.push(Math.round(mem * 10) / 10)
    const progress = i / (points - 1)
    let b: number
    if (gateway.status === "degraded") b = Math.round(progress > 0.7 ? 5 + (progress - 0.7) * 120 + rnd() * 6 : rnd() * 4)
    else if (gateway.status === "offline") {
      const toLoss = (lastSeen - t) / HOUR
      b = Math.round(toLoss < 0.5 ? 40 + (0.5 - toLoss) * 300 + rnd() * 20 : rnd() * 5)
    } else b = Math.round(rnd() < 0.08 ? 10 + rnd() * 25 : rnd() * 4)
    buffer.push(b)
  }
  // O último ponto reportado bate com o valor atual do cadastro.
  const lastIdx = lostAt === null ? points - 1 : lostAt - 1
  if (lastIdx >= 0) {
    if (gateway.cpuPct !== null) cpu[lastIdx] = gateway.cpuPct
    if (gateway.memMb !== null) memMb[lastIdx] = gateway.memMb
    if (gateway.status !== "offline") buffer[lastIdx] = gateway.bufferPending
  }
  return { labels, cpu, memMb, buffer, lostAt }
}
