/**
 * Séries temporais SIMULADAS (estado ao vivo, timeline, produção por hora, histórico de OEE).
 * Geração determinística (PRNG com semente) a partir de MOCK_NOW, para que servidor e
 * cliente produzam exatamente os mesmos dados (sem Date.now()/Math.random()).
 */
import { MOCK_NOW, downtimeReasons, faultTexts, machines, products } from "./data"
import type {
  DailyOee,
  HourlyProduction,
  Machine,
  MachineLive,
  MachineState,
  OeeValues,
  ParetoItem,
  StateEvent,
} from "./types"

// ---------------------------------------------------------------------------
// PRNG determinístico
// ---------------------------------------------------------------------------
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function seededRandom(seed: string): () => number {
  let a = hashString(seed)
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const between = (r: () => number, min: number, max: number) => min + (max - min) * r()
const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)]

// ---------------------------------------------------------------------------
// Perfil de cada máquina (estado atual e "qualidade" típica)
// ---------------------------------------------------------------------------
interface Profile {
  current: MachineState
  /** Há quantos minutos está no estado atual. */
  sinceMin: number
  perf: number // fator de performance típico (0-1)
  quality: number // taxa de peças boas típica (0-1)
  stopRate: number // propensão a paradas (0-1)
  faultCode?: number
  stale?: boolean
  noData?: boolean
}

const profiles: Record<string, Profile> = {
  mch_inj01: { current: "RUNNING", sinceMin: 12, perf: 0.93, quality: 0.985, stopRate: 0.25 },
  mch_inj02: { current: "RUNNING", sinceMin: 9, perf: 0.89, quality: 0.978, stopRate: 0.4 },
  mch_inj03: { current: "STOPPED", sinceMin: 14, perf: 0.86, quality: 0.97, stopRate: 0.55 },
  mch_inj04: { current: "NO_COMM", sinceMin: 37, perf: 0.84, quality: 0.975, stopRate: 0.45 },
  mch_sop01: { current: "RUNNING", sinceMin: 12, perf: 0.95, quality: 0.992, stopRate: 0.2 },
  mch_sop02: { current: "SETUP", sinceMin: 26, perf: 0.9, quality: 0.988, stopRate: 0.35 },
  mch_inj05: { current: "NO_COMM", sinceMin: 44, perf: 0.88, quality: 0.98, stopRate: 0.35, stale: true },
  mch_inj06: { current: "NO_COMM", sinceMin: 44, perf: 0.85, quality: 0.972, stopRate: 0.4, stale: true },
  mch_pre01: { current: "RUNNING", sinceMin: 31, perf: 0.91, quality: 0.995, stopRate: 0.3 },
  mch_pre02: { current: "FAULT", sinceMin: 7, perf: 0.87, quality: 0.99, stopRate: 0.5, faultCode: 58 },
  mch_pre03: { current: "NO_COMM", sinceMin: 19, perf: 0.8, quality: 0.985, stopRate: 0.5 },
  mch_cnc01: { current: "RUNNING", sinceMin: 64, perf: 0.94, quality: 0.998, stopRate: 0.15 },
  mch_cnc02: { current: "PLANNED_STOP", sinceMin: 22, perf: 0.9, quality: 0.996, stopRate: 0.2 },
  mch_env01: { current: "NO_COMM", sinceMin: 0, perf: 0.9, quality: 0.99, stopRate: 0.3, noData: true, stale: true },
  mch_rot01: { current: "NO_COMM", sinceMin: 0, perf: 0.9, quality: 0.99, stopRate: 0.3, noData: true, stale: true },
  mch_tea01: { current: "NO_COMM", sinceMin: 0, perf: 0.85, quality: 0.98, stopRate: 0.3, noData: true, stale: true },
}

export function profileOf(machineId: string): Profile {
  return profiles[machineId] ?? { current: "NO_COMM", sinceMin: 0, perf: 0.9, quality: 0.98, stopRate: 0.3, noData: true }
}

// ---------------------------------------------------------------------------
// Turno corrente: 06:00–14:00 (BRT) = 09:00Z–17:00Z, com refeição 10:00–10:30 (13:00Z–13:30Z)
// ---------------------------------------------------------------------------
const NOW_MS = Date.parse(MOCK_NOW)
export const SHIFT_START = "2026-11-11T09:00:00.000Z"
export const SHIFT_END = "2026-11-11T17:00:00.000Z"
const SHIFT_START_MS = Date.parse(SHIFT_START)
const SHIFT_END_MS = Date.parse(SHIFT_END)
const BREAK_START_MS = Date.parse("2026-11-11T13:00:00.000Z")
const BREAK_END_MS = Date.parse("2026-11-11T13:30:00.000Z")
const MIN = 60_000

