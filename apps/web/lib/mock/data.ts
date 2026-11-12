/**
 * Dados simulados ESTÁTICOS (cadastros) para o protótipo de interface.
 * Tudo aqui é fictício. Será substituído pela camada de dados real (Drizzle + Neon).
 */
import type {
  Area,
  AuditEntry,
  Client,
  Device,
  DowntimeReason,
  Gateway,
  Line,
  Machine,
  Product,
  Shift,
  Tag,
  Unit,
  User,
} from "./types"

/** "Agora" fixo e fuso do protótipo: definidos em `./clock` (módulo leve, seguro para o navegador). */
export { MOCK_NOW, DEFAULT_TZ } from "./clock"

/**
 * Usuário "logado" no protótipo: super admin da Engemase (vê tudo, inclusive o console, e edita a configuração).
 * Troque por "usr_marcos" (admin do cliente) ou "usr_pedro" (engenheiro do cliente) para ver as telas de
 * configuração como o cliente vê: só leitura, com a faixa "Configurado pela Engemase" (D12/D13).
 */
export const CURRENT_USER_ID = "usr_ana"

export const clients: Client[] = [
  {
    id: "cli_plastiform",
    slug: "plastiform",
    name: "Plastiform Embalagens",
    legalName: "Plastiform Indústria de Embalagens Ltda.",
    cnpj: "12.345.678/0001-90",
    city: "Joinville",
    state: "SC",
    status: "active",
    plan: "pro",
    management: "engemase",
    limits: { machines: 30, gateways: 6, users: 40, retentionMonths: 24 },
    contactName: "Marcos Lima",
    contactEmail: "marcos.lima@plastiform.exemplo.com.br",
    createdAt: "2026-03-02T12:00:00.000Z",
  },
  {
    id: "cli_serra",
    slug: "serra-azul",
    name: "Metalúrgica Serra Azul",
    legalName: "Metalúrgica Serra Azul S.A.",
    cnpj: "98.765.432/0001-10",
    city: "Caxias do Sul",
    state: "RS",
    status: "active",
    plan: "starter",
    management: "self",
    limits: { machines: 10, gateways: 2, users: 15, retentionMonths: 12 },
    contactName: "Renata Faria",
    contactEmail: "renata@serraazul.exemplo.com.br",
    createdAt: "2026-06-18T12:00:00.000Z",
  },
  {
    id: "cli_bomsabor",
    slug: "bom-sabor",
    name: "Bom Sabor Alimentos",
    legalName: "Bom Sabor Alimentos Ltda.",
    cnpj: "45.678.912/0001-33",
    city: "Chapecó",
    state: "SC",
    status: "onboarding",
    plan: "pro",
    management: "engemase",
    limits: { machines: 20, gateways: 4, users: 30, retentionMonths: 24 },
    contactName: "Luís Andrade",
    contactEmail: "luis.andrade@bomsabor.exemplo.com.br",
    createdAt: "2026-11-03T12:00:00.000Z",
  },
  {
    id: "cli_valeverde",
    slug: "vale-verde",
    name: "Têxtil Vale Verde",
    legalName: "Têxtil Vale Verde Ltda.",
    cnpj: "33.221.110/0001-77",
    city: "Brusque",
    state: "SC",
    status: "suspended",
    plan: "starter",
    management: "self",
    limits: { machines: 10, gateways: 2, users: 15, retentionMonths: 12 },
    contactName: "Paula Teixeira",
    contactEmail: "paula@valeverde.exemplo.com.br",
    createdAt: "2025-12-10T12:00:00.000Z",
  },
]

export const units: Unit[] = [
  { id: "uni_jlle", clientId: "cli_plastiform", name: "Unidade Joinville", city: "Joinville", state: "SC", timezone: "America/Sao_Paulo" },
  { id: "uni_ctba", clientId: "cli_plastiform", name: "Unidade Curitiba", city: "Curitiba", state: "PR", timezone: "America/Sao_Paulo" },
  { id: "uni_caxias", clientId: "cli_serra", name: "Fábrica Caxias", city: "Caxias do Sul", state: "RS", timezone: "America/Sao_Paulo" },
  { id: "uni_chapeco", clientId: "cli_bomsabor", name: "Fábrica Chapecó", city: "Chapecó", state: "SC", timezone: "America/Sao_Paulo" },
  { id: "uni_brusque", clientId: "cli_valeverde", name: "Fábrica Brusque", city: "Brusque", state: "SC", timezone: "America/Sao_Paulo" },
]

