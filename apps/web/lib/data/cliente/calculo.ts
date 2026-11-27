/**
 * Monta o `ClienteDados` a partir das linhas lidas do banco (`banco.ts`), com o cálculo de OEE do
 * `@engemase/oee-core` (docs/07). Função pura: não lê banco nem relógio (o "agora" vem de fora), por isso
 * é testada sem servidor (test/data).
 *
 * - Turno corrente de cada unidade: a janela de turno que contém "agora"; fora do horário, o último
 *   turno que terminou. Sem turno cadastrado, o dia local corrente (sem tempo programado).
 * - OEE do turno: `calculateMachineOee` na janela [início do turno, agora), com os eventos de estado
 *   (tempos e motivos), os minutos (contagens), os lançamentos de refugo e o ciclo ideal por produto.
 * - Turnos fechados (relatório e tendência): a linha de `oee_shift` quando o fechamento de turno já
 *   gravou e não está suja; senão, o mesmo cálculo a partir dos eventos e dos minutos.
 * - Agregados (linha, unidade, cliente): soma das bases (`aggregateOee` do oee-core), nunca média.
 */
import {
  aggregateOee as aggregateTotals,
  calculateMachineOee,
  generateShiftWindows,
  plantDateOf,
  zonedDateTimeToInstant,
  addDays as addPlainDays,
  type MachineOeeResult,
  type OeeTotals,
  type ProductionMinute,
  type QualityAdjustment,
  type ShiftDefinition,
  type ShiftWindow,
  type StateEvent as CoreStateEvent,
  type IsoWeekday,
} from "@engemase/oee-core"
import type {
  AppNotification,
  Area,
  Client,
  DailyOee,
  Device,
  DowntimeReason,
  Gateway,
  HourlyProduction,
  Line,
  Machine,
  MachineLive,
  MachineState,
  MachineWithLive,
  OeeValues,
  ParetoItem,
  Product,
  ReasonCategory,
  Shift,
  ShiftOeeRow,
  StateEvent,
  Tag,
  Unit,
  ClientBranding,
} from "@/lib/mock"
import { UNCLASSIFIED_ID, UNCLASSIFIED_NAME } from "@/components/reports/report-utils"
import type { StopRecord } from "@/components/reports/stops-data"
import { fillMinuteProducts, type ProductRunSpan } from "@/lib/server/production/runs"
import type { AcessoTela, ClienteDados, JanelaTurno, NecessidadesCliente, OeeAgregado, Visitante } from "./tipos"

// ---------------------------------------------------------------------------
// Linhas lidas do banco (já filtradas pela RLS e pelo escopo da pessoa)
// ---------------------------------------------------------------------------
export interface BrutoCliente {
  readonly organization: {
    readonly id: string
    readonly slug: string
    readonly name: string
    readonly status: string
    readonly plan: string | null
    readonly limits: Record<string, unknown>
    readonly createdAt: string
  }
  readonly units: readonly { id: string; name: string; timezone: string }[]
  readonly areas: readonly { id: string; unitId: string; name: string }[]
  readonly lines: readonly { id: string; unitId: string; areaId: string | null; name: string; sortOrder: number; oeeTarget: number | null }[]
  readonly machines: readonly {
    id: string
    unitId: string
    lineId: string
    name: string
    code: string | null
    idealCycleS: number | null
    microStopThresholdS: number
    stateMode: string
    active: boolean
  }[]
  readonly products: readonly { id: string; code: string; name: string }[]
  readonly productMachines: readonly { productId: string; machineId: string; idealCycleS: number }[]
  readonly shifts: readonly {
    id: string
    unitId: string
    name: string
    startTime: string
    endTime: string
    daysOfWeek: readonly number[]
    breaks: readonly { start: string; end: string; name?: string }[]
    validFrom: string | null
    validTo: string | null
  }[]
  /** Feriados (L2): nenhum turno começa nesses dias. */
  readonly holidays: readonly { unitId: string; date: string }[]
  readonly plannedDowntimes: readonly { unitId: string; lineId: string | null; machineId: string | null; start: number; end: number }[]
  readonly reasons: readonly { id: string; parentId: string | null; name: string; category: ReasonCategory }[]
  readonly faultMap: readonly { machineId: string | null; faultCode: number; text: string; reasonId: string | null }[]
  /** Identidade visual do cliente (`client_branding`); sem ela, o padrão Engemase. */
  readonly branding?: ClientBranding
  /** Hash do símbolo enviado (`client_logo`), para a URL da rota de entrega. */
  readonly symbolSha?: string

