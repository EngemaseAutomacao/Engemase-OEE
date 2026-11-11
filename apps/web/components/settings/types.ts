/**
 * Tipos serializáveis que as páginas de Configurações (usuários, terminais, aparência e auditoria)
 * montam no servidor a partir de `@/lib/mock` e entregam aos componentes de cliente.
 */
import type { ClientRole, UserStatus } from "@/lib/mock"

export interface SettingsUnit {
  id: string
  name: string
}

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------
export interface ClientUserRow {
  id: string
  name: string
  email: string | null
  username: string | null
  role: ClientRole
  unitScope: "all" | string[]
  status: UserStatus
  twoFactor: boolean
  /** "há 2h 10min", "nunca" */
  lastLogin: string
  lastLoginAt: string | null
  /** Quantos outros clientes a pessoa acessa (ex.: consultor). */
  otherClients: number
}

export type EngemaseAccessKind = "super_admin" | "support_grant" | "assignment"

export interface EngemaseAccessRow {
  id: string
  person: string
  email: string
  kind: EngemaseAccessKind
  roleLabel: string
  reason: string
  ticket: string | null
  /** "Todas as unidades" ou nomes */
  units: string
  startLabel: string
  endLabel: string | null
  status: "permanent" | "active" | "ended"
  /** "restam 2h 58min" */
  remaining: string | null
}

// ---------------------------------------------------------------------------
// Terminais
// ---------------------------------------------------------------------------
export type TerminalKind = "andon_tv" | "operator_tablet"
export type TerminalTheme = "dark" | "light" | "system"

export interface TerminalLine {
  id: string
  unitId: string
  name: string
  code: string
}

export interface TerminalMachine {
  id: string
  unitId: string
  lineId: string
  name: string
  code: string
}

export interface TerminalRow {
  id: string
  unitId: string
  name: string
  kind: TerminalKind
  lineIds: string[]
  machineIds: string[]
  theme: TerminalTheme
  status: "online" | "offline" | "pending"
  pairedBy: string | null
  pairedAt: string | null
  lastSeen: string
  pairingCode: string | null
}

// ---------------------------------------------------------------------------
// Aparência
// ---------------------------------------------------------------------------
export type SidebarMode = "neutral" | "brand-dark" | "light"

export interface BrandTokens {
  light: { primary: string; ring: string; sidebar: string }
  dark: { primary: string; ring: string; sidebar: string }
}

export interface BrandingInitial {
  displayName: string
  shortName: string
  preset: string | null
  brandColor: string
  sidebarMode: SidebarMode
  /** Tokens já gravados (quando o cliente tem identidade própria). */
  tokens: BrandTokens | null
  custom: boolean
}

export interface PreviewMachine {
  name: string
  line: string
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------
export type AuditActorKind = "client" | "engemase" | "support" | "terminal" | "system"
export type AuditCategory = "config" | "users" | "production" | "engemase" | "remote" | "terminals" | "branding"

export interface AuditRow {
  id: string
  at: string
  dayKey: string
  dayLabel: string
  time: string
  dateTime: string
  actor: string
  actorKind: AuditActorKind
  actorRole: string | null
  impersonatedBy: string | null
  action: string
  actionLabel: string
  category: AuditCategory
  entity: string
  entityName: string
  details: string | null
  ticket: string | null
}