export const areas: Area[] = [
  { id: "are_jlle_inj", clientId: "cli_plastiform", unitId: "uni_jlle", name: "Injeção" },
  { id: "are_jlle_sop", clientId: "cli_plastiform", unitId: "uni_jlle", name: "Sopro" },
  { id: "are_ctba_inj", clientId: "cli_plastiform", unitId: "uni_ctba", name: "Injeção" },
  { id: "are_cx_est", clientId: "cli_serra", unitId: "uni_caxias", name: "Estamparia" },
  { id: "are_cx_usi", clientId: "cli_serra", unitId: "uni_caxias", name: "Usinagem" },
  { id: "are_ch_env", clientId: "cli_bomsabor", unitId: "uni_chapeco", name: "Envase" },
  { id: "are_br_tec", clientId: "cli_valeverde", unitId: "uni_brusque", name: "Tecelagem" },
]

export const lines: Line[] = [
  { id: "lin_injA", clientId: "cli_plastiform", unitId: "uni_jlle", areaId: "are_jlle_inj", name: "Linha Injeção A", code: "INJ-A" },
  { id: "lin_sopro", clientId: "cli_plastiform", unitId: "uni_jlle", areaId: "are_jlle_sop", name: "Linha Sopro", code: "SOP-1" },
  { id: "lin_injB", clientId: "cli_plastiform", unitId: "uni_ctba", areaId: "are_ctba_inj", name: "Linha Injeção B", code: "INJ-B" },
  { id: "lin_estamp", clientId: "cli_serra", unitId: "uni_caxias", areaId: "are_cx_est", name: "Estamparia", code: "EST-1" },
  { id: "lin_usin", clientId: "cli_serra", unitId: "uni_caxias", areaId: "are_cx_usi", name: "Usinagem CNC", code: "USI-1" },
  { id: "lin_envase", clientId: "cli_bomsabor", unitId: "uni_chapeco", areaId: "are_ch_env", name: "Linha de Envase", code: "ENV-1" },
  { id: "lin_tear", clientId: "cli_valeverde", unitId: "uni_brusque", areaId: "are_br_tec", name: "Teares", code: "TEA-1" },
]

const m = (
  id: string,
  clientId: string,
  unitId: string,
  lineId: string,
  name: string,
  code: string,
  type: string,
  gatewayId: string | null,
  deviceId: string | null,
  idealCycleS: number,
  stateMode: Machine["stateMode"] = "signals",
): Machine => ({
  id,
  clientId,
  unitId,
  lineId,
  name,
  code,
  type,
  gatewayId,
  deviceId,
  idealCycleS,
  microStopThresholdS: 60,
  stateMode,
  active: true,
})

export const machines: Machine[] = [
  m("mch_inj01", "cli_plastiform", "uni_jlle", "lin_injA", "Injetora 01", "INJ-01", "Injetora", "gw_jlle01", "dev_inj01", 18),
  m("mch_inj02", "cli_plastiform", "uni_jlle", "lin_injA", "Injetora 02", "INJ-02", "Injetora", "gw_jlle01", "dev_inj02", 18),
  m("mch_inj03", "cli_plastiform", "uni_jlle", "lin_injA", "Injetora 03", "INJ-03", "Injetora", "gw_jlle01", "dev_inj03", 22),
  m("mch_inj04", "cli_plastiform", "uni_jlle", "lin_injA", "Injetora 04", "INJ-04", "Injetora", "gw_jlle01", "dev_inj04", 22),
  m("mch_sop01", "cli_plastiform", "uni_jlle", "lin_sopro", "Sopradora 01", "SOP-01", "Sopradora", "gw_jlle02", "dev_sop01", 6),
  m("mch_sop02", "cli_plastiform", "uni_jlle", "lin_sopro", "Sopradora 02", "SOP-02", "Sopradora", "gw_jlle02", "dev_sop02", 6, "count_derived"),
  m("mch_inj05", "cli_plastiform", "uni_ctba", "lin_injB", "Injetora 05", "INJ-05", "Injetora", "gw_ctba01", "dev_inj05", 25),
  m("mch_inj06", "cli_plastiform", "uni_ctba", "lin_injB", "Injetora 06", "INJ-06", "Injetora", "gw_ctba01", "dev_inj06", 25),
  m("mch_pre01", "cli_serra", "uni_caxias", "lin_estamp", "Prensa 01", "PR-01", "Prensa excêntrica", "gw_cx01", "dev_pre01", 3),
  m("mch_pre02", "cli_serra", "uni_caxias", "lin_estamp", "Prensa 02", "PR-02", "Prensa excêntrica", "gw_cx01", "dev_pre02", 3),
  m("mch_pre03", "cli_serra", "uni_caxias", "lin_estamp", "Prensa 03", "PR-03", "Prensa hidráulica", "gw_cx01", "dev_pre03", 8),
  m("mch_cnc01", "cli_serra", "uni_caxias", "lin_usin", "Centro CNC 01", "CNC-01", "Centro de usinagem", "gw_cx01", "dev_cnc01", 95),
  m("mch_cnc02", "cli_serra", "uni_caxias", "lin_usin", "Centro CNC 02", "CNC-02", "Centro de usinagem", "gw_cx01", "dev_cnc02", 110),
  m("mch_env01", "cli_bomsabor", "uni_chapeco", "lin_envase", "Envasadora 01", "ENV-01", "Envasadora", "gw_ch01", null, 1.2),
  m("mch_rot01", "cli_bomsabor", "uni_chapeco", "lin_envase", "Rotuladora 01", "ROT-01", "Rotuladora", "gw_ch01", null, 1),
  m("mch_tea01", "cli_valeverde", "uni_brusque", "lin_tear", "Tear 01", "TEA-01", "Tear", "gw_br01", "dev_tea01", 40),
]

