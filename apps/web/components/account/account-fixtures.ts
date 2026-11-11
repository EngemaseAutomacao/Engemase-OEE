/**
 * Dados ILUSTRATIVOS da conta do usuário logado que ainda não existem em `lib/mock`
 * (inscrições de push e sessões de login). Tudo relativo a MOCK_NOW, sem relógio do sistema.
 * Quando a camada real existir: `push_subscription` e as sessões do Better Auth (docs/13 e docs/15).
 */
import { MOCK_NOW } from "@/lib/mock"

const now = Date.parse(MOCK_NOW)
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString()

export type DeviceKind = "laptop" | "desktop" | "phone" | "tablet"

export interface PushDevice {
  id: string
  name: string
  kind: DeviceKind
  browser: string
  os: string
  createdAt: string
  lastSeenAt: string
  status: "active" | "expired"
}

export interface LoginSession {
  id: string
  kind: DeviceKind
  browser: string
  os: string
  place: string
  ip: string
  startedAt: string
  lastActiveAt: string
  current: boolean
}

/** Aparelhos da Ana Ribeiro inscritos para receber push. */
export function getMyPushDevices(): PushDevice[] {
  return [
    { id: "psh_01", name: "Notebook Dell Latitude", kind: "laptop", browser: "Chrome 142", os: "Windows 11", createdAt: "2026-09-03T12:10:00.000Z", lastSeenAt: minutesAgo(1), status: "active" },
    { id: "psh_02", name: "Galaxy S23", kind: "phone", browser: "Chrome", os: "Android 15", createdAt: "2026-09-03T12:32:00.000Z", lastSeenAt: minutesAgo(38), status: "active" },
    { id: "psh_03", name: "MacBook Air (casa)", kind: "laptop", browser: "Safari 19", os: "macOS", createdAt: "2026-10-02T22:15:00.000Z", lastSeenAt: minutesAgo(60 * 24 * 6 + 95), status: "active" },
    { id: "psh_04", name: "iPad da sala de reuniões", kind: "tablet", browser: "App na Tela de Início", os: "iPadOS 18", createdAt: "2026-08-14T15:00:00.000Z", lastSeenAt: minutesAgo(60 * 24 * 41), status: "expired" },
  ]
}

/** Sessões de login abertas da Ana Ribeiro (a primeira é a deste navegador). */
export function getMySessions(): LoginSession[] {
  return [
    { id: "ses_01", kind: "laptop", browser: "Chrome 142", os: "Windows 11", place: "Joinville, SC", ip: "177.84.•••.12", startedAt: "2026-11-11T11:05:00.000Z", lastActiveAt: MOCK_NOW, current: true },
    { id: "ses_02", kind: "phone", browser: "Chrome", os: "Android 15", place: "Joinville, SC", ip: "189.4.•••.201", startedAt: "2026-11-09T10:20:00.000Z", lastActiveAt: minutesAgo(38), current: false },
    { id: "ses_03", kind: "desktop", browser: "Edge 142", os: "Windows 10", place: "Caxias do Sul, RS", ip: "200.180.•••.77", startedAt: "2026-11-06T17:40:00.000Z", lastActiveAt: minutesAgo(60 * 24 * 2 + 210), current: false },
    { id: "ses_04", kind: "laptop", browser: "Safari 19", os: "macOS", place: "Florianópolis, SC", ip: "45.170.•••.9", startedAt: "2026-10-30T23:02:00.000Z", lastActiveAt: minutesAgo(60 * 24 * 6 + 95), current: false },
  ]
}
