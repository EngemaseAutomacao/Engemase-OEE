/**
 * Dados das telas de cadastro do cliente (W8): máquinas, nova máquina, unidades e linhas, gateways e
 * detalhe do gateway. Mesmo formato com e sem banco; com banco, a pessoa passou por `requireTenant`
 * + `config.read` (`exigirCliente`) e os dados vêm da foto do cliente (RLS + escopo).
 */
import { device, gateway, gatewayCommand, gatewayConfigVersion, withTenant } from "@engemase/db"
import { and, desc, eq, isNull } from "drizzle-orm"
import { FactoryIcon, RouterIcon, UsersIcon } from "lucide-react"
import { buildGatewayDetail, type CommandVM, type ConfigVersionVM, type GatewayDetail } from "@/components/access/gateway-detail-data"
import { freshCodeExpiresLabel, gatewayRow } from "@/components/access/gateway-view"
import type { CommandType } from "@/components/access/labels"
import { MACHINE_TYPES, STATE_MODE_LABEL, serialPortsFor, ttyFromSerial, ttyPortsFor } from "@/components/config/labels"
import type { ConnInfo, MachineRow, RegistryGateway, RegistryLine, RegistryUnit } from "@/components/config/machine-registry"
import type { UsageItem } from "@/components/config/plan-usage"
import type { AreaNode, LineNode, UnitNode } from "@/components/config/units-manager"
import type { MachineTemplate, WizardDevice, WizardGateway, WizardLine, WizardUnit } from "@/components/config/wizard-model"
import { ago, dateTime } from "@/lib/format"
import { MOCK_NOW } from "@/lib/mock"
import { bancoObrigatorio } from "../admin/acesso"
import { exigirCliente } from "./cliente"
import { resumoDoComando } from "./comandos"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Cadastro de máquinas
// ---------------------------------------------------------------------------
export async function dadosCadastroMaquinas(slug: string) {
  const { r, client, ctx } = await exigirCliente(slug)
  const machines = r.getMachines(client.id)
  const units: RegistryUnit[] = r.getUnits(client.id).map((u) => ({ id: u.id, name: u.name }))
  const lines: RegistryLine[] = r.getLines(client.id).map((l) => ({ id: l.id, unitId: l.unitId, name: l.name, code: l.code }))
  const gateways: RegistryGateway[] = r.getGateways(client.id).map((g) => ({
    id: g.id,
    unitId: g.unitId,
    name: g.name,
    status: g.status,
    configVersion: g.configVersion,
    serialPorts: serialPortsFor(g.hardware),
  }))
  const rows: MachineRow[] = machines.map((m) => {
    const dev = m.deviceId ? r.getDevice(m.deviceId) : undefined
    const conn: ConnInfo | null = dev ? { protocol: dev.protocol, ...dev.params } : null
    return {
      id: m.id,
      name: m.name,
      code: m.code,
      type: m.type,
      unitId: m.unitId,
      lineId: m.lineId,
      gatewayId: m.gatewayId,
      deviceName: dev?.name ?? null,
      conn,
      stateMode: m.stateMode,
      idealCycleS: m.idealCycleS,
      microStopThresholdS: m.microStopThresholdS,
      active: m.active,
      tagCount: r.getTags({ machineId: m.id }).length,
    }
  })
  return { client, banco: ctx !== null, access: r.getConfigAccess(client.id), rows, units, lines, gateways }
}