export const gateways: Gateway[] = [
  {
    id: "gw_jlle01", clientId: "cli_plastiform", unitId: "uni_jlle", name: "GW Joinville Injeção", hostname: "gw-jlle-inj",
    hardware: "Gateway industrial ARM64 · 4 GB · 2× Ethernet · 3× RS-485",
    status: "online", lastSeen: "2026-11-11T13:41:55.000Z", agentVersion: "1.2.0", configVersion: 42, configApplied: 42,
    bufferPending: 3, cpuPct: 7.5, memMb: 38, diskFreePct: 81, clockOffsetMs: 12, ipIt: "10.20.1.15", ipOt: "192.168.10.2", uptimeS: 1_296_000,
  },
  {
    id: "gw_jlle02", clientId: "cli_plastiform", unitId: "uni_jlle", name: "GW Joinville Sopro", hostname: "gw-jlle-sop",
    hardware: "Gateway industrial ARM64 · 4 GB · 2× Ethernet · 3× RS-485",
    status: "online", lastSeen: "2026-11-11T13:41:58.000Z", agentVersion: "1.2.0", configVersion: 17, configApplied: 17,
    bufferPending: 0, cpuPct: 4.1, memMb: 31, diskFreePct: 88, clockOffsetMs: 8, ipIt: "10.20.1.16", ipOt: "192.168.20.2", uptimeS: 864_000,
  },
  {
    id: "gw_ctba01", clientId: "cli_plastiform", unitId: "uni_ctba", name: "GW Curitiba", hostname: "gw-ctba-01",
    hardware: "Gateway industrial ARM64 · 4 GB · 2× Ethernet · 3× RS-485",
    status: "offline", lastSeen: "2026-11-11T12:58:10.000Z", agentVersion: "1.1.3", configVersion: 9, configApplied: 9,
    bufferPending: 2_184, cpuPct: null, memMb: null, diskFreePct: 74, clockOffsetMs: null, ipIt: "10.30.0.21", ipOt: "192.168.30.2", uptimeS: null,
  },
  {
    id: "gw_cx01", clientId: "cli_serra", unitId: "uni_caxias", name: "GW Caxias", hostname: "gw-caxias-01",
    hardware: "Gateway industrial ARM64 · 4 GB · 2× Ethernet · 3× RS-485",
    status: "degraded", lastSeen: "2026-11-11T13:41:50.000Z", agentVersion: "1.2.0", configVersion: 23, configApplied: 22,
    bufferPending: 41, cpuPct: 12.3, memMb: 44, diskFreePct: 63, clockOffsetMs: 2_480, ipIt: "172.16.4.10", ipOt: "192.168.1.250", uptimeS: 432_000,
  },
  {
    id: "gw_ch01", clientId: "cli_bomsabor", unitId: "uni_chapeco", name: "GW Chapecó Envase", hostname: "—",
    hardware: "Gateway industrial ARM64 · 4 GB · 2× Ethernet · 3× RS-485",
    status: "pending", lastSeen: null, agentVersion: null, configVersion: 1, configApplied: null,
    bufferPending: 0, cpuPct: null, memMb: null, diskFreePct: null, clockOffsetMs: null, ipIt: null, ipOt: null, uptimeS: null,
    enrollmentCode: "KX7P-42QD",
  },
  {
    id: "gw_br01", clientId: "cli_valeverde", unitId: "uni_brusque", name: "GW Brusque", hostname: "gw-brusque-01",
    hardware: "Gateway industrial ARM64 · 2 GB · 2× Ethernet · 1× RS-485",
    status: "offline", lastSeen: "2026-10-02T18:20:00.000Z", agentVersion: "1.0.4", configVersion: 5, configApplied: 5,
    bufferPending: 0, cpuPct: null, memMb: null, diskFreePct: null, clockOffsetMs: null, ipIt: "10.0.0.40", ipOt: "192.168.0.40", uptimeS: null,
  },
]

