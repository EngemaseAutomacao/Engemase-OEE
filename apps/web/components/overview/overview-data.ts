/**
 * Monta os dados (serializáveis) da Visão geral a partir dos dados da tela (`@/lib/data/cliente`: banco
 * ou simulado). Função pura: o "agora" vem dos dados, nunca do relógio do sistema.
 */
import type { ClienteDados } from "@/lib/data/cliente/tipos"
import { DEFAULT_TZ, seededRandom, type MachineState } from "@/lib/mock"
import { duration, initials, time } from "@/lib/format"
import { STATE_META } from "@/lib/states"

const MIN = 60_000
/** Meta de OEE quando nenhuma linha tem meta cadastrada (L4 do docs/17). */
export const OEE_TARGET = 0.75

export function buildOverview(data: ClienteDados) {
  const slug = data.client.slug
  const clientId = data.client.id
  const NOW = data.nowMs
  const shift = data.shiftWindow()
  const SHIFT_START = shift.start
  const SHIFT_END = shift.end
  const getDailyOee = data.getDailyOee
  const getDowntimeReason = data.getDowntimeReason
  const getHourlyProduction = data.getHourlyProduction
  const getLine = data.getLine
  const getTimeline = data.getTimeline
  const machines = data.getMachinesWithLive()
  const agg = data.aggregateOee(machines)
  const withData = machines.filter((m) => m.live && !m.live.stale && m.live.countShift > 0)

  // ---- KPIs ---------------------------------------------------------------
  const daily = withData.map((m) => getDailyOee(m.id, 30))
  const yesterdayOee = daily.length ? daily.reduce((s, d) => s + (d.at(-1)?.oee ?? 0), 0) / daily.length : 0
  const oeeDelta = yesterdayOee > 0 && agg.oee > 0 ? ((agg.oee - yesterdayOee) / yesterdayOee) * 100 : null

  const total = machines.reduce((s, m) => s + (m.live?.countShift ?? 0), 0)
  const reject = machines.reduce((s, m) => s + (m.live?.rejectShift ?? 0), 0)
  const good = total - reject
  // Variação de peças boas: só no protótipo (no banco, a comparação com o turno de ontem fica para o relatório).
  const r = seededRandom(`overview:${clientId}`)
  const goodDelta = data.fonte === "simulado" && good > 0 ? Math.round((r() * 15 - 6) * 10) / 10 : null

  const running = machines.filter((m) => m.live?.state === "RUNNING").length

  // ---- Fluxo por estado (setas) ------------------------------------------
  const order: MachineState[] = ["RUNNING", "STOPPED", "FAULT", "SETUP", "PLANNED_STOP", "NO_COMM"]
  const stages = order
    .map((state) => {
      const list = machines.filter((m) => (m.live?.state ?? "NO_COMM") === state)
      const minutes = list.reduce((s, m) => s + (m.live ? (NOW - Date.parse(m.live.stateSince)) / MIN : 0), 0)
      const summary =
        state === "RUNNING"
          ? `${good.toLocaleString("pt-BR")} peças boas`
          : list.length
            ? `${Math.round(minutes)} min acumulados`
            : "—"
      return {
        key: state,
        title: state === "NO_COMM" ? "Sem sinal" : state === "PLANNED_STOP" ? "Planejada" : STATE_META[state].short,
        color: STATE_META[state].hex,
        textColor: state === "STOPPED" ? "#3d2a00" : undefined,
        count: list.length,
        summary,
        items: list.map((m) => ({
          id: m.id,
          name: m.name,
          hint: m.live && !m.live.stale ? `há ${duration((NOW - Date.parse(m.live.stateSince)) / 1000)}` : (getLine(m.lineId)?.name ?? ""),
          href: `/${slug}/maquinas/${m.id}`,
          initials: initials(m.name.replace(/\d+/g, "")) + (m.code.match(/\d+/)?.[0] ?? ""),
        })),
      }
    })
    .filter((s) => s.count > 0 || s.key === "RUNNING" || s.key === "STOPPED" || s.key === "FAULT")

  // ---- Meta de OEE (mês) --------------------------------------------------
  const monthStart = `${new Date(NOW).toLocaleDateString("en-CA", { timeZone: DEFAULT_TZ }).slice(0, 7)}-01`
  const monthDays = daily.length ? daily[0].filter((d) => d.date >= monthStart).map((d) => d.date) : []
  const monthOee = monthDays.length
    ? monthDays.reduce((s, date) => s + daily.reduce((a, d) => a + (d.find((x) => x.date === date)?.oee ?? 0), 0) / daily.length, 0) / monthDays.length
    : 0
  const last12 = daily.length
    ? daily[0].slice(-12).map((d) => ({
        date: d.date,
        oee: daily.reduce((a, dd) => a + (dd.find((x) => x.date === d.date)?.oee ?? 0), 0) / daily.length,
      }))
    : []

  // ---- Tempo do turno por estado (rosca) ---------------------------------
  const minutesByState: Record<MachineState, number> = { RUNNING: 0, STOPPED: 0, FAULT: 0, SETUP: 0, PLANNED_STOP: 0, NO_COMM: 0 }
  for (const m of machines) {
    for (const e of getTimeline(m.id)) {
      minutesByState[e.state] += (Date.parse(e.end) - Date.parse(e.start)) / MIN
    }
  }
  const donut = order
    .map((s) => ({ label: s === "NO_COMM" ? "Sem sinal" : s === "STOPPED" ? "Parada" : s === "PLANNED_STOP" ? "Planejada" : STATE_META[s].short, value: Math.round(minutesByState[s]), color: STATE_META[s].hex }))
    .filter((s) => s.value > 0)
  const donutTotal = donut.reduce((s, x) => s + x.value, 0)

  // ---- Ranking -----------------------------------------------------------
  const ranking = withData
    .map((m) => ({
      id: m.id,
      name: m.name,
      line: getLine(m.lineId)?.name ?? "",
      oee: m.live!.shift.oee,
      state: m.live!.state,
      count: m.live!.countShift,
      href: `/${slug}/maquinas/${m.id}`,
      initials: initials(m.name.replace(/\d+/g, "")) + (m.code.match(/\d+/)?.[0] ?? ""),
    }))
    .sort((a, b) => b.oee - a.oee)

  // ---- Paradas para classificar -----------------------------------------
  const pending = machines
    .flatMap((m) =>
      getTimeline(m.id)
        .filter((e) => (e.state === "STOPPED" || e.state === "FAULT") && !e.reasonId && Date.parse(e.end) - Date.parse(e.start) >= 60_000)
        .map((e) => ({
          id: `${m.id}-${e.start}`,
          machine: m.name,
          machineId: m.id,
          state: e.state,
          start: e.start,
          time: time(e.start),
          duration: duration((Date.parse(e.end) - Date.parse(e.start)) / 1000),
          open: Date.parse(e.end) >= NOW,
          href: `/${slug}/operador/${m.id}`,
          detail: `/${slug}/maquinas/${m.id}`,
        })),
    )
    .sort((a, b) => b.start.localeCompare(a.start))

  // ---- Linha do tempo do turno ------------------------------------------
  type Ev = { id: string; kind: "start" | "fault" | "setup" | "break" | "gateway" | "now"; title: string; subtitle: string; at: number }
  const events: Ev[] = [{ id: "start", kind: "start", title: "Turno iniciado", subtitle: `${machines.length} máquinas`, at: Date.parse(SHIFT_START) }]
  const allEvents = machines.flatMap((m) => getTimeline(m.id).map((e) => ({ ...e, name: m.name })))
  const firstFault = allEvents.filter((e) => e.state === "FAULT").sort((a, b) => a.start.localeCompare(b.start))[0]
  if (firstFault)
    events.push({ id: "fault", kind: "fault", title: "Falha", subtitle: `${firstFault.name}${firstFault.faultCode ? ` · ${firstFault.faultCode}` : ""}`, at: Date.parse(firstFault.start) })
  const firstSetup = allEvents.filter((e) => e.state === "SETUP").sort((a, b) => a.start.localeCompare(b.start))[0]
  if (firstSetup)
    events.push({
      id: "setup",
      kind: "setup",
      title: "Setup",
      subtitle: `${firstSetup.name}${firstSetup.reasonId ? ` · ${getDowntimeReason(firstSetup.reasonId)?.name ?? ""}` : ""}`,
      at: Date.parse(firstSetup.start),
    })
  const firstBreak = shift.breaks.find((b) => Date.parse(b.start) <= NOW)
  if (firstBreak)
    events.push({
      id: "break",
      kind: "break",
      title: "Pausa programada",
      subtitle: `Parada planejada · ${duration((Date.parse(firstBreak.end) - Date.parse(firstBreak.start)) / 1000)}`,
      at: Date.parse(firstBreak.start),
    })
  const downGw = data.gateways.find((g) => g.status === "offline" && g.lastSeen)
  if (downGw) events.push({ id: "gw", kind: "gateway", title: "Gateway offline", subtitle: downGw.name, at: Date.parse(downGw.lastSeen!) })
  events.push({ id: "now", kind: "now", title: "Agora", subtitle: `OEE ${(agg.oee * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, at: NOW })
  const timeline = events
    .sort((a, b) => a.at - b.at)
    .slice(-6)
    .map((e) => ({ id: e.id, kind: e.kind, title: e.title, subtitle: e.subtitle, time: time(new Date(e.at).toISOString()) }))

  // ---- Previsão de produção (peças boas acumuladas) ----------------------
  const hours = withData.length ? getHourlyProduction(withData[0].id).map((h) => h.hour) : []
  const qualityRate = total > 0 ? good / total : 1
  let acc = 0
  const actual: (number | null)[] = []
  const labels: string[] = []
  for (const h of hours) {
    const hourTotal = withData.reduce((s, m) => s + (getHourlyProduction(m.id).find((x) => x.hour === h)?.total ?? 0), 0)
    labels.push(time(h))
    if (Date.parse(h) < NOW) {
      acc += Math.round(hourTotal * qualityRate)
      actual.push(acc)
    } else actual.push(null)
  }
  const elapsedH = (NOW - Date.parse(SHIFT_START)) / 3_600_000
  const remainingH = Math.max(0, (Date.parse(SHIFT_END) - NOW) / 3_600_000)
  const rate = elapsedH > 0 ? good / elapsedH : 0
  const predicted = Math.round(good + rate * remainingH)
  const best = Math.round(good + rate * 1.12 * remainingH)
  const target = machines.reduce((s, m) => s + (m.live?.targetShift ?? 0), 0)
  const projection = hours.map((h) => {
    const t = Date.parse(h) + 3_600_000
    if (t < NOW) return null
    return Math.round(good + rate * ((t - NOW) / 3_600_000))
  })
  // emenda a projeção no último ponto real
  const lastReal = actual.findLastIndex((v) => v !== null)
  if (lastReal >= 0) projection[lastReal] = actual[lastReal]

  const stopEvents = allEvents.filter((e) => e.state === "STOPPED" || e.state === "FAULT")
  const stopMinutes = stopEvents.reduce((acc, e) => acc + (Date.parse(e.end) - Date.parse(e.start)) / MIN, 0)
  const longest = stopEvents.reduce<(typeof stopEvents)[number] | null>((best, e) => {
    const len = Date.parse(e.end) - Date.parse(e.start)
    return !best || len > Date.parse(best.end) - Date.parse(best.start) ? e : best
  }, null)
  const micro = stopEvents.filter((e) => Date.parse(e.end) - Date.parse(e.start) < 60_000).length
  const stopSummary = {
    count: stopEvents.length,
    minutes: Math.round(stopMinutes),
    micro,
    longest: longest ? `${longest.name} · ${duration((Date.parse(longest.end) - Date.parse(longest.start)) / 1000)}` : "—",
  }

  return {
    stopSummary,
    kpis: { oee: agg.oee, oeeDelta, good, goodDelta, reject, running, total: machines.length, withData: agg.machinesWithData },
    stages,
    target: { monthOee, target: data.oeeTarget ?? OEE_TARGET, last12 },
    shift: { name: shift.name, start: shift.start, end: shift.end, emAndamento: shift.emAndamento },
    donut,
    donutTotal,
    ranking,
    pending,
    timeline,
    forecast: { labels, actual, projection, predicted, best, target, delta: goodDelta },
  }
}