  readonly live: readonly {
    machineId: string
    state: string
    stateSince: number
    faultCode: number | null
    productCode: string | null
    at: number
  }[]
  /** Eventos de estado desde o início do histórico pedido (com folga), ordenados por início. */
  readonly events: readonly {
    id?: string
    machineId: string
    state: string
    start: number
    end: number | null
    reasonId: string | null
    faultCode: number | null
  }[]
  /** Trocas de produto (CLP e operador) no período dos eventos (`production_run`). */
  readonly runs: readonly { machineId: string; start: number; end: number | null; productCode: string | null }[]
  /** Motivos de refugo ativos (para a tela do operador). */
  readonly rejectReasons: readonly { id: string; name: string }[]
  /** Minutos a partir de `rawSince` (turno corrente; contagem por hora exata). */
  readonly minutes: readonly { machineId: string; start: number; total: number; reject: number; productCode: string | null }[]
  /** Minutos antes de `rawSince`, somados em blocos de 15 min (histórico; menos linhas). */
  readonly quarterMinutes: readonly { machineId: string; start: number; total: number; reject: number; productCode: string | null }[]
  readonly quality: readonly { machineId: string; at: number; quantity: number; productCode: string | null }[]
  /** Turnos já fechados pelo `close-shifts` (tabela `oee_shift`), se houver. */
  readonly closedShifts: readonly {
    machineId: string
    shiftDate: string
    shiftId: string
    plannedS: number
    runS: number
    total: number
    good: number
    reject: number
    idealTimeS: number | null
    oee: number | null
    dirty: boolean
  }[]
  readonly gateways: readonly {
    id: string
    unitId: string
    name: string
    status: string
    lastSeenAt: number | null
    hostname: string | null
    agentVersion: string | null
    model: string | null
    configVersionLatest: number
    configVersionApplied: number | null
    health: Record<string, unknown> | null
  }[]
  readonly gatewayMachines: readonly { gatewayId: string; machineId: string }[]
  readonly devices: readonly {
    id: string
    gatewayId: string
    name: string
    protocol: string
    params: Record<string, unknown>
    enabled: boolean
    bus: { port: string; baud: number; parity: string; stopBits: number } | null
    status: string | null
    latencyMs: number | null
    errors1m: number | null
  }[]
  readonly tags: readonly {
    id: string
    deviceId: string
    machineId: string | null
    name: string | null
    role: string
    address: { area: string; offset: number }
    dataType: string
    wordOrder: string | null
    pollMs: number | null
  }[]
  readonly alerts: readonly {
    id: string
    type: string
    ruleName: string
    severity: string
    state: string
    openedAt: number
    machineId: string | null
    gatewayId: string | null
    acknowledgedByName: string | null
    read: boolean
  }[]
}

export interface MontagemCliente {
  readonly now: number
  /** Início dos minutos exatos (ver `BrutoCliente.minutes`). */
  readonly rawSince: number
  readonly viewer: Visitante
  readonly access: AcessoTela
  readonly needs: NecessidadesCliente
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** Live mais velho que isto = "dados atrasados" (docs/05, "Dados ao vivo"). */
export const STALE_AFTER_MS = 30_000
/** Gateway sem /sync há mais que isto = offline (mesmo limite do alerta, lib/server/cron/alerts.ts). */
export const GATEWAY_OFFLINE_AFTER_MS = 6 * MIN
/** Folga dos eventos antes/depois da janela (duração completa das paradas, para micro-paradas). */
export const EVENT_MARGIN_MS = 2 * HOUR
/** Semanas de paradas (relatório de Pareto: 14 dias + o período anterior para comparação). */
export const STOP_WEEKS = 4

const iso = (ms: number) => new Date(ms).toISOString()
const zeroIfNull = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? 0 : v)

const CLIENT_STATUS: Record<string, Client["status"]> = { active: "active", onboarding: "onboarding", suspended: "suspended", closed: "suspended" }
const PLANS = new Set(["starter", "pro", "enterprise"])
const CORE_STATES = new Set(["RUNNING", "STOPPED", "FAULT", "SETUP", "NO_COMM"])

/** Dias ISO (1 = segunda … 7 = domingo) → dias do protótipo (0 = domingo). */
const toSundayBased = (d: number) => d % 7

/** "Estampagem" → "EST" (a linha não tem código no banco; o Andon mostra uma sigla). */
export function lineCode(name: string): string {
  const letters = name
    .normalize("NFD")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
  const words = letters.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return words.map((w) => w[0]!.toUpperCase()).join("").slice(0, 4)
  return (words[0] ?? "L").slice(0, 3).toUpperCase()
}

function hhmm(time: string): string {
  return time.slice(0, 5)
}

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------
type Calendario = Pick<BrutoCliente, "shifts" | "holidays">

function shiftDefinitions(raw: Calendario, unitId: string): ShiftDefinition[] {
  return raw.shifts
    .filter((s) => s.unitId === unitId)
    .map((s) => ({
      id: s.id,
      name: s.name,
      start: hhmm(s.startTime),
      end: hhmm(s.endTime),
      daysOfWeek: s.daysOfWeek.filter((d): d is IsoWeekday => Number.isInteger(d) && d >= 1 && d <= 7),
      breaks: s.breaks.map((b) => ({ start: hhmm(b.start), end: hhmm(b.end), name: b.name })),
      validFrom: s.validFrom ?? undefined,
      validTo: s.validTo ?? undefined,
    }))
}

/** Janelas de turno da unidade entre as datas locais `[from, to]`, sem os feriados. */
function unitWindows(raw: Calendario, unitId: string, timeZone: string, from: string, to: string): ShiftWindow[] {
  const defs = shiftDefinitions(raw, unitId)
  if (defs.length === 0) return []
  const holidays = new Set(raw.holidays.filter((h) => h.unitId === unitId).map((h) => h.date))
  try {
    return generateShiftWindows({ shifts: defs, timeZone, from, to }).filter((w) => !holidays.has(w.shiftDate))
  } catch {
    // Cadastro incoerente (pausa fora do turno, fuso inválido): sem turnos, em vez de derrubar a tela.
    return []
  }
}