const tcp = (id: string, gatewayId: string, name: string, host: string, status: Device["status"] = "connected", latencyMs: number | null = 14, lastError?: string): Device => ({
  id, gatewayId, name, protocol: "modbus-tcp",
  params: { host, port: 502, unitId: 1, timeoutMs: 1000 },
  status, latencyMs, errors1m: status === "error" ? 12 : 0, lastError,
})
const rtu = (id: string, gatewayId: string, name: string, serialPort: string, unitId: number, status: Device["status"] = "connected", latencyMs: number | null = 38, lastError?: string): Device => ({
  id, gatewayId, name, protocol: "modbus-rtu",
  params: { serialPort, baudRate: 19200, parity: "E", dataBits: 8, stopBits: 1, unitId, timeoutMs: 500 },
  status, latencyMs, errors1m: status === "error" ? 7 : 0, lastError,
})

export const devices: Device[] = [
  tcp("dev_inj01", "gw_jlle01", "CLP Injetora 01", "192.168.10.21"),
  tcp("dev_inj02", "gw_jlle01", "CLP Injetora 02", "192.168.10.22"),
  tcp("dev_inj03", "gw_jlle01", "CLP Injetora 03", "192.168.10.23", "connected", 19),
  tcp("dev_inj04", "gw_jlle01", "CLP Injetora 04", "192.168.10.24", "error", null, "Timeout após 1000 ms (sem resposta do escravo)"),
  rtu("dev_sop01", "gw_jlle02", "CLP Sopradora 01", "/dev/ttyAMA2", 1),
  rtu("dev_sop02", "gw_jlle02", "Módulo I/O Sopradora 02", "/dev/ttyAMA2", 2, "connected", 41),
  tcp("dev_inj05", "gw_ctba01", "CLP Injetora 05", "192.168.30.21"),
  tcp("dev_inj06", "gw_ctba01", "CLP Injetora 06", "192.168.30.22"),
  rtu("dev_pre01", "gw_cx01", "CLP Prensas 01", "/dev/ttyAMA2", 1),
  rtu("dev_pre02", "gw_cx01", "CLP Prensas 02", "/dev/ttyAMA2", 2),
  rtu("dev_pre03", "gw_cx01", "CLP Prensa 03", "/dev/ttyAMA2", 3, "error", null, "CRC inválido na resposta (verificar terminação e paridade)"),
  tcp("dev_cnc01", "gw_cx01", "CNC 01 (Modbus TCP)", "192.168.1.31"),
  tcp("dev_cnc02", "gw_cx01", "CNC 02 (Modbus TCP)", "192.168.1.32", "connected", 22),
  rtu("dev_tea01", "gw_br01", "CLP Teares", "/dev/ttyAMA2", 1, "disabled", null),
]

function standardTags(machineId: string, deviceId: string, prefix: string, counter = 1_048_213): Tag[] {
  return [
    { id: `tag_${prefix}_run`, deviceId, machineId, name: "Máquina em ciclo automático", role: "state.running", area: "coil", address: 0, dataType: "bool", byteOrder: "ABCD", pollMs: 250, lastValue: "1", quality: "good" },
    { id: `tag_${prefix}_flt`, deviceId, machineId, name: "Alarme ativo", role: "state.fault", area: "coil", address: 1, dataType: "bool", byteOrder: "ABCD", pollMs: 250, lastValue: "0", quality: "good" },
    { id: `tag_${prefix}_fcode`, deviceId, machineId, name: "Código do alarme", role: "fault.code", area: "holding_register", address: 10, dataType: "uint16", byteOrder: "ABCD", pollMs: 500, lastValue: "0", quality: "good" },
    { id: `tag_${prefix}_total`, deviceId, machineId, name: "Contador de ciclos", role: "count.total", area: "holding_register", address: 100, dataType: "uint32", byteOrder: "CDAB", pollMs: 500, lastValue: String(counter), quality: "good" },
    { id: `tag_${prefix}_rej`, deviceId, machineId, name: "Contador de refugo", role: "count.reject", area: "holding_register", address: 102, dataType: "uint32", byteOrder: "CDAB", pollMs: 500, lastValue: String(Math.round(counter * 0.018)), quality: "good" },
    { id: `tag_${prefix}_prod`, deviceId, machineId, name: "Receita / produto atual", role: "product.code", area: "holding_register", address: 20, dataType: "uint16", byteOrder: "ABCD", pollMs: 1000, lastValue: "1201", quality: "good" },
    { id: `tag_${prefix}_temp`, deviceId, machineId, name: "Temperatura do molde (°C)", role: "custom", area: "input_register", address: 0, dataType: "float32", byteOrder: "CDAB", pollMs: 1000, lastValue: "212.4", quality: "good" },
  ]
}