// ---------------------------------------------------------------------------
// Nova máquina (assistente)
// ---------------------------------------------------------------------------
export async function dadosNovaMaquina(slug: string) {
  const { r, client, ctx } = await exigirCliente(slug)
  const units: WizardUnit[] = r.getUnits(client.id).map((u) => ({ id: u.id, name: u.name }))
  const lines: WizardLine[] = r.getLines(client.id).map((l) => ({
    id: l.id,
    unitId: l.unitId,
    areaName: r.getAreas(l.unitId).find((a) => a.id === l.areaId)?.name ?? "Sem área",
    name: l.name,
    code: l.code,
  }))
  const rawGateways = r.getGateways(client.id)
  const gateways: WizardGateway[] = rawGateways.map((g) => ({
    id: g.id,
    unitId: g.unitId,
    name: g.name,
    hostname: g.hostname,
    status: g.status,
    configVersion: g.configVersion,
    serialPorts: ttyPortsFor(g.hardware),
    ipOt: g.ipOt,
  }))
  const devices: WizardDevice[] = rawGateways.flatMap((g) =>
    r.getDevices(g.id).map((d) => ({
      id: d.id,
      gatewayId: d.gatewayId,
      name: d.name,
      protocol: d.protocol,
      host: d.params.host,
      port: d.params.port,
      serialPort: ttyFromSerial(d.params.serialPort),
      baudRate: d.params.baudRate,
      parity: d.params.parity,
      dataBits: d.params.dataBits,
      stopBits: d.params.stopBits,
      unitId: d.params.unitId,
    })),
  )
  const machines = r.getMachines(client.id)
  // "Copiar de máquina igual": sinais e regras das máquinas já mapeadas.
  const machineTemplates: MachineTemplate[] = machines.flatMap((m) => {
    const tags = r.getTags({ machineId: m.id })
    if (tags.length === 0) return []
    return [
      {
        id: `tpl_${m.id}`,
        label: m.code ? `${m.name} (${m.code})` : m.name,
        description: `${tags.length} sinais · ${STATE_MODE_LABEL[m.stateMode]}`,
        machineType: m.type,
        stateMode: m.stateMode,
        idealCycleS: m.idealCycleS,
        tags: tags.map((t) => ({ name: t.name, role: t.role, area: t.area, address: t.address, dataType: t.dataType, byteOrder: t.byteOrder, pollMs: t.pollMs })),
      },
    ]
  })
  return {
    client,
    banco: ctx !== null,
    access: r.getConfigAccess(client.id),
    units,
    lines,
    gateways,
    devices,
    existingCodes: machines.map((m) => m.code).filter((c) => c !== ""),
    machineTypes: [...new Set([...MACHINE_TYPES, ...machines.map((m) => m.type)])],
    machineTemplates,
    machineCount: machines.length,
  }
}

// ---------------------------------------------------------------------------
// Unidades, áreas e linhas
// ---------------------------------------------------------------------------
export async function dadosUnidades(slug: string) {
  const { r, client, ctx } = await exigirCliente(slug)
  const machines = r.getMachines(client.id)
  const gateways = r.getGateways(client.id)
  const units = r.getUnits(client.id)
  const unitNodes: UnitNode[] = units.map((u) => ({
    id: u.id,
    name: u.name,
    city: u.city,
    state: u.state,
    timezone: u.timezone,
    gateways: gateways.filter((g) => g.unitId === u.id).map((g) => ({ id: g.id, name: g.name, status: g.status })),
  }))
  const areaNodes: AreaNode[] = units.flatMap((u) => r.getAreas(u.id).map((a) => ({ id: a.id, unitId: a.unitId, name: a.name })))
  const lineNodes: LineNode[] = r.getLines(client.id).map((l) => ({
    id: l.id,
    unitId: l.unitId,
    areaId: l.areaId,
    name: l.name,
    code: l.code,
    machineCount: machines.filter((m) => m.lineId === l.id).length,
  }))
  const usage: UsageItem[] = [
    { label: "Máquinas em uso / contratadas", used: machines.length, limit: client.limits.machines, icon: FactoryIcon },
    { label: "Gateways", used: gateways.length, limit: client.limits.gateways, icon: RouterIcon },
    { label: "Usuários", used: r.getClientUsers(client.id).length, limit: client.limits.users, icon: UsersIcon },
  ]
  return { client, banco: ctx !== null, access: r.getConfigAccess(client.id), unitNodes, areaNodes, lineNodes, usage }
}

// ---------------------------------------------------------------------------
// Gateways
// ---------------------------------------------------------------------------
export async function dadosGateways(slug: string) {
  const { r, client, ctx } = await exigirCliente(slug)
  const units = r.getUnits(client.id)
  const machines = r.getMachines(client.id)
  const audit = r.getAuditLog(client.id)
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? "—"
  const rows = r.getGateways(client.id).map((g) => gatewayRow(g, unitName(g.unitId), r.getDevices(g.id), machines, audit))
  return {
    client,
    banco: ctx !== null,
    access: r.getConfigAccess(client.id),
    rows,
    units: units.map((u) => ({ id: u.id, name: u.name })),
    freshExpiresLabel: freshCodeExpiresLabel(),
  }
}