interface TurnoCalculado {
  readonly window: ShiftWindow | null
  readonly janela: JanelaTurno
}

function currentWindow(raw: Calendario, unitId: string, timeZone: string, now: number): TurnoCalculado {
  const today = safePlantDate(now, timeZone)
  const windows = unitWindows(raw, unitId, timeZone, addPlainDays(today, -7), addPlainDays(today, 1))
  const nameOf = (id: string) => raw.shifts.find((s) => s.id === id)?.name ?? "Turno"
  const running = windows.find((w) => w.start <= now && now < w.end)
  const last = [...windows].reverse().find((w) => w.end <= now)
  const w = running ?? last
  if (w) {
    return {
      window: w,
      janela: {
        id: w.shiftId,
        name: nameOf(w.shiftId),
        start: iso(w.start),
        end: iso(w.end),
        breaks: w.breaks.map((b) => ({ start: iso(b.start), end: iso(b.end) })),
        emAndamento: Boolean(running),
      },
    }
  }
  // Sem turno cadastrado: o dia local corrente, sem tempo programado (OEE "—").
  const dayStart = safeLocalMidnight(today, timeZone)
  return {
    window: null,
    janela: { id: "dia", name: "Hoje", start: iso(dayStart), end: iso(dayStart + DAY), breaks: [], emAndamento: true },
  }
}

function safeLocalMidnight(date: string, timeZone: string): number {
  try {
    return zonedDateTimeToInstant(date, "00:00", timeZone)
  } catch {
    return zonedDateTimeToInstant(date, "00:00", "America/Sao_Paulo")
  }
}

function safePlantDate(instant: number, timeZone: string): string {
  try {
    return plantDateOf(instant, timeZone)
  } catch {
    return plantDateOf(instant, "America/Sao_Paulo")
  }
}

/**
 * Início do turno corrente mais antigo entre as unidades: a partir dele o banco devolve os minutos
 * exatos (o resto do histórico vem somado em blocos de 15 min).
 */
export function inicioDosTurnosCorrentes(
  raw: Calendario & { readonly units: BrutoCliente["units"] },
  now: number,
): number {
  let earliest = now
  for (const u of raw.units) {
    const { janela } = currentWindow(raw, u.id, u.timezone || "America/Sao_Paulo", now)
    earliest = Math.min(earliest, Date.parse(janela.start))
  }
  return earliest
}

// ---------------------------------------------------------------------------
// Cálculo por máquina
// ---------------------------------------------------------------------------
interface MachineInputs {
  readonly events: CoreStateEvent[]
  readonly rawEvents: BrutoCliente["events"][number][]
  minutes: ProductionMinute[]
  readonly quality: QualityAdjustment[]
  readonly plannedDowntimes: { start: number; end: number }[]
  readonly idealCycles: { byProduct: Record<string, number>; defaultS: number | null }
  readonly microStopThresholdS: number
}

function overlaps(start: number, end: number | null, from: number, to: number): boolean {
  return start < to && (end === null || end > from)
}

function calculate(inputs: MachineInputs, window: { start: number; end: number }, schedule: ShiftWindow[]): MachineOeeResult | null {
  if (window.end <= window.start) return null
  const from = window.start - EVENT_MARGIN_MS
  const to = window.end + EVENT_MARGIN_MS
  try {
    return calculateMachineOee({
      window,
      schedule,
      plannedDowntimes: inputs.plannedDowntimes.filter((p) => overlaps(p.start, p.end, window.start, window.end)),
      stateEvents: inputs.events.filter((e) => overlaps(e.start, e.end, from, to)),
      minutes: inputs.minutes.filter((m) => m.start >= window.start && m.start < window.end),
      qualityAdjustments: inputs.quality.filter((q) => q.at >= window.start && q.at < window.end),
      idealCycles: inputs.idealCycles,
      options: { microStopThresholdS: inputs.microStopThresholdS },
    })
  } catch {
    return null
  }
}

function toOeeValues(r: { indicators: { availability: number | null; performance: number | null; quality: number | null; oee: number | null } }): OeeValues {
  return {
    availability: zeroIfNull(r.indicators.availability),
    performance: zeroIfNull(r.indicators.performance),
    quality: zeroIfNull(r.indicators.quality),
    oee: zeroIfNull(r.indicators.oee),
  }
}

/** Tempo programado (s) da janela inteira do turno, sem as pausas. */
function scheduledSeconds(w: ShiftWindow | null): number {
  if (!w) return 0
  const breaks = w.breaks.reduce((s, b) => s + (b.end - b.start), 0)
  return Math.max(0, (w.end - w.start - breaks) / 1000)
}