export const tags: Tag[] = [
  ...standardTags("mch_inj01", "dev_inj01", "inj01"),
  ...standardTags("mch_inj02", "dev_inj02", "inj02", 845_120),
  ...standardTags("mch_inj03", "dev_inj03", "inj03", 512_998),
  ...standardTags("mch_inj04", "dev_inj04", "inj04", 77_310).map((t) => ({ ...t, quality: "bad" as const, lastValue: "—" })),
  ...standardTags("mch_sop01", "dev_sop01", "sop01", 2_310_455),
  {
    id: "tag_sop02_pulse", deviceId: "dev_sop02", machineId: "mch_sop02", name: "Contador de pulsos (entrada DI0)", role: "count.total",
    area: "input_register", address: 16, dataType: "uint32", byteOrder: "CDAB", pollMs: 500, lastValue: "1984331", quality: "good",
  },
  ...standardTags("mch_inj05", "dev_inj05", "inj05", 301_552).map((t) => ({ ...t, quality: "stale" as const })),
  ...standardTags("mch_inj06", "dev_inj06", "inj06", 288_004).map((t) => ({ ...t, quality: "stale" as const })),
  ...standardTags("mch_pre01", "dev_pre01", "pre01", 5_402_118),
  ...standardTags("mch_pre02", "dev_pre02", "pre02", 4_981_002),
  ...standardTags("mch_pre03", "dev_pre03", "pre03", 1_220_340).map((t) => ({ ...t, quality: "bad" as const, lastValue: "—" })),
  ...standardTags("mch_cnc01", "dev_cnc01", "cnc01", 18_220),
  ...standardTags("mch_cnc02", "dev_cnc02", "cnc02", 15_904),
]

/** Escopo "todo o cliente" (inclui unidades e máquinas criadas no futuro). */
const ALL = { kind: "all" } as const