const iso = (ms: number) => new Date(ms).toISOString()

function unplannedLeafReasons(clientId: string) {
  const all = downtimeReasons.filter((r) => r.clientId === clientId)
  const parents = new Set(all.map((r) => r.parentId).filter(Boolean))
  return all.filter((r) => r.parentId !== null && !parents.has(r.id) && r.category === "unplanned")
}
function reasonByName(clientId: string, name: string) {
  return downtimeReasons.find((r) => r.clientId === clientId && r.name === name)?.id ?? null
}

function buildTimeline(machine: Machine): StateEvent[] {
  const p = profileOf(machine.id)
  if (p.noData) return []
  const r = seededRandom(`timeline:${machine.id}`)
  const events: StateEvent[] = []
  const currentStart = NOW_MS - p.sinceMin * MIN
  const leaves = unplannedLeafReasons(machine.clientId)
  const breakReason = reasonByName(machine.clientId, "Refeição")

  const push = (state: MachineState, start: number, end: number, extra: Partial<StateEvent> = {}) => {
    if (end <= start) return
    events.push({ machineId: machine.id, state, start: iso(start), end: iso(end), reasonId: null, ...extra })
  }

  let t = SHIFT_START_MS
  while (t < currentStart) {
    // pausa de refeição planejada
    if (t >= BREAK_START_MS && t < BREAK_END_MS) {
      const end = Math.min(BREAK_END_MS, currentStart)
      push("PLANNED_STOP", t, end, { reasonId: breakReason })
      t = end
      continue
    }
    const runLen = between(r, 14, 70 - p.stopRate * 40) * MIN
    let end = Math.min(t + runLen, currentStart)
    if (t < BREAK_START_MS && end > BREAK_START_MS) end = BREAK_START_MS
    push("RUNNING", t, end)
    t = end
    if (t >= currentStart || t === BREAK_START_MS) continue

    // uma parada
    const roll = r()
    let state: MachineState = "STOPPED"
    let len = between(r, 1.5, 14) * MIN
    let extra: Partial<StateEvent> = {}
    if (roll < 0.28) {
      state = "FAULT"
      len = between(r, 3, 22) * MIN
      const code = pick(r, Object.keys(faultTexts).map(Number))
      extra = { faultCode: code, reasonId: pick(r, leaves)?.id ?? null }
    } else if (roll < 0.36) {
      state = "SETUP"
      len = between(r, 18, 35) * MIN
      extra = { reasonId: reasonByName(machine.clientId, "Troca de produto / cor") }
    } else if (roll < 0.5) {
      // micro-parada (abaixo do limite): fica sem motivo
      len = between(r, 0.3, 0.9) * MIN
    } else {
      extra = { reasonId: pick(r, leaves)?.id ?? null }
    }
    let stopEnd = Math.min(t + len, currentStart)
    if (t < BREAK_START_MS && stopEnd > BREAK_START_MS) stopEnd = BREAK_START_MS
    push(state, t, stopEnd, extra)
    t = stopEnd
  }

  // deixa as 2 últimas paradas não planejadas (≥ 1 min) sem classificação: viram pendências do operador
  let unclassified = 0
  for (let i = events.length - 1; i >= 0 && unclassified < 2; i--) {
    const e = events[i]
    const dur = Date.parse(e.end) - Date.parse(e.start)
    if (e.state === "STOPPED" && dur >= MIN) {
      e.reasonId = null
      unclassified++
    }
  }

  // estado atual (em aberto até "agora")
  push(p.current, currentStart, NOW_MS, {
    faultCode: p.current === "FAULT" ? p.faultCode : undefined,
    reasonId:
      p.current === "PLANNED_STOP"
        ? reasonByName(machine.clientId, "Manutenção preventiva")
        : p.current === "SETUP"
          ? reasonByName(machine.clientId, "Troca de molde / ferramenta")
          : null,
  })
  return events
}

const timelines = new Map<string, StateEvent[]>(machines.map((m) => [m.id, buildTimeline(m)]))

