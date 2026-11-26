/**
 * Leitura do banco para as telas do console e dos cadastros (W8): lê, sob a RLS de cada cliente
 * (`withTenant`), o cadastro inteiro (unidades, linhas, máquinas, gateways, CLPs, tags, pessoas,
 * auditoria recente) e converte para os tipos do protótipo (`Foto`), que o `repositorioEmMemoria`
 * serve às telas.
 *
 * - Cadastro de UM cliente (`fotoDoCliente`): o `TenantContext` de `requireTenant`, com o escopo da
 *   pessoa (D11) aplicado aqui.
 * - Console (`fotoDaPlataforma`): todos os clientes (`app.cron_organizations()` + um `withTenant` por
 *   cliente) e a equipe Engemase (banco do Better Auth). Só para quem passou em `exigirEquipe`.
 */
import type { ModbusAddress } from "@engemase/contracts"
import {
  area,
  auditLog,
  clientAccount,
  device,
  gateway,
  gatewayDeviceStatus,
  gatewayMachine,
  line,
  machine,
  member,
  memberAccess,
  memberMachine,
  memberUnit,
  organization,
  PLATFORM_ROLES,
  serialBus,
  shift,
  tag,
  unit,
  user,
  withTenant,
} from "@engemase/db"
import { desc, inArray, isNull, sql } from "drizzle-orm"
import { PLAN_DEFAULTS } from "@/components/admin/labels"
import type {
  Area,
  AuditEntry,
  Client,
  ClientPlan,
  ClientRole,
  ConfigAccess,
  DataType,
  Device,
  Gateway,
  Line,
  Machine,
  MemberScope,
  ModbusArea,
  PlatformRole,
  Shift,
  StateMode,
  Tag,
  TagRole,
  Unit,
  User,
} from "@/lib/mock"
import { hasPermission, type Scope, type TenantContext } from "@/lib/server/access/context"
import type { CurrentSession } from "@/lib/server/auth/session"
import { getAuthDb } from "@/lib/server/db"
import { type GatewayDb, type GatewayTx, queryRows } from "@/lib/server/gateway/types"
import type { Foto } from "./repositorio"

/** Gateway sem /sync há mais que isto aparece offline (mesmo limite do alerta, L17). */
export const OFFLINE_APOS_MS = 6 * 60 * 1000

/** Dados que ficam em `organization.metadata` (JSON) e não têm coluna própria. */
export interface MetadadosCliente {
  legalName?: string
  cnpj?: string
  city?: string
  state?: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
}

export function lerMetadados(raw: string | null): MetadadosCliente {
  if (raw === null || raw === "") return {}
  try {
    const v: unknown = JSON.parse(raw)
    return v !== null && typeof v === "object" ? (v as MetadadosCliente) : {}
  } catch {
    return {}
  }
}

const PLANOS: readonly ClientPlan[] = ["starter", "pro", "enterprise"]
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

// ---------------------------------------------------------------------------
// Leitura de um cliente (dentro de withTenant)
// ---------------------------------------------------------------------------

interface Bruto {
  org: { id: string; name: string; slug: string; metadata: string | null; createdAt: Date }
  account: { status: string; plan: string | null; limits: Record<string, number | undefined>; createdAt: Date } | null
  units: (typeof unit.$inferSelect)[]
  areas: (typeof area.$inferSelect)[]
  lines: (typeof line.$inferSelect)[]
  machines: (typeof machine.$inferSelect)[]
  gateways: (typeof gateway.$inferSelect)[]
  buses: (typeof serialBus.$inferSelect)[]
  devices: (typeof device.$inferSelect)[]
  deviceStatus: (typeof gatewayDeviceStatus.$inferSelect)[]
  links: { gatewayId: string; machineId: string }[]
  tags: (typeof tag.$inferSelect)[]
  people: {
    userId: string
    name: string
    email: string
    emailVerified: boolean
    twoFactor: boolean
    accessId: string | null
    role: string | null
    scope: string | null
    active: boolean | null
  }[]
  memberUnits: { accessId: string; unitId: string }[]
  memberMachines: { accessId: string; machineId: string }[]
  audit: (typeof auditLog.$inferSelect)[]
  shifts: (typeof shift.$inferSelect)[]
}