export const users: User[] = [
  // Equipe Engemase (plataforma)
  { id: "usr_ana", name: "Ana Ribeiro", email: "ana.ribeiro@engemase.exemplo.com.br", username: null, platformRole: "super_admin", memberships: [], status: "active", lastLoginAt: "2026-11-11T11:05:00.000Z", twoFactor: true },
  { id: "usr_carlos", name: "Carlos Mendes", email: "carlos.mendes@engemase.exemplo.com.br", username: null, platformRole: "support", memberships: [], status: "active", lastLoginAt: "2026-11-10T19:12:00.000Z", twoFactor: true },
  { id: "usr_diego", name: "Diego Souza", email: "diego.souza@engemase.exemplo.com.br", username: null, platformRole: "field_engineer", memberships: [], status: "active", lastLoginAt: "2026-11-11T09:40:00.000Z", twoFactor: false },
  // Plastiform
  { id: "usr_marcos", name: "Marcos Lima", email: "marcos.lima@plastiform.exemplo.com.br", username: null, platformRole: null, memberships: [{ clientId: "cli_plastiform", role: "client_admin", scope: ALL }], status: "active", lastLoginAt: "2026-11-11T12:30:00.000Z", twoFactor: true },
  { id: "usr_juliana", name: "Juliana Costa", email: "juliana.costa@plastiform.exemplo.com.br", username: null, platformRole: null, memberships: [{ clientId: "cli_plastiform", role: "supervisor", scope: { kind: "units", unitIds: ["uni_jlle"] } }], status: "active", lastLoginAt: "2026-11-11T09:02:00.000Z", twoFactor: false },
  { id: "usr_pedro", name: "Pedro Alves", email: "pedro.alves@plastiform.exemplo.com.br", username: null, platformRole: null, memberships: [{ clientId: "cli_plastiform", role: "engineer", scope: ALL }], status: "active", lastLoginAt: "2026-11-09T14:10:00.000Z", twoFactor: false },
  { id: "usr_fernanda", name: "Fernanda Rocha", email: "fernanda.rocha@plastiform.exemplo.com.br", username: null, platformRole: null, memberships: [{ clientId: "cli_plastiform", role: "supervisor", scope: { kind: "units", unitIds: ["uni_ctba"] } }], status: "invited", lastLoginAt: null, twoFactor: false },
  { id: "usr_opinja", name: "Operador Injeção A", email: null, username: "op.injecao-a", platformRole: null, memberships: [{ clientId: "cli_plastiform", role: "operator", scope: { kind: "units", unitIds: ["uni_jlle"] } }], status: "active", lastLoginAt: "2026-11-11T09:01:00.000Z", twoFactor: false },
  // Escopo por máquina (D11): vê só as três primeiras injetoras da Linha Injeção A.
  { id: "usr_bruno", name: "Bruno Azevedo", email: "bruno.azevedo@plastiform.exemplo.com.br", username: null, platformRole: null, memberships: [{ clientId: "cli_plastiform", role: "supervisor", scope: { kind: "machines", machineIds: ["mch_inj01", "mch_inj02", "mch_inj03"] } }], status: "active", lastLoginAt: "2026-11-11T07:45:00.000Z", twoFactor: false },
  { id: "usr_tvinja", name: "TV Linha Injeção A", email: null, username: "tv.injecao-a", platformRole: null, memberships: [{ clientId: "cli_plastiform", role: "viewer", scope: { kind: "units", unitIds: ["uni_jlle"] } }], status: "active", lastLoginAt: "2026-11-11T06:00:00.000Z", twoFactor: false },
  // Serra Azul
  { id: "usr_renata", name: "Renata Faria", email: "renata@serraazul.exemplo.com.br", username: null, platformRole: null, memberships: [{ clientId: "cli_serra", role: "client_admin", scope: ALL }], status: "active", lastLoginAt: "2026-11-11T10:15:00.000Z", twoFactor: true },
  { id: "usr_tiago", name: "Tiago Nunes", email: "tiago.nunes@serraazul.exemplo.com.br", username: null, platformRole: null, memberships: [{ clientId: "cli_serra", role: "supervisor", scope: ALL }], status: "active", lastLoginAt: "2026-11-10T22:40:00.000Z", twoFactor: false },
  { id: "usr_gustavo", name: "Gustavo Reis", email: "gustavo.reis@serraazul.exemplo.com.br", username: null, platformRole: null, memberships: [{ clientId: "cli_serra", role: "engineer", scope: { kind: "machines", machineIds: ["mch_cnc01", "mch_cnc02"] } }], status: "active", lastLoginAt: "2026-11-10T16:20:00.000Z", twoFactor: false },
  { id: "usr_opest", name: "Operador Estamparia", email: null, username: "op.estamparia", platformRole: null, memberships: [{ clientId: "cli_serra", role: "operator", scope: ALL }], status: "active", lastLoginAt: "2026-11-11T08:00:00.000Z", twoFactor: false },
  // Bom Sabor
  { id: "usr_luis", name: "Luís Andrade", email: "luis.andrade@bomsabor.exemplo.com.br", username: null, platformRole: null, memberships: [{ clientId: "cli_bomsabor", role: "client_admin", scope: ALL }], status: "invited", lastLoginAt: null, twoFactor: false },
  // Vale Verde
  { id: "usr_paula", name: "Paula Teixeira", email: "paula@valeverde.exemplo.com.br", username: null, platformRole: null, memberships: [{ clientId: "cli_valeverde", role: "client_admin", scope: ALL }], status: "disabled", lastLoginAt: "2026-09-30T13:00:00.000Z", twoFactor: false },
  // Consultor com acesso a dois clientes
  { id: "usr_rafael", name: "Rafael Prado", email: "rafael@consultoria-lean.exemplo.com.br", username: null, platformRole: null, memberships: [{ clientId: "cli_plastiform", role: "viewer", scope: ALL }, { clientId: "cli_serra", role: "viewer", scope: ALL }], status: "active", lastLoginAt: "2026-11-08T16:00:00.000Z", twoFactor: false },
]

export const products: Product[] = [
  { id: "prd_1201", clientId: "cli_plastiform", code: "1201", name: "Tampa 28 mm branca", idealCycles: [{ machineId: "mch_inj01", idealCycleS: 18 }, { machineId: "mch_inj02", idealCycleS: 18 }] },
  { id: "prd_1202", clientId: "cli_plastiform", code: "1202", name: "Tampa 38 mm azul", idealCycles: [{ machineId: "mch_inj03", idealCycleS: 22 }, { machineId: "mch_inj04", idealCycleS: 22 }] },
  { id: "prd_2100", clientId: "cli_plastiform", code: "2100", name: "Frasco PEAD 500 ml", idealCycles: [{ machineId: "mch_sop01", idealCycleS: 6 }, { machineId: "mch_sop02", idealCycleS: 6 }] },
  { id: "prd_1310", clientId: "cli_plastiform", code: "1310", name: "Pote 1 L com alça", idealCycles: [{ machineId: "mch_inj05", idealCycleS: 25 }, { machineId: "mch_inj06", idealCycleS: 25 }] },
  { id: "prd_ss10", clientId: "cli_serra", code: "SS-10", name: "Suporte estampado SS-10", idealCycles: [{ machineId: "mch_pre01", idealCycleS: 3 }, { machineId: "mch_pre02", idealCycleS: 3 }] },
  { id: "prd_fl22", clientId: "cli_serra", code: "FL-22", name: "Flange FL-22", idealCycles: [{ machineId: "mch_pre03", idealCycleS: 8 }, { machineId: "mch_cnc01", idealCycleS: 95 }, { machineId: "mch_cnc02", idealCycleS: 110 }] },
  { id: "prd_suco1l", clientId: "cli_bomsabor", code: "SU-1000", name: "Suco de uva 1 L", idealCycles: [{ machineId: "mch_env01", idealCycleS: 1.2 }, { machineId: "mch_rot01", idealCycleS: 1 }] },
]