function breakOverlapMs(w: ShiftWindow, from: number, to: number): number {
  return w.breaks.reduce((s, b) => s + Math.max(0, Math.min(b.end, to) - Math.max(b.start, from)), 0)
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------
export function montarClienteDados(raw: BrutoCliente, m: MontagemCliente): ClienteDados {
  const { now } = m
  const org = raw.organization
  const tzOf = new Map(raw.units.map((u) => [u.id, u.timezone || "America/Sao_Paulo"]))

  // ---- Cadastros no formato das telas --------------------------------------
  const client: Client = {
    id: org.id,
    slug: org.slug,
    name: org.name,
    legalName: org.name,
    cnpj: "",
    city: "",
    state: "",
    status: CLIENT_STATUS[org.status] ?? "active",
    plan: (PLANS.has(org.plan ?? "") ? org.plan : "pro") as Client["plan"],
    limits: {
      machines: Number(org.limits.machines ?? 0),
      gateways: Number(org.limits.gateways ?? 0),
      users: Number(org.limits.users ?? 0),
      retentionMonths: Number(org.limits.retentionMonths ?? org.limits.retention_months ?? 0),
    },
    contactName: "",
    contactEmail: "",
    createdAt: org.createdAt,
  }
  const units: Unit[] = raw.units.map((u) => ({ id: u.id, clientId: org.id, name: u.name, city: "", state: "", timezone: tzOf.get(u.id)! }))
  const areas: Area[] = raw.areas.map((a) => ({ id: a.id, clientId: org.id, unitId: a.unitId, name: a.name }))
  const lines: Line[] = raw.lines.map((l) => ({ id: l.id, clientId: org.id, unitId: l.unitId, areaId: l.areaId ?? "", name: l.name, code: lineCode(l.name) }))

  const gatewayOf = new Map(raw.gatewayMachines.map((g) => [g.machineId, g.gatewayId]))
  const deviceOf = new Map<string, string>()
  for (const t of raw.tags) if (t.machineId && !deviceOf.has(t.machineId)) deviceOf.set(t.machineId, t.deviceId)

  const productCycles = new Map<string, Map<string, number>>()
  const productCode = new Map(raw.products.map((p) => [p.id, p.code]))
  for (const pm of raw.productMachines) {
    const code = productCode.get(pm.productId)
    if (code === undefined) continue
    if (!productCycles.has(pm.machineId)) productCycles.set(pm.machineId, new Map())
    productCycles.get(pm.machineId)!.set(code, pm.idealCycleS)
  }

  const machines: Machine[] = raw.machines.map((x) => ({
    id: x.id,
    clientId: org.id,
    unitId: x.unitId,
    lineId: x.lineId,
    name: x.name,
    code: x.code ?? "",
    type: "",
    gatewayId: gatewayOf.get(x.id) ?? null,
    deviceId: deviceOf.get(x.id) ?? null,
    idealCycleS: x.idealCycleS ?? [...(productCycles.get(x.id)?.values() ?? [])][0] ?? 0,
    microStopThresholdS: x.microStopThresholdS,
    stateMode: (x.stateMode === "state_code" || x.stateMode === "count_derived" ? x.stateMode : "signals") as Machine["stateMode"],
    active: x.active,
  }))
  const machineById = new Map(machines.map((x) => [x.id, x]))

  const products: Product[] = raw.products.map((p) => ({
    id: p.id,
    clientId: org.id,
    code: p.code,
    name: p.name,
    idealCycles: raw.productMachines.filter((pm) => pm.productId === p.id).map((pm) => ({ machineId: pm.machineId, idealCycleS: pm.idealCycleS })),
  }))
  const productName = new Map(raw.products.map((p) => [p.code, p.name]))

  const shifts: Shift[] = raw.shifts.map((s) => ({
    id: s.id,
    clientId: org.id,
    unitId: s.unitId,
    name: s.name,
    start: hhmm(s.startTime),
    end: hhmm(s.endTime),
    days: s.daysOfWeek.map(toSundayBased),
    breaks: s.breaks.map((b) => ({ name: b.name ?? "Pausa", start: hhmm(b.start), end: hhmm(b.end) })),
  }))

  const reasons: DowntimeReason[] = raw.reasons.map((r) => ({ id: r.id, clientId: org.id, parentId: r.parentId, name: r.name, category: r.category }))
  const reasonById = new Map(reasons.map((r) => [r.id, r]))

  const gateways: Gateway[] = raw.gateways
    .filter((g) => g.status !== "revoked")
    .map((g) => {
      const h = g.health ?? {}
      const num = (k: string) => (typeof h[k] === "number" ? (h[k] as number) : null)
      const online = g.lastSeenAt !== null && now - g.lastSeenAt < GATEWAY_OFFLINE_AFTER_MS
      const status: Gateway["status"] =
        g.status === "pending_enrollment"
          ? "pending"
          : !online
            ? "offline"
            : g.configVersionApplied !== null && g.configVersionApplied < g.configVersionLatest
              ? "degraded"
              : "online"
      return {
        id: g.id,
        clientId: org.id,
        unitId: g.unitId,
        name: g.name,
        hostname: g.hostname ?? "—",
        hardware: g.model ?? "—",
        status,
        lastSeen: g.lastSeenAt !== null ? iso(g.lastSeenAt) : null,
        agentVersion: g.agentVersion,
        configVersion: g.configVersionLatest,
        configApplied: g.configVersionApplied,
        bufferPending: num("buffer_pending") ?? 0,
        cpuPct: num("cpu_pct"),
        memMb: num("mem_mb"),
        diskFreePct: null,
        clockOffsetMs: num("clock_offset_ms"),
        ipIt: null,
        ipOt: null,
        uptimeS: num("uptime_s"),
      }
    })
  const gatewayById = new Map(gateways.map((g) => [g.id, g]))

  const devices: Device[] = raw.devices.map((d) => {
    const p = d.params
    const numP = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : undefined)
    const status: Device["status"] = !d.enabled || d.status === "disabled" ? "disabled" : d.status === "disconnected" ? "error" : "connected"
    return {
      id: d.id,
      gatewayId: d.gatewayId,
      name: d.name,
      protocol: (d.protocol === "modbus-rtu" || d.protocol === "modbus-rtu-over-tcp" ? d.protocol : "modbus-tcp") as Device["protocol"],
      params: {
        host: typeof p.host === "string" ? p.host : undefined,
        port: numP("port"),
        serialPort: d.bus?.port,
        baudRate: d.bus?.baud,
        parity: (d.bus?.parity as "N" | "E" | "O" | undefined) ?? undefined,
        dataBits: d.bus ? 8 : undefined,
        stopBits: d.bus ? ((d.bus.stopBits === 2 ? 2 : 1) as 1 | 2) : undefined,
        unitId: numP("unit_id") ?? 1,
        timeoutMs: numP("timeout_ms") ?? 1000,
      },
      status,
      latencyMs: d.latencyMs,
      errors1m: d.errors1m ?? 0,
      lastError: status === "error" ? "Sem resposta do CLP" : undefined,
    }
  })
  const deviceById = new Map(devices.map((d) => [d.id, d]))

  const tags: Tag[] = raw.tags.map((t) => ({
    id: t.id,
    deviceId: t.deviceId,
    machineId: t.machineId ?? "",
    name: t.name ?? t.role,
    role: t.role as Tag["role"],
    area: t.address.area as Tag["area"],
    address: t.address.offset,
    dataType: t.dataType as Tag["dataType"],
    byteOrder: (t.wordOrder ?? "ABCD") as Tag["byteOrder"],
    pollMs: t.pollMs ?? 1000,
    // A nuvem não guarda o último valor lido de cada tag (só o estado consolidado).
    lastValue: "—",
    quality: "stale",
  }))

  // ---- Entradas do cálculo por máquina ---------------------------------------
  const reasonCategory = (id: string | null) => (id ? (reasonById.get(id)?.category ?? null) : null)
  const inputsOf = new Map<string, MachineInputs>()
  for (const x of machines) {
    inputsOf.set(x.id, {
      events: [],
      rawEvents: [],
      minutes: [],
      quality: [],
      plannedDowntimes: raw.plannedDowntimes
        .filter((p) => p.machineId === x.id || (p.machineId === null && (p.lineId === x.lineId || (p.lineId === null && p.unitId === x.unitId))))
        .map((p) => ({ start: p.start, end: p.end })),
      idealCycles: {
        byProduct: Object.fromEntries(productCycles.get(x.id) ?? []),
        defaultS: raw.machines.find((r) => r.id === x.id)?.idealCycleS ?? null,
      },
      microStopThresholdS: x.microStopThresholdS,
    })
  }
  for (const e of raw.events) {
    const inp = inputsOf.get(e.machineId)
    if (!inp || !CORE_STATES.has(e.state)) continue
    inp.rawEvents.push(e)
    inp.events.push({ start: e.start, end: e.end, state: e.state as CoreStateEvent["state"], reasonCategory: reasonCategory(e.reasonId) })
  }
  for (const list of [raw.quarterMinutes, raw.minutes]) {
    for (const mi of list) inputsOf.get(mi.machineId)?.minutes.push({ start: mi.start, total: mi.total, reject: mi.reject, productCode: mi.productCode })
  }
  // Minutos sem produto do CLP recebem o produto apontado pelo operador (docs/05), como no fechamento de turno.
  const runsOf = new Map<string, ProductRunSpan[]>()
  for (const r of raw.runs) runsOf.set(r.machineId, [...(runsOf.get(r.machineId) ?? []), r])
  for (const [machineId, inp] of inputsOf) {
    const runs = runsOf.get(machineId)
    if (runs !== undefined) inp.minutes = fillMinuteProducts(inp.minutes, runs)
  }
  for (const q of raw.quality) inputsOf.get(q.machineId)?.quality.push({ at: q.at, quantity: q.quantity, productCode: q.productCode })

  // ---- Turno corrente por unidade ------------------------------------------------
  const turnoDe = new Map<string, TurnoCalculado>()
  for (const u of units) turnoDe.set(u.id, currentWindow(raw, u.id, u.timezone, now))
  const defaultUnitId = machines[0]?.unitId ?? units[0]?.id
  const fallbackTurno = currentWindow(raw, "", "America/Sao_Paulo", now)
  const turnoOf = (unitId: string | undefined) => (unitId ? turnoDe.get(unitId) : undefined) ?? fallbackTurno

  // ---- Estado ao vivo + OEE do turno ---------------------------------------------
  const liveRow = new Map(raw.live.map((l) => [l.machineId, l]))
  const faultText = (machineId: string, code: number | null) => {
    if (code === null) return undefined
    const hit = raw.faultMap.find((f) => f.faultCode === code && f.machineId === machineId) ?? raw.faultMap.find((f) => f.faultCode === code && f.machineId === null)
    // Texto do alarme cadastrado; sem texto, o nome do motivo automático.
    return hit ? hit.text || (hit.reasonId ? reasonById.get(hit.reasonId)?.name : undefined) : undefined
  }

  const liveOf = new Map<string, MachineLive>()
  const timelineOf = new Map<string, StateEvent[]>()
  const hourlyOf = new Map<string, HourlyProduction[]>()
  for (const x of machines) {
    const inp = inputsOf.get(x.id)!
    const { window: w, janela } = turnoOf(x.unitId)
    const start = Date.parse(janela.start)
    const end = Math.min(Date.parse(janela.end), now)
    const schedule = w ? [w] : []

    // Linha do tempo do turno (formato do protótipo; motivo "planejada" aparece como parada planejada).
    const timeline: StateEvent[] = []
    inp.rawEvents.forEach((e, i) => {
      if (!overlaps(e.start, e.end, start, end)) return
      const eEnd = Math.min(e.end ?? inp.rawEvents[i + 1]?.start ?? end, end)
      const eStart = Math.max(e.start, start)
      if (eEnd <= eStart) return
      const planned = reasonCategory(e.reasonId) === "planned" && e.state !== "RUNNING"
      timeline.push({
        machineId: x.id,
        state: (planned ? "PLANNED_STOP" : e.state) as MachineState,
        start: iso(eStart),
        end: iso(eEnd),
        reasonId: e.reasonId,
        ...(e.faultCode !== null ? { faultCode: e.faultCode } : {}),
        ...(e.id !== undefined ? { eventId: e.id } : {}),
      })
    })
    timelineOf.set(x.id, timeline)

    const l = liveRow.get(x.id)
    const result = calculate(inp, { start, end }, schedule)
    const lastProduct = [...inp.minutes].reverse().find((mi) => mi.productCode !== null)?.productCode ?? null
    // Produto atual: o do CLP; sem ele, a corrida aberta (troca pelo operador); senão, o último minuto com produto.
    const openRun = [...(runsOf.get(x.id) ?? [])].reverse().find((r) => r.end === null && r.start <= now)?.productCode ?? null
    const product = l?.productCode ?? openRun ?? lastProduct ?? ""
    const cycle = (product && inp.idealCycles.byProduct[product]) || inp.idealCycles.defaultS || x.idealCycleS || 0

    // Produção por hora do turno (minutos exatos).
    const hours: HourlyProduction[] = []
    const shiftStart = Date.parse(janela.start)
    const shiftEnd = Date.parse(janela.end)
    for (let h = Math.floor(shiftStart / HOUR) * HOUR; h < shiftEnd; h += HOUR) {
      const from = Math.max(h, shiftStart)
      const to = Math.min(h + HOUR, shiftEnd)
      let total = 0
      let reject = 0
      for (const mi of inp.minutes) {
        if (mi.start >= from && mi.start < to) {
          total += mi.total
          reject += mi.reject
        }
      }
      const programmedMs = w ? to - from - breakOverlapMs(w, from, to) : 0
      hours.push({ hour: iso(h), total, reject, target: cycle > 0 ? Math.round(programmedMs / 1000 / cycle) : 0 })
    }
    hourlyOf.set(x.id, hours)

    if (!l) continue
    const lastEvent = inp.rawEvents.filter((e) => e.start <= now).at(-1)
    const plannedNow = lastEvent && lastEvent.end === null && lastEvent.state !== "RUNNING" && reasonCategory(lastEvent.reasonId) === "planned"
    const state: MachineState = plannedNow ? "PLANNED_STOP" : CORE_STATES.has(l.state) ? (l.state as MachineState) : "NO_COMM"
    const gw = x.gatewayId ? gatewayById.get(x.gatewayId) : undefined
    const totals = result?.totals
    liveOf.set(x.id, {
      machineId: x.id,
      state,
      stateSince: iso(l.stateSince),
      ...(l.faultCode !== null && state === "FAULT" ? { faultCode: l.faultCode, faultText: faultText(x.id, l.faultCode) } : {}),
      productCode: product,
      productName: productName.get(product) ?? (product ? `Produto ${product}` : "—"),
      countShift: totals?.total ?? 0,
      rejectShift: totals?.reject ?? 0,
      targetShift: cycle > 0 ? Math.round(scheduledSeconds(w) / cycle) : 0,
      shift: result ? toOeeValues(result) : { availability: 0, performance: 0, quality: 0, oee: 0 },
      basis: totals
        ? {
            plannedS: totals.plannedS,
            runS: totals.runS,
            total: totals.total,
            good: totals.good,
            idealS: totals.idealTimeS ?? 0,
            goodIdealS: totals.goodIdealTimeS ?? 0,
          }
        : undefined,
      lastUpdate: iso(l.at),
      stale: now - l.at > STALE_AFTER_MS || gw?.status === "offline",
    })
  }

  // ---- Turnos fechados (histórico) ---------------------------------------------------
  const historyDays = Math.max(m.needs.diasOee ?? 0, m.needs.diasTurnos ?? 0)
  interface ShiftCalc {
    machineId: string
    date: string
    shiftId: string
    shiftName: string
    totals: OeeTotals
  }
  const closed: ShiftCalc[] = []
  if (historyDays > 0) {
    const closedByKey = new Map(raw.closedShifts.map((c) => [`${c.machineId}|${c.shiftDate}|${c.shiftId}`, c]))
    for (const u of units) {
      const today = safePlantDate(now, u.timezone)
      const windows = unitWindows(raw, u.id, u.timezone, addPlainDays(today, -historyDays), today).filter((w) => w.end <= now)
      const unitMachines = machines.filter((x) => x.unitId === u.id)
      for (const w of windows) {
        const name = raw.shifts.find((s) => s.id === w.shiftId)?.name ?? "Turno"
        for (const x of unitMachines) {
          const saved = closedByKey.get(`${x.id}|${w.shiftDate}|${w.shiftId}`)
          let totals: OeeTotals | null = null
          if (saved && !saved.dirty) {
            const goodIdeal = saved.oee !== null ? saved.oee * saved.plannedS : saved.idealTimeS !== null && saved.total > 0 ? (saved.idealTimeS * saved.good) / saved.total : null
            totals = { plannedS: saved.plannedS, runS: saved.runS, total: saved.total, reject: saved.reject, good: saved.good, idealTimeS: saved.idealTimeS, goodIdealTimeS: goodIdeal }
          } else {
            totals = calculate(inputsOf.get(x.id)!, { start: w.start, end: w.end }, [w])?.totals ?? null
          }
          if (totals && (totals.plannedS > 0 || totals.total > 0)) closed.push({ machineId: x.id, date: w.shiftDate, shiftId: w.shiftId, shiftName: name, totals })
        }
      }
    }
  }

  // ---- Paradas por motivo (últimas semanas fechadas) -----------------------------------
  const stopRecords: StopRecord[] = []
  if (m.needs.paradas) {
    const acc = new Map<string, StopRecord>()
    for (const x of machines) {
      const inp = inputsOf.get(x.id)!
      const tz = tzOf.get(x.unitId) ?? "America/Sao_Paulo"
      const endDate = addPlainDays(safePlantDate(now, tz), -1)
      inp.rawEvents.forEach((e, i) => {
        if (e.state === "RUNNING") return
        const eEnd = e.end ?? inp.rawEvents[i + 1]?.start ?? now
        const durS = (eEnd - e.start) / 1000
        const reason = e.reasonId ? reasonById.get(e.reasonId) : undefined
        // Micro-parada (parada/falha sem motivo planejado abaixo do limite) conta como operação (docs/07).
        if ((e.state === "STOPPED" || e.state === "FAULT") && reason?.category !== "planned" && durS < x.microStopThresholdS) return
        const date = safePlantDate(e.start, tz)
        if (date > endDate) return
        const ageDays = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / DAY)
        const week = Math.floor(ageDays / 7)
        if (week < 0 || week >= STOP_WEEKS) return
        const reasonId = reason?.id ?? UNCLASSIFIED_ID
        const key = `${x.id}|${week}|${reasonId}`
        const prev = acc.get(key)
        if (prev) {
          prev.minutes += durS / 60
          prev.occurrences += 1
        } else {
          acc.set(key, {
            machineId: x.id,
            week,
            reasonId,
            reasonName: reason?.name ?? UNCLASSIFIED_NAME,
            category: reason?.category ?? (e.state === "SETUP" ? "setup" : "unplanned"),
            minutes: durS / 60,
            occurrences: 1,
          })
        }
      })
    }
    for (const r of acc.values()) {
      r.minutes = Math.round(r.minutes)
      if (r.minutes > 0) stopRecords.push(r)
    }
  }

  // ---- Alertas ------------------------------------------------------------------------
  const notifications: AppNotification[] = []
  if (m.needs.notificacoes) {
    const slug = org.slug
    for (const a of raw.alerts) {
      const machine = a.machineId ? machineById.get(a.machineId) : undefined
      const gateway = a.gatewayId ? gatewayById.get(a.gatewayId) : undefined
      if (a.machineId && !machine) continue // fora do escopo
      if (a.gatewayId && !gateway) continue
      const type = ALERT_TYPE[a.type] ?? "gateway_offline"
      const target = machine?.name ?? gateway?.name ?? ""
      const line = machine ? lines.find((l) => l.id === machine.lineId) : undefined
      notifications.push({
        id: a.id,
        clientId: org.id,
        unitId: machine?.unitId ?? gateway?.unitId ?? null,
        type,
        severity: (a.severity === "critical" || a.severity === "warning" ? a.severity : "info") as AppNotification["severity"],
        title: alertTitle(a.type, target, a.ruleName),
        body: [a.ruleName, line?.name].filter(Boolean).join(" · "),
        href: machine ? `/${slug}/maquinas/${machine.id}` : gateway ? `/${slug}/config/gateways/${gateway.id}` : `/${slug}/notificacoes`,
        at: iso(a.openedAt),
        read: a.read,
        status: a.state === "acknowledged" ? "acknowledged" : a.state === "resolved" || a.state === "auto_resolved" ? "resolved" : "open",
        ...(a.acknowledgedByName ? { acknowledgedBy: a.acknowledgedByName } : {}),
      })
    }
    notifications.sort((x, y) => y.at.localeCompare(x.at))
  }

  // ---- Consultas -------------------------------------------------------------------------
  const owns = (id: string) => machineById.has(id)
  const aggregate = (list: readonly { live?: MachineLive }[]): OeeAgregado => {
    // Como no protótipo: máquina com dados atrasados fica de fora até os dados chegarem (o turno é recalculado).
    const withBasis = list.filter((x) => x.live?.basis && !x.live.stale && x.live.basis.plannedS + x.live.basis.total > 0)
    if (withBasis.length === 0) return { availability: 0, performance: 0, quality: 0, oee: 0, machinesWithData: 0 }
    const summary = aggregateTotals(
      withBasis.map((x) => {
        const b = x.live!.basis!
        return { plannedS: b.plannedS, runS: b.runS, total: b.total, good: b.good, reject: b.total - b.good, idealTimeS: b.idealS, goodIdealTimeS: b.goodIdealS }
      }),
    )
    return { ...toOeeValues(summary), machinesWithData: withBasis.length }
  }

  return {
    fonte: "banco",
    now: iso(now),
    nowMs: now,
    client,
    viewer: m.viewer,
    access: m.access,
    accessibleClients: [{ slug: client.slug, name: client.name, status: client.status }],
    branding: raw.branding,
    ...(raw.symbolSha ? { symbolUrl: `/${client.slug}/marca/symbol?v=${raw.symbolSha.slice(0, 16)}` } : {}),
    oeeTarget: (() => {
      const targets = raw.lines.map((l) => l.oeeTarget).filter((v): v is number => v !== null && v > 0)
      return targets.length > 0 ? targets.reduce((a, b) => a + b, 0) / targets.length : 0.75
    })(),
    units,
    areas,
    lines,
    machines,
    gateways,
    reasons,
    rejectReasons: raw.rejectReasons,
    products,
    shifts,

    getUnit: (id) => units.find((u) => u.id === id),
    getLine: (id) => lines.find((l) => l.id === id),
    getMachine: (id) => machineById.get(id),
    getAreas: (unitId) => areas.filter((a) => a.unitId === unitId),
    getGateway: (id) => gatewayById.get(id),
    getDevice: (id) => deviceById.get(id),
    getDevices: (gatewayId) => devices.filter((d) => d.gatewayId === gatewayId),
    getTags: (machineId) => tags.filter((t) => t.machineId === machineId),
    getDowntimeReason: (id) => (id ? reasonById.get(id) : undefined),

    shiftWindow: (unitId) => turnoOf(unitId ?? defaultUnitId).janela,

    getMachinesWithLive: (filter = {}) =>
      machines
        .filter((x) => (!filter.unitId || x.unitId === filter.unitId) && (!filter.lineId || x.lineId === filter.lineId))
        .map((x): MachineWithLive => ({ ...x, live: liveOf.get(x.id) })),
    getMachineLive: (id) => liveOf.get(id),
    getTimeline: (id) => timelineOf.get(id) ?? [],
    getHourlyProduction: (id) => hourlyOf.get(id) ?? [],
    getDailyOee: (id, days) => {
      const byDate = new Map<string, OeeTotals[]>()
      for (const c of closed) if (c.machineId === id) byDate.set(c.date, [...(byDate.get(c.date) ?? []), c.totals])
      return [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-days)
        .filter(([, list]) => list.some((t) => t.plannedS > 0))
        .map(([date, list]): DailyOee => ({ date, ...toOeeValues(aggregateTotals(list)) }))
    },
    getPareto: (ids) => {
      const set = new Set(ids.filter(owns))
      const acc = new Map<string, ParetoItem>()
      for (const r of stopRecords) {
        if (r.week !== 0 || !set.has(r.machineId)) continue
        const prev = acc.get(r.reasonId)
        if (prev) {
          prev.minutes += r.minutes
          prev.occurrences += r.occurrences
        } else acc.set(r.reasonId, { reasonId: r.reasonId, reasonName: r.reasonName, category: r.category, minutes: r.minutes, occurrences: r.occurrences })
      }
      return [...acc.values()].sort((a, b) => b.minutes - a.minutes)
    },
    getShiftHistory: (ids, days) => {
      const set = new Set(ids.filter(owns))
      const dates = [...new Set(closed.map((c) => c.date))].sort().slice(-days)
      const keep = new Set(dates)
      return closed
        .filter((c) => set.has(c.machineId) && keep.has(c.date) && c.totals.plannedS > 0)
        .map((c): ShiftOeeRow => ({
          date: c.date,
          shiftName: c.shiftName,
          machineId: c.machineId,
          plannedMin: c.totals.plannedS / 60,
          runMin: c.totals.runS / 60,
          total: c.totals.total,
          good: c.totals.good,
          reject: c.totals.reject,
          ...toOeeValues(aggregateTotals([c.totals])),
        }))
    },
    getStopRecords: (ids) => {
      const set = new Set(ids.filter(owns))
      return stopRecords.filter((r) => set.has(r.machineId))
    },
    aggregateOee: aggregate,
    getNotifications: () => notifications,
    getRemoteSessions: () => [],
    operatorFor: () => ({ name: m.viewer.name, username: m.viewer.email || null }),
  }
}

/** Tipo do alerta no banco (docs/13) → tipo usado nas telas. */
const ALERT_TYPE: Record<string, AppNotification["type"]> = {
  machine_stopped: "machine_stopped",
  machine_fault: "machine_fault",
  gateway_offline: "gateway_offline",
  no_data: "machine_no_comm",
  oee_below_target: "oee_below_target",
  unclassified_stops: "unclassified_stops",
  remote_access: "remote_access_request",
  engemase_ops: "gateway_offline",
}

function alertTitle(type: string, target: string, ruleName: string): string {
  if (!target) return ruleName
  switch (type) {
    case "machine_stopped":
      return `${target} parada`
    case "machine_fault":
      return `${target} em falha`
    case "gateway_offline":
      return `${target} offline`
    case "no_data":
      return `${target} sem comunicação`
    case "oee_below_target":
      return `OEE abaixo da meta · ${target}`
    case "unclassified_stops":
      return `Paradas sem motivo · ${target}`
    default:
      return `${ruleName} · ${target}`
  }
}