async function lerBruto(tx: GatewayTx, auditLimit: number): Promise<Bruto | null> {
  const [org] = await tx
    .select({ id: organization.id, name: organization.name, slug: organization.slug, metadata: organization.metadata, createdAt: organization.createdAt })
    .from(organization)
    .limit(1)
  if (org === undefined) return null
  const [account] = await tx
    .select({ status: clientAccount.status, plan: clientAccount.plan, limits: clientAccount.limits, createdAt: clientAccount.createdAt })
    .from(clientAccount)
    .limit(1)
  const [units, areas, lines, machines, gateways, buses, devices, deviceStatus, links, tags, people, memberUnits, memberMachines, audit, shifts] =
    await Promise.all([
      tx.select().from(unit).where(isNull(unit.deletedAt)).orderBy(unit.name),
      tx.select().from(area).where(isNull(area.deletedAt)).orderBy(area.name),
      tx.select().from(line).where(isNull(line.deletedAt)).orderBy(line.sortOrder, line.name),
      tx.select().from(machine).where(isNull(machine.deletedAt)).orderBy(machine.name),
      tx.select().from(gateway).where(isNull(gateway.deletedAt)).orderBy(gateway.name),
      tx.select().from(serialBus),
      tx.select().from(device).where(isNull(device.deletedAt)).orderBy(device.id),
      tx.select().from(gatewayDeviceStatus),
      tx.select({ gatewayId: gatewayMachine.gatewayId, machineId: gatewayMachine.machineId }).from(gatewayMachine),
      tx.select().from(tag).where(isNull(tag.deletedAt)).orderBy(tag.id),
      tx
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          twoFactor: user.twoFactorEnabled,
          accessId: memberAccess.id,
          role: memberAccess.role,
          scope: memberAccess.scope,
          active: memberAccess.active,
        })
        .from(member)
        .innerJoin(user, sql`${user.id} = ${member.userId}`)
        .leftJoin(memberAccess, sql`${memberAccess.memberId} = ${member.id}`)
        .orderBy(user.name),
      tx.select({ accessId: memberUnit.memberAccessId, unitId: memberUnit.unitId }).from(memberUnit),
      tx.select({ accessId: memberMachine.memberAccessId, machineId: memberMachine.machineId }).from(memberMachine),
      tx.select().from(auditLog).orderBy(desc(auditLog.at)).limit(auditLimit),
      tx.select().from(shift).where(isNull(shift.deletedAt)).orderBy(shift.startTime),
    ])
  return {
    org,
    account: account ?? null,
    units,
    areas,
    lines,
    machines,
    gateways,
    buses,
    devices,
    deviceStatus,
    links,
    tags,
    people,
    memberUnits,
    memberMachines,
    audit,
    shifts,
  }
}

// ---------------------------------------------------------------------------
// Conversão para os tipos do protótipo
// ---------------------------------------------------------------------------

function cliente(b: Bruto): Client {
  const meta = lerMetadados(b.org.metadata)
  const plan = PLANOS.includes(b.account?.plan as ClientPlan) ? (b.account?.plan as ClientPlan) : "pro"
  const limits = b.account?.limits ?? { machines: 0 }
  const padrao = PLAN_DEFAULTS[plan]
  const status = b.account?.status
  return {
    id: b.org.id,
    slug: b.org.slug,
    name: b.org.name,
    legalName: meta.legalName ?? b.org.name,
    cnpj: meta.cnpj ?? "",
    city: meta.city ?? "",
    state: meta.state ?? "",
    status: status === "active" || status === "onboarding" ? status : "suspended",
    plan,
    limits: {
      machines: limits.machines ?? 0,
      gateways: limits.gateways ?? padrao.gateways,
      users: limits.users ?? padrao.users,
      retentionMonths: limits.retentionMonths ?? padrao.retentionMonths,
    },
    contactName: meta.contactName ?? "",
    contactEmail: meta.contactEmail ?? "",
    createdAt: (b.account?.createdAt ?? b.org.createdAt).toISOString(),
  }
}

function statusDoGateway(g: Bruto["gateways"][number], agoraMs: number, comErro: boolean): Gateway["status"] {
  if (g.status === "pending_enrollment") return "pending"
  if (g.status === "revoked" || g.lastSeenAt === null) return "offline"
  if (agoraMs - g.lastSeenAt.getTime() > OFFLINE_APOS_MS) return "offline"
  const atrasada = g.configVersionApplied !== null && g.configVersionApplied < g.configVersionLatest
  return comErro || atrasada ? "degraded" : "online"
}