const weekdays = [1, 2, 3, 4, 5]
const sixDays = [1, 2, 3, 4, 5, 6]
export const shifts: Shift[] = [
  { id: "sft_jlle_1", clientId: "cli_plastiform", unitId: "uni_jlle", name: "1º turno", start: "06:00", end: "14:00", days: sixDays, breaks: [{ name: "Refeição", start: "10:00", end: "10:30" }] },
  { id: "sft_jlle_2", clientId: "cli_plastiform", unitId: "uni_jlle", name: "2º turno", start: "14:00", end: "22:00", days: sixDays, breaks: [{ name: "Refeição", start: "18:00", end: "18:30" }] },
  { id: "sft_jlle_3", clientId: "cli_plastiform", unitId: "uni_jlle", name: "3º turno", start: "22:00", end: "06:00", days: weekdays, breaks: [{ name: "Refeição", start: "02:00", end: "02:30" }] },
  { id: "sft_ctba_1", clientId: "cli_plastiform", unitId: "uni_ctba", name: "Turno A", start: "06:00", end: "15:48", days: weekdays, breaks: [{ name: "Refeição", start: "11:00", end: "12:00" }] },
  { id: "sft_cx_1", clientId: "cli_serra", unitId: "uni_caxias", name: "Manhã", start: "05:00", end: "13:30", days: weekdays, breaks: [{ name: "Café", start: "08:30", end: "08:45" }, { name: "Refeição", start: "11:00", end: "11:30" }] },
  { id: "sft_cx_2", clientId: "cli_serra", unitId: "uni_caxias", name: "Tarde", start: "13:30", end: "22:00", days: weekdays, breaks: [{ name: "Refeição", start: "18:00", end: "18:30" }] },
  { id: "sft_ch_1", clientId: "cli_bomsabor", unitId: "uni_chapeco", name: "Turno único", start: "07:00", end: "17:00", days: weekdays, breaks: [{ name: "Refeição", start: "12:00", end: "13:00" }] },
]

function reasonTree(clientId: string): DowntimeReason[] {
  const p = clientId.replace("cli_", "")
  return [
    { id: `rsn_${p}_mec`, clientId, parentId: null, name: "Mecânica", category: "unplanned" },
    { id: `rsn_${p}_mec_molde`, clientId, parentId: `rsn_${p}_mec`, name: "Quebra / ajuste de molde", category: "unplanned" },
    { id: `rsn_${p}_mec_hidr`, clientId, parentId: `rsn_${p}_mec`, name: "Vazamento hidráulico", category: "unplanned" },
    { id: `rsn_${p}_ele`, clientId, parentId: null, name: "Elétrica", category: "unplanned" },
    { id: `rsn_${p}_ele_sensor`, clientId, parentId: `rsn_${p}_ele`, name: "Falha de sensor", category: "unplanned" },
    { id: `rsn_${p}_ele_motor`, clientId, parentId: `rsn_${p}_ele`, name: "Sobrecarga de motor", category: "unplanned" },
    { id: `rsn_${p}_proc`, clientId, parentId: null, name: "Processo", category: "unplanned" },
    { id: `rsn_${p}_proc_param`, clientId, parentId: `rsn_${p}_proc`, name: "Ajuste de parâmetros", category: "unplanned" },
    { id: `rsn_${p}_proc_presa`, clientId, parentId: `rsn_${p}_proc`, name: "Peça presa", category: "unplanned" },
    { id: `rsn_${p}_log`, clientId, parentId: null, name: "Logística", category: "unplanned" },
    { id: `rsn_${p}_log_mat`, clientId, parentId: `rsn_${p}_log`, name: "Falta de material", category: "unplanned" },
    { id: `rsn_${p}_log_op`, clientId, parentId: `rsn_${p}_log`, name: "Falta de operador", category: "unplanned" },
    { id: `rsn_${p}_setup`, clientId, parentId: null, name: "Setup", category: "setup" },
    { id: `rsn_${p}_setup_molde`, clientId, parentId: `rsn_${p}_setup`, name: "Troca de molde / ferramenta", category: "setup" },
    { id: `rsn_${p}_setup_cor`, clientId, parentId: `rsn_${p}_setup`, name: "Troca de produto / cor", category: "setup" },
    { id: `rsn_${p}_plan`, clientId, parentId: null, name: "Paradas planejadas", category: "planned" },
    { id: `rsn_${p}_plan_ref`, clientId, parentId: `rsn_${p}_plan`, name: "Refeição", category: "planned" },
    { id: `rsn_${p}_plan_prev`, clientId, parentId: `rsn_${p}_plan`, name: "Manutenção preventiva", category: "planned" },
    { id: `rsn_${p}_plan_sem`, clientId, parentId: `rsn_${p}_plan`, name: "Sem programação", category: "planned" },
  ]
}

