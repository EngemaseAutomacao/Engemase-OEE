/** Tipos da visão do cliente sobre o acesso remoto (VPN de manutenção, docs/12). Tudo serializável. */
import type { GatewayStatus, RemoteAccessPolicy, RemoteAccessStatus } from "@/lib/mock"

export type PolicyMode = RemoteAccessPolicy["mode"]

export interface RemoteSessionVM {
  id: string
  gatewayId: string
  gatewayName: string
  hostname: string
  unitName: string
  gatewayStatus: GatewayStatus
  requestedBy: string
  requestedByRole: string
  /** Ex.: "2 sessões anteriores neste cliente · última em 04/11". */
  requesterHistory: string
  reason: string
  ticket: string
  durationMin: number
  /** Duração pedida originalmente (para mostrar "aprovado com alterações"). */
  requestedDurationMin: number
  ssh: boolean
  plc: { deviceName: string; target: string } | null
  /** Pedido original incluía CLP (mesmo que tenha sido removido na aprovação). */
  requestedPlc: { deviceName: string; target: string } | null
  status: RemoteAccessStatus
  requestedMs: number
  decidedBy: string | null
  decidedMs: number | null
  startedMs: number | null
  expiresMs: number | null
  endedMs: number | null
  endedReason: string | null
  connection: "direct" | "relay" | null
  bytes: number | null
  onsiteContact: string | null
  changes: string[]
}

export interface PolicyWindow {
  day: number
  start: string
  end: string
}

export interface PolicyVM {
  mode: PolicyMode
  maxDurationMin: number
  idleTimeoutMin: number
  allowPlcForward: boolean
  requireOnsiteContact: boolean
  onsiteContactId: string | null
  windows: PolicyWindow[]
}

export interface PersonVM {
  id: string
  name: string
  role: string
}

export interface RemoteData {
  clientName: string
  clientSlug: string
  me: { name: string; isPlatform: boolean }
  approvers: string[]
  contacts: PersonVM[]
  sessions: RemoteSessionVM[]
  policy: PolicyVM
  /** "Agora" do protótipo (MOCK_NOW) em ms. */
  nowMs: number
}