/** Detalhe do gateway; `null` = não existe neste cliente (a página responde 404). */
export async function dadosGateway(slug: string, gatewayId: string): Promise<{ data: GatewayDetail; nowLabel: string; canEdit: boolean; banco: boolean } | null> {
  const { r, client, ctx } = await exigirCliente(slug)
  const g = r.getGateway(gatewayId)
  if (!g || g.clientId !== client.id) return null
  const canEdit = r.getConfigAccess(client.id).canConfigure
  const base = buildGatewayDetail(client, g, r)
  if (ctx === null) return { data: base, nowLabel: dateTime(MOCK_NOW), canEdit, banco: false }
  if (!UUID_RE.test(gatewayId)) return null

  // Com banco: histórico de configuração, fila de comandos e os parâmetros reais de cada CLP.
  const db = bancoObrigatorio()
  const { versions, commands, rawDevices, enrollment } = await withTenant(db, ctx.organizationId, async (tx) => {
    const [versions, commands, rawDevices, gw] = await Promise.all([
      tx
        .select({ version: gatewayConfigVersion.version, createdAt: gatewayConfigVersion.createdAt, createdBy: gatewayConfigVersion.createdBy, snapshot: gatewayConfigVersion.snapshot })
        .from(gatewayConfigVersion)
        .where(eq(gatewayConfigVersion.gatewayId, gatewayId))
        .orderBy(desc(gatewayConfigVersion.version))
        .limit(20),
      tx.select().from(gatewayCommand).where(eq(gatewayCommand.gatewayId, gatewayId)).orderBy(desc(gatewayCommand.createdAt)).limit(30),
      tx.select({ id: device.id, protocol: device.protocol, params: device.params }).from(device).where(and(eq(device.gatewayId, gatewayId), isNull(device.deletedAt))),
      tx.select({ status: gateway.status }).from(gateway).where(eq(gateway.id, gatewayId)),
    ])
    return { versions, commands, rawDevices, enrollment: gw[0]?.status ?? null }
  })
  const people = new Map<string, string>([...r.getUsers().map((u) => [u.id, u.name] as const), [ctx.user.id, ctx.user.name]])
  const configVersions: ConfigVersionVM[] = versions.map((v, i) => {
    const s = v.snapshot
    const tags = s.devices.reduce((n, d) => n + d.tags.length, 0)
    const prev = versions[i + 1]?.snapshot
    const prevTags = prev ? prev.devices.reduce((n, d) => n + d.tags.length, 0) : 0
    const changes = [
      { kind: "change" as const, text: `${s.devices.length} CLP(s), ${s.machines.length} máquina(s) e ${tags} sinal(is)` },
      ...(prev && tags !== prevTags ? [{ kind: (tags > prevTags ? "add" : "remove") as "add" | "remove", text: `${Math.abs(tags - prevTags)} sinal(is) ${tags > prevTags ? "a mais" : "a menos"} que a v${versions[i + 1]!.version}` }] : []),
    ]
    return {
      version: v.version,
      publishedLabel: dateTime(v.createdAt.toISOString()),
      publishedAgo: ago(v.createdAt.toISOString()),
      author: v.createdBy ? (people.get(v.createdBy) ?? "Equipe Engemase") : "Sistema",
      summary: `${s.devices.length} CLP(s) · ${s.machines.length} máquina(s) · ${tags} sinal(is)`,
      changes,
    }
  })
  const deviceName = new Map(base.devices.map((d) => [d.id, d.name]))
  const commandVMs: CommandVM[] = commands
    .filter((c) => ["tag.read", "device.test", "config.reload", "agent.restart"].includes(c.type))
    .map((c) => {
      const s = resumoDoComando(c)
      const target = typeof c.payload.device_id === "string" ? (deviceName.get(c.payload.device_id) ?? "CLP") : g.hostname
      return {
        id: c.id,
        type: c.type as CommandType,
        target,
        requestedBy: c.createdBy ? (people.get(c.createdBy) ?? "Equipe Engemase") : "Sistema",
        status: s.status,
        result: s.result,
        durationMs: s.durationMs,
        createdLabel: dateTime(c.createdAt.toISOString()),
        createdAgo: ago(c.createdAt.toISOString()),
      }
    })
  const rawById = new Map(rawDevices.map((d) => [d.id, d]))
  const data: GatewayDetail = {
    ...base,
    configVersions,
    commands: commandVMs,
    health: null,
    devices: base.devices.map((d) => {
      const raw = rawById.get(d.id)
      return raw ? { ...d, comando: { device_id: d.id, connection: { protocol: raw.protocol, params: raw.params } } } : d
    }),
    tcpDevices: base.tcpDevices.map((d) => {
      const raw = rawById.get(d.id)
      return raw ? { ...d, comando: { device_id: d.id, connection: { protocol: raw.protocol, params: raw.params } } } : d
    }),
    tags: base.tags.map((t) => ({
      ...t,
      value: "—",
      readValue: "—",
      comando: {
        device_id: t.deviceId,
        address: { area: t.area, offset: t.address },
        type: t.dataType,
        ...(t.byteOrder ? { word_order: t.byteOrder } : {}),
      },
    })),
    // Gateway aguardando ativação: o código só existe em claro na hora em que é gerado (fica só o hash).
    activation:
      enrollment === "pending_enrollment"
        ? { code: "", expired: true, expiresLabel: "—", freshExpiresLabel: freshCodeExpiresLabel(), createdBy: null, createdLabel: null }
        : null,
  }
  return { data, nowLabel: dateTime(r.agoraIso()), canEdit, banco: true }
}