export const downtimeReasons: DowntimeReason[] = clients.flatMap((c) => reasonTree(c.id))

/** Textos de alarme simulados (código do CLP → texto). */
export const faultTexts: Record<number, string> = {
  12: "Porta de segurança aberta",
  27: "Temperatura do molde fora da faixa",
  31: "Pressão hidráulica baixa",
  47: "Falta de material no funil",
  58: "Sobrecarga do motor principal",
}

export const auditLog: AuditEntry[] = [
  { id: "aud_01", clientId: "cli_plastiform", actorName: "Diego Souza", impersonatedBy: null, action: "config.publish", entity: "gateway", entityName: "GW Joinville Injeção", at: "2026-11-11T12:58:00.000Z", details: "Publicou a configuração v42 (2 tags alteradas na Injetora 03)" },
  { id: "aud_02", clientId: "cli_plastiform", actorName: "Ana Ribeiro", impersonatedBy: null, action: "tag.test_read", entity: "tag", entityName: "Contador de ciclos · Injetora 03", at: "2026-11-11T12:55:00.000Z", details: "Leitura de teste: 512998 (21 ms)" },
  { id: "aud_03", clientId: "cli_plastiform", actorName: "Marcos Lima", impersonatedBy: null, action: "user.invite", entity: "usuario", entityName: "fernanda.rocha@plastiform.exemplo.com.br", at: "2026-11-10T17:20:00.000Z", details: "Convite como Supervisor · Unidade Curitiba" },
  { id: "aud_04", clientId: "cli_plastiform", actorName: "Juliana Costa", impersonatedBy: null, action: "stop.classify", entity: "maquina", entityName: "Injetora 02", at: "2026-11-11T13:12:00.000Z", details: "Parada de 14 min classificada como \"Falta de material\"" },
  { id: "aud_05", clientId: "cli_serra", actorName: "Carlos Mendes", impersonatedBy: "Carlos Mendes (suporte Engemase)", action: "support.impersonate", entity: "cliente", entityName: "Metalúrgica Serra Azul", at: "2026-11-10T14:00:00.000Z", details: "Sessão de suporte de 25 min (chamado #1042)" },
  { id: "aud_06", clientId: "cli_serra", actorName: "Diego Souza", impersonatedBy: null, action: "shift.update", entity: "turno", entityName: "Tarde", at: "2026-11-09T11:30:00.000Z", details: "Fim do turno alterado de 21:30 para 22:00 (pedido da Renata Faria, chamado #1051)" },
  { id: "aud_07", clientId: "cli_bomsabor", actorName: "Ana Ribeiro", impersonatedBy: null, action: "client.create", entity: "cliente", entityName: "Bom Sabor Alimentos", at: "2026-11-03T12:00:00.000Z", details: "Plano Pro · 20 máquinas contratadas" },
  { id: "aud_08", clientId: "cli_bomsabor", actorName: "Diego Souza", impersonatedBy: null, action: "gateway.create", entity: "gateway", entityName: "GW Chapecó Envase", at: "2026-11-04T15:30:00.000Z", details: "Código de ativação gerado (expira em 24 h)" },
  { id: "aud_09", clientId: "cli_valeverde", actorName: "Ana Ribeiro", impersonatedBy: null, action: "client.suspend", entity: "cliente", entityName: "Têxtil Vale Verde", at: "2026-10-05T13:00:00.000Z", details: "Suspenso por inadimplência; dados preservados" },
  { id: "aud_10", clientId: null, actorName: "Ana Ribeiro", impersonatedBy: null, action: "platform.user_create", entity: "usuario", entityName: "Diego Souza", at: "2026-09-01T12:00:00.000Z", details: "Papel: Engenheiro de campo" },
]