function converter(b: Bruto, agoraMs: number) {
  const clientId = b.org.id
  const busById = new Map(b.buses.map((x) => [x.id, x]))
  const statusById = new Map(b.deviceStatus.map((x) => [x.deviceId, x]))

  const devices: Device[] = b.devices.map((d) => {
    const p = d.params as { host?: string; port?: number; unit_id: number; timeout_ms?: number; bus?: string }
    const bus = p.bus ? busById.get(p.bus) : undefined
    const st = statusById.get(d.id)
    const status: Device["status"] = !d.enabled ? "disabled" : st === undefined || st.status === "disconnected" ? "error" : st.status === "disabled" ? "disabled" : "connected"
    return {
      id: d.id,
      gatewayId: d.gatewayId,
      name: d.name,
      protocol: d.protocol,
      params: {
        host: p.host,
        port: p.port,
        serialPort: bus?.port,
        baudRate: bus?.baud,
        parity: bus?.parity,
        dataBits: bus ? 8 : undefined,
        stopBits: bus ? (bus.stopBits === 2 ? 2 : 1) : undefined,
        unitId: p.unit_id,
        timeoutMs: p.timeout_ms ?? 1000,
      },
      status,
      latencyMs: st?.latencyMs ?? null,
      errors1m: st?.errors1m ?? 0,
      lastError: status === "error" ? (st === undefined ? "Sem leitura do gateway ainda" : "Sem resposta do CLP") : undefined,
    }
  })

  const tags: Tag[] = b.tags.map((t) => {
    const addr = t.address as ModbusAddress
    return {
      id: t.id,
      deviceId: t.deviceId,
      machineId: t.machineId ?? "",
      name: t.name ?? t.role,
      role: t.role as TagRole,
      area: addr.area as ModbusArea,
      address: addr.offset,
      dataType: t.dataType as DataType,
      byteOrder: t.wordOrder ?? "ABCD",
      pollMs: t.pollMs ?? 1000,
      lastValue: "—",
      quality: "stale",
    }
  })

  const gatewayOf = new Map(b.links.map((l) => [l.machineId, l.gatewayId]))
  const machines: Machine[] = b.machines.map((m) => {
    const rules = m.stateRules as { mode: StateMode; ideal_cycle_s?: number }
    return {
      id: m.id,
      clientId,
      unitId: m.unitId,
      lineId: m.lineId,
      name: m.name,
      code: m.code ?? "",
      type: "Máquina",
      gatewayId: gatewayOf.get(m.id) ?? null,
      deviceId: tags.find((t) => t.machineId === m.id)?.deviceId ?? null,
      idealCycleS: m.idealCycleS ?? rules.ideal_cycle_s ?? 0,
      microStopThresholdS: m.microStopThresholdS,
      stateMode: rules.mode,
      active: m.active,
    }
  })

  const gateways: Gateway[] = b.gateways.map((g) => {
    const h = g.health ?? {}
    const comErro = devices.some((d) => d.gatewayId === g.id && d.status === "error")
    return {
      id: g.id,
      clientId,
      unitId: g.unitId,
      name: g.name,
      hostname: g.hostname ?? "aguardando ativação",
      hardware: g.hwInfo?.model ?? "—",
      status: statusDoGateway(g, agoraMs, comErro),
      lastSeen: iso(g.lastSeenAt),
      agentVersion: g.agentVersion,
      configVersion: g.configVersionLatest,
      configApplied: g.configVersionApplied,
      bufferPending: typeof h.buffer_pending === "number" ? h.buffer_pending : 0,
      cpuPct: typeof h.cpu_pct === "number" ? h.cpu_pct : null,
      memMb: typeof h.mem_mb === "number" ? h.mem_mb : null,
      diskFreePct: null,
      clockOffsetMs: typeof h.clock_offset_ms === "number" ? h.clock_offset_ms : null,
      ipIt: null,
      ipOt: null,
      uptimeS: typeof h.uptime_s === "number" ? h.uptime_s : null,
    }
  })

  const units: Unit[] = b.units.map((u) => ({ id: u.id, clientId, name: u.name, city: "", state: "", timezone: u.timezone }))
  const areas: Area[] = b.areas.map((a) => ({ id: a.id, clientId, unitId: a.unitId, name: a.name }))
  const lines: Line[] = b.lines.map((l) => ({ id: l.id, clientId, unitId: l.unitId, areaId: l.areaId ?? "", name: l.name, code: "" }))

  const users: User[] = b.people.map((p) => {
    let scope: MemberScope = { kind: "all" }
    if (p.scope === "units") scope = { kind: "units", unitIds: b.memberUnits.filter((x) => x.accessId === p.accessId).map((x) => x.unitId) }
    if (p.scope === "machines") scope = { kind: "machines", machineIds: b.memberMachines.filter((x) => x.accessId === p.accessId).map((x) => x.machineId) }
    return {
      id: p.userId,
      name: p.name,
      email: p.email,
      username: null,
      platformRole: null,
      memberships: p.role === null ? [] : [{ clientId, role: p.role as ClientRole, scope }],
      status: p.active === false || p.accessId === null ? "disabled" : p.emailVerified ? "active" : "invited",
      lastLoginAt: null,
      twoFactor: p.twoFactor,
    }
  })

  const shifts: Shift[] = b.shifts.map((s) => ({
    id: s.id,
    clientId,
    unitId: s.unitId,
    name: s.name,
    start: s.startTime.slice(0, 5),
    end: s.endTime.slice(0, 5),
    days: s.daysOfWeek.map((d) => d % 7),
    breaks: [],
  }))

  const nomes = new Map<string, string>([
    ...units.map((x) => [x.id, x.name] as const),
    ...lines.map((x) => [x.id, x.name] as const),
    ...machines.map((x) => [x.id, x.name] as const),
    ...gateways.map((x) => [x.id, x.name] as const),
    ...devices.map((x) => [x.id, x.name] as const),
    ...users.map((x) => [x.id, x.name] as const),
    [clientId, b.org.name],
  ])
  const audit: AuditEntry[] = b.audit.map((a) => ({
    id: a.id,
    clientId,
    actorName: a.actorLabel ?? (a.actorType === "system" ? "Sistema" : a.actorType === "gateway" ? "Gateway" : "—"),
    impersonatedBy: a.actorType === "engemase" ? (a.actorLabel ?? "Engemase") : null,
    action: a.action,
    entity: a.entityType ?? "",
    entityName: (a.entityId ? nomes.get(a.entityId) : undefined) ?? a.entityType ?? "—",
    at: a.at.toISOString(),
    details: resumo(a.after),
  }))

  return { client: cliente(b), units, areas, lines, machines, gateways, devices, tags, users, audit, shifts }
}