export function timelineFor(machineId: string): StateEvent[] {
  return timelines.get(machineId) ?? []
}

// ---------------------------------------------------------------------------
// OEE do turno corrente a partir da timeline
// ---------------------------------------------------------------------------
function idealCycleFor(machine: Machine) {
  const prod = products.find((p) => p.idealCycles.some((c) => c.machineId === machine.id))
  return {
    product: prod,
    idealCycleS: prod?.idealCycles.find((c) => c.machineId === machine.id)?.idealCycleS ?? machine.idealCycleS,
  }
}

function shiftStats(machine: Machine) {
  const p = profileOf(machine.id)
  const events = timelineFor(machine.id)
  let plannedStopS = 0
  let runS = 0
  for (const e of events) {
    const d = (Date.parse(e.end) - Date.parse(e.start)) / 1000
    if (e.state === "PLANNED_STOP") plannedStopS += d
    else if (e.state === "RUNNING") runS += d
    else if (e.state === "STOPPED" && d < machine.microStopThresholdS) runS += d // micro-parada = performance
  }
  const elapsedS = (NOW_MS - SHIFT_START_MS) / 1000
  const plannedS = Math.max(0, elapsedS - plannedStopS)
  const { idealCycleS, product } = idealCycleFor(machine)
  const total = p.noData ? 0 : Math.round((runS * p.perf) / idealCycleS)
  const reject = Math.round(total * (1 - p.quality))
  // docs/07 passo 7: sem tempo planejado (ou sem dados) o indicador é "sem dado" (NaN → exibido como "—"), nunca 0%.
  const availability = p.noData || plannedS <= 0 ? Number.NaN : runS / plannedS
  const performance = p.noData || runS <= 0 ? Number.NaN : (total * idealCycleS) / runS
  const quality = p.noData || total <= 0 ? Number.NaN : (total - reject) / total
  const fullPlannedS = (SHIFT_END_MS - SHIFT_START_MS) / 1000 - (BREAK_END_MS - BREAK_START_MS) / 1000
  return {
    total,
    reject,
    target: Math.round(fullPlannedS / idealCycleS),
    product,
    oee: { availability, performance, quality, oee: availability * performance * quality } satisfies OeeValues,
    basis: { plannedS, runS, total, good: total - reject, idealS: total * idealCycleS, goodIdealS: (total - reject) * idealCycleS },
  }
}

const lives = new Map<string, MachineLive>(
  machines.map((m) => {
    const p = profileOf(m.id)
    const s = shiftStats(m)
    const live: MachineLive = {
      machineId: m.id,
      state: p.current,
      stateSince: iso(NOW_MS - p.sinceMin * MIN),
      faultCode: p.faultCode,
      faultText: p.faultCode ? faultTexts[p.faultCode] : undefined,
      productCode: s.product?.code ?? "—",
      productName: s.product?.name ?? "Sem produto",
      countShift: s.total,
      rejectShift: s.reject,
      targetShift: s.target,
      shift: s.oee,
      basis: p.noData ? undefined : s.basis,
      lastUpdate: p.stale ? iso(NOW_MS - (p.noData ? 0 : p.sinceMin) * MIN) : iso(NOW_MS - 4_000),
      stale: Boolean(p.stale),
    }
    return [m.id, live]
  }),
)

export function liveFor(machineId: string): MachineLive | undefined {
  return lives.get(machineId)
}