/** Resumo curto do "depois" da auditoria (ex.: "version: 3 · devices: 1"). */
function resumo(after: unknown): string | undefined {
  if (after === null || typeof after !== "object") return undefined
  const parts = Object.entries(after as Record<string, unknown>)
    .filter(([, v]) => v !== null && typeof v !== "object")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v)}`)
  return parts.length > 0 ? parts.join(" · ") : undefined
}

// ---------------------------------------------------------------------------
// Escopo (D11): a pessoa só vê unidades/máquinas do escopo
// ---------------------------------------------------------------------------

function aplicarEscopo(c: ReturnType<typeof converter>, scope: Scope): ReturnType<typeof converter> {
  if (scope.kind === "all") return c
  const machines = c.machines.filter((m) => (scope.kind === "units" ? scope.unitIds.includes(m.unitId) : scope.machineIds.includes(m.id)))
  const unitIds = new Set(scope.kind === "units" ? scope.unitIds : machines.map((m) => m.unitId))
  const machineIds = new Set(machines.map((m) => m.id))
  const gateways = c.gateways.filter((g) => unitIds.has(g.unitId))
  const gatewayIds = new Set(gateways.map((g) => g.id))
  return {
    ...c,
    units: c.units.filter((u) => unitIds.has(u.id)),
    areas: c.areas.filter((a) => unitIds.has(a.unitId)),
    lines: c.lines.filter((l) => unitIds.has(l.unitId)),
    machines,
    gateways,
    devices: c.devices.filter((d) => gatewayIds.has(d.gatewayId)),
    tags: c.tags.filter((t) => machineIds.has(t.machineId)),
    shifts: c.shifts.filter((s) => unitIds.has(s.unitId)),
  }
}

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------

function usuarioDaSessao(session: CurrentSession, ctx?: TenantContext): User {
  const role = session.user.role
  const platformRole = role !== null && (PLATFORM_ROLES as readonly string[]).includes(role) ? (role as PlatformRole) : null
  const memberships =
    ctx !== undefined && ctx.access.kind === "member"
      ? [
          {
            clientId: ctx.organizationId,
            role: ctx.access.role,
            scope:
              ctx.scope.kind === "all"
                ? ({ kind: "all" } as const)
                : ctx.scope.kind === "units"
                  ? { kind: "units" as const, unitIds: [...ctx.scope.unitIds] }
                  : { kind: "machines" as const, machineIds: [...ctx.scope.machineIds] },
          },
        ]
      : []
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    username: null,
    platformRole,
    memberships,
    status: "active",
    lastLoginAt: null,
    twoFactor: session.user.twoFactorEnabled,
  }
}

export function acessoDoContexto(ctx: TenantContext): ConfigAccess {
  return {
    isEngemase: ctx.access.kind === "engemase",
    canConfigure: hasPermission(ctx, "config.write"),
    canManageUsers: hasPermission(ctx, "users.manage"),
  }
}

/** Equipe Engemase (pessoas com papel de plataforma), lida com o banco do Better Auth. */
async function equipeEngemase(): Promise<User[]> {
  const authDb = getAuthDb()
  if (authDb === null) return []
  const rows = await authDb
    .select({ id: user.id, name: user.name, email: user.email, role: user.role, banned: user.banned, twoFactor: user.twoFactorEnabled, verified: user.emailVerified })
    .from(user)
    .where(inArray(user.role, [...PLATFORM_ROLES]))
    .orderBy(user.name)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    username: null,
    platformRole: r.role as PlatformRole,
    memberships: [],
    status: r.banned ? "disabled" : r.verified ? "active" : "invited",
    lastLoginAt: null,
    twoFactor: r.twoFactor,
  }))
}

function vazia(agora: string, usuario: User): Foto {
  return { agora, usuario, acesso: {}, clients: [], units: [], areas: [], lines: [], machines: [], gateways: [], devices: [], tags: [], users: [], platformUsers: [], audit: [], shifts: [] }
}

function somar(f: Foto, c: ReturnType<typeof converter>): void {
  f.clients.push(c.client)
  f.units.push(...c.units)
  f.areas.push(...c.areas)
  f.lines.push(...c.lines)
  f.machines.push(...c.machines)
  f.gateways.push(...c.gateways)
  f.devices.push(...c.devices)
  f.tags.push(...c.tags)
  f.users.push(...c.users)
  f.audit.push(...c.audit)
  f.shifts.push(...c.shifts)
}

/** Cadastro de um cliente, como a pessoa do contexto o vê (RLS + escopo). */
export async function fotoDoCliente(db: GatewayDb, ctx: TenantContext, session: CurrentSession, agora: Date): Promise<Foto> {
  const bruto = await withTenant(db, ctx.organizationId, (tx) => lerBruto(tx, 200))
  const f = vazia(agora.toISOString(), usuarioDaSessao(session, ctx))
  if (bruto === null) return f
  somar(f, aplicarEscopo(converter(bruto, agora.getTime()), ctx.scope))
  f.acesso[ctx.organizationId] = acessoDoContexto(ctx)
  return f
}

/** Ids de todos os clientes (função da plataforma, a mesma dos crons). */
export async function idsDosClientes(db: GatewayDb): Promise<string[]> {
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`)
    return queryRows<{ id: string }>(tx, sql`SELECT id FROM app.cron_organizations()`)
  })
  return rows.map((r) => r.id)
}

/** Console Engemase: todos os clientes e a equipe. A pessoa já passou em `exigirEquipe`. */
export async function fotoDaPlataforma(
  db: GatewayDb,
  session: CurrentSession,
  role: PlatformRole,
  agora: Date,
  opcoes: { auditoria?: number; apenas?: string } = {},
): Promise<Foto> {
  const f = vazia(agora.toISOString(), usuarioDaSessao(session))
  const ids = opcoes.apenas !== undefined ? [opcoes.apenas] : await idsDosClientes(db)
  const brutos = await Promise.all(ids.map((id) => withTenant(db, id, (tx) => lerBruto(tx, opcoes.auditoria ?? 50))))
  for (const b of brutos) {
    if (b === null) continue
    somar(f, converter(b, agora.getTime()))
    f.acesso[b.org.id] = {
      isEngemase: true,
      canConfigure: role === "super_admin" || role === "technician",
      canManageUsers: role === "super_admin",
    }
  }
  f.platformUsers = await equipeEngemase()
  return f
}