// ---------------------------------------------------------------------------
// Produção por hora (turno corrente)
// ---------------------------------------------------------------------------
export function hourlyFor(machineId: string): HourlyProduction[] {
  const machine = machines.find((m) => m.id === machineId)
  if (!machine) return []
  const p = profileOf(machineId)
  const { idealCycleS } = idealCycleFor(machine)
  const events = timelineFor(machineId)
  const out: HourlyProduction[] = []
  for (let h = SHIFT_START_MS; h < SHIFT_END_MS; h += 60 * MIN) {
    const hEnd = h + 60 * MIN
    let runS = 0
    let plannedStopS = 0
    for (const e of events) {
      const s = Math.max(h, Date.parse(e.start))
      const en = Math.min(hEnd, Date.parse(e.end))
      if (en <= s) continue
      if (e.state === "RUNNING") runS += (en - s) / 1000
      if (e.state === "PLANNED_STOP") plannedStopS += (en - s) / 1000
    }
    const total = h < NOW_MS ? Math.round((runS * p.perf) / idealCycleS) : 0
    out.push({
      hour: iso(h),
      total,
      reject: Math.round(total * (1 - p.quality)),
      target: Math.round((3600 - plannedStopS) / idealCycleS),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Histórico diário de OEE (últimos N dias, até ontem)
// ---------------------------------------------------------------------------
export function dailyOeeFor(machineId: string, days = 30): DailyOee[] {
  const p = profileOf(machineId)
  if (p.noData) return []
  const r = seededRandom(`daily:${machineId}`)
  const out: DailyOee[] = []
  const today = Date.parse("2026-11-11T12:00:00.000Z")
  for (let i = days; i >= 1; i--) {
    const d = new Date(today - i * 24 * 60 * MIN)
    const availability = Math.min(0.99, Math.max(0.55, 0.9 - p.stopRate * 0.25 + between(r, -0.08, 0.06)))
    const performance = Math.min(0.99, Math.max(0.6, p.perf + between(r, -0.06, 0.04)))
    const quality = Math.min(0.999, Math.max(0.9, p.quality + between(r, -0.015, 0.006)))
    out.push({
      date: d.toISOString().slice(0, 10),
      availability,
      performance,
      quality,
      oee: availability * performance * quality,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Pareto de paradas (últimos 7 dias) por conjunto de máquinas
// ---------------------------------------------------------------------------
export function paretoFor(machineIds: string[]): ParetoItem[] {
  const acc = new Map<string, ParetoItem>()
  for (const id of machineIds) {
    const machine = machines.find((m) => m.id === id)
    if (!machine || profileOf(id).noData) continue
    const r = seededRandom(`pareto:${id}`)
    const reasons = downtimeReasons.filter((x) => x.clientId === machine.clientId && x.parentId !== null)
    for (const reason of reasons) {
      const weight = reason.category === "planned" ? 0.4 : reason.category === "setup" ? 0.8 : 1
      const minutes = Math.round(between(r, 0, 180) * weight * (0.5 + profileOf(id).stopRate))
      const occurrences = Math.max(1, Math.round(minutes / between(r, 4, 25)))
      if (minutes < 5) continue
      const cur = acc.get(reason.id) ?? { reasonId: reason.id, reasonName: reason.name, category: reason.category, minutes: 0, occurrences: 0 }
      cur.minutes += minutes
      cur.occurrences += occurrences
      acc.set(reason.id, cur)
    }
  }
  return [...acc.values()].sort((a, b) => b.minutes - a.minutes)
}

// ---------------------------------------------------------------------------
// Histórico por turno (relatórios): últimos N dias, até ontem
// ---------------------------------------------------------------------------
export interface ShiftOeeRow extends OeeValues {
  date: string
  shiftName: string
  machineId: string
  plannedMin: number
  runMin: number
  total: number
  good: number
  reject: number
}

export function shiftHistoryFor(machineIds: string[], days = 14): ShiftOeeRow[] {
  const rows: ShiftOeeRow[] = []
  const today = Date.parse("2026-11-11T12:00:00.000Z")
  for (const id of machineIds) {
    const machine = machines.find((m) => m.id === id)
    const p = profileOf(id)
    if (!machine || p.noData) continue
    const r = seededRandom(`shifts:${id}`)
    const { idealCycleS } = idealCycleFor(machine)
    for (let i = days; i >= 1; i--) {
      const date = new Date(today - i * 24 * 60 * MIN).toISOString().slice(0, 10)
      for (const shiftName of ["1º turno", "2º turno"]) {
        const plannedMin = 450
        const availability = Math.min(0.99, Math.max(0.5, 0.9 - p.stopRate * 0.25 + between(r, -0.1, 0.06)))
        const performance = Math.min(0.99, Math.max(0.6, p.perf + between(r, -0.07, 0.04)))
        const quality = Math.min(0.999, Math.max(0.9, p.quality + between(r, -0.02, 0.006)))
        const runMin = Math.round(plannedMin * availability)
        const total = Math.round((runMin * 60 * performance) / idealCycleS)
        const good = Math.round(total * quality)
        rows.push({
          date,
          shiftName,
          machineId: id,
          plannedMin,
          runMin,
          total,
          good,
          reject: total - good,
          availability,
          performance,
          quality,
          oee: availability * performance * quality,
        })
      }
    }
  }
  return rows
}
