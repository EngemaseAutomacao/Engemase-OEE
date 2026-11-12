/**
 * Conectividade: gateways, barramentos RS-485, dispositivos (CLPs), tags, vínculo gateway ↔ máquina,
 * versões de config, fila de comandos e saúde (docs/03, docs/04, docs/06 "3. Conectividade").
 *
 * Garantias no banco (docs/15, seção 4, itens 5 e 7):
 * - todas as ligações usam FK composta com `organization_id`;
 * - `gateway_machine` só liga gateway e máquina da MESMA unidade (e do mesmo cliente);
 * - uma máquina é alimentada por no máximo um gateway;
 * - a tag aponta para um dispositivo do gateway e para uma máquina ligada a ESSE gateway
 *   (FK para `gateway_machine`): um gateway nunca alimenta máquina de outro gateway.
 */
import type {
  Block,
  GatewayConfig,
  HardwareInfo,
  ModbusAddress,
  ModbusRtuOverTcpParams,
  ModbusRtuParams,
  ModbusTcpParams,
  Scale,
  TagSampling,
} from "@engemase/contracts"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import { createdAt, deletedAt, isSha256Hex, oneOf, pk, tstz, updatedAt } from "./_columns"
import { organizationId } from "./_tenant"
import { machine, unit } from "./assets"
import {
  BAUD_RATES,
  COMMAND_STATUSES,
  DATA_TYPES,
  DEVICE_CONN_STATUSES,
  GATEWAY_STATUSES,
  PARITIES,
  PROTOCOLS,
  TAG_ROLES,
  WORD_ORDERS,
} from "./enums"

/** Métricas da última foto de saúde enviada no `/sync` (campo `agent`). */
export interface GatewayHealth {
  readonly uptime_s?: number
  readonly cpu_pct?: number
  readonly mem_mb?: number
  readonly disk_free_mb?: number
  readonly buffer_pending?: number
  readonly clock_offset_ms?: number
  readonly [key: string]: unknown
}

export const gateway = pgTable(
  "gateway",
  {
    id: pk(),
    organizationId: organizationId(),
    unitId: uuid("unit_id").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: GATEWAY_STATUSES }).notNull().default("pending_enrollment"),
    /** SHA-256 (hex) do token `gw_live_...`; o token em si nunca é guardado (docs/04). */
    tokenHash: text("token_hash").unique("gateway_token_hash_uq"),
    /** Token anterior, aceito por mais alguns minutos depois de `token.rotate`. */
    previousTokenHash: text("previous_token_hash"),
    previousTokenExpiresAt: tstz("previous_token_expires_at"),
    revokedAt: tstz("revoked_at"),
    lastSeenAt: tstz("last_seen_at"),
    hostname: text("hostname"),
    agentVersion: text("agent_version"),
    /** Última versão de config publicada (para responder `config.latest_version` no `/sync`). */
    configVersionLatest: integer("config_version_latest").notNull().default(0),
    /** Versão de config que o agente diz ter aplicado. */
    configVersionApplied: integer("config_version_applied"),
    hwInfo: jsonb("hw_info").$type<HardwareInfo>(),
    health: jsonb("health").$type<GatewayHealth>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("gateway_id_org_uq").on(t.id, t.organizationId),
    unique("gateway_id_unit_org_uq").on(t.id, t.unitId, t.organizationId),
    // Busca pelo token anterior durante a rotação (app.resolve_gateway_token*, a cada requisição).
    index("gateway_previous_token_hash_idx")
      .on(t.previousTokenHash)
      .where(sql`${t.previousTokenHash} IS NOT NULL`),
    foreignKey({
      name: "gateway_unit_fk",
      columns: [t.unitId, t.organizationId],
      foreignColumns: [unit.id, unit.organizationId],
    }),
    check("gateway_status_chk", oneOf(t.status, GATEWAY_STATUSES)),
    check("gateway_token_hash_chk", sql`${t.tokenHash} IS NULL OR ${isSha256Hex(t.tokenHash)}`),
    check(
      "gateway_previous_token_chk",
      sql`${t.previousTokenHash} IS NULL OR (${isSha256Hex(t.previousTokenHash)} AND ${t.previousTokenExpiresAt} IS NOT NULL)`,
    ),
    check("gateway_active_token_chk", sql`${t.status} <> 'active' OR ${t.tokenHash} IS NOT NULL`),
    check("gateway_revoked_chk", sql`(${t.status} = 'revoked') = (${t.revokedAt} IS NOT NULL)`),
  ],
)

/** Código de ativação de uso único (8 caracteres, expira em 24 h), guardado só como hash (docs/04). */
export const gatewayEnrollment = pgTable(
  "gateway_enrollment",
  {
    id: pk(),
    organizationId: organizationId(),
    gatewayId: uuid("gateway_id").notNull(),
    codeHash: text("code_hash").notNull().unique("gateway_enrollment_code_hash_uq"),
    expiresAt: tstz("expires_at").notNull(),
    usedAt: tstz("used_at"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "gateway_enrollment_gateway_fk",
      columns: [t.gatewayId, t.organizationId],
      foreignColumns: [gateway.id, gateway.organizationId],
    }).onDelete("cascade"),
    check("gateway_enrollment_code_hash_chk", isSha256Hex(t.codeHash)),
    check("gateway_enrollment_expiry_chk", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
)

/** Barramento RS-485 do gateway (um mestre, vários escravos com a mesma config serial). */
export const serialBus = pgTable(
  "serial_bus",
  {
    id: pk(),
    organizationId: organizationId(),
    gatewayId: uuid("gateway_id").notNull(),
    name: text("name"),
    /** Porta lógica do perfil de hardware (ex.: rs485-1) ou /dev/... */
    port: text("port").notNull(),
    baud: integer("baud").notNull(),
    parity: text("parity", { enum: PARITIES }).notNull(),
    dataBits: smallint("data_bits").notNull().default(8),
    stopBits: smallint("stop_bits").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("serial_bus_id_org_uq").on(t.id, t.organizationId),
    unique("serial_bus_id_gateway_org_uq").on(t.id, t.gatewayId, t.organizationId),
    unique("serial_bus_gateway_port_uq").on(t.gatewayId, t.port),
    foreignKey({
      name: "serial_bus_gateway_fk",
      columns: [t.gatewayId, t.organizationId],
      foreignColumns: [gateway.id, gateway.organizationId],
    }).onDelete("cascade"),
    check("serial_bus_baud_chk", sql`${t.baud} IN (${sql.raw(BAUD_RATES.join(", "))})`),
    check("serial_bus_parity_chk", oneOf(t.parity, PARITIES)),
    check("serial_bus_data_bits_chk", sql`${t.dataBits} = 8`),
    check("serial_bus_stop_bits_chk", sql`${t.stopBits} IN (1, 2)`),
  ],
)

/** Parâmetros de conexão por protocolo, no formato do contrato (validados com Zod na API). */
export type DeviceParams = ModbusTcpParams | ModbusRtuParams | ModbusRtuOverTcpParams

/** Dispositivo (CLP, módulo de I/O ou escravo RTU) ligado a um gateway. */
export const device = pgTable(
  "device",
  {
    id: pk(),
    organizationId: organizationId(),
    gatewayId: uuid("gateway_id").notNull(),
    /** Obrigatório (e só permitido) em Modbus RTU: barramento do MESMO gateway. */
    serialBusId: uuid("serial_bus_id"),
    name: text("name").notNull(),
    protocol: text("protocol", { enum: PROTOCOLS }).notNull(),
    params: jsonb("params").$type<DeviceParams>().notNull(),
    blocks: jsonb("blocks").$type<Block[]>().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("device_id_org_uq").on(t.id, t.organizationId),
    unique("device_id_gateway_org_uq").on(t.id, t.gatewayId, t.organizationId),
    foreignKey({
      name: "device_gateway_fk",
      columns: [t.gatewayId, t.organizationId],
      foreignColumns: [gateway.id, gateway.organizationId],
    }),
    foreignKey({
      name: "device_serial_bus_fk",
      columns: [t.serialBusId, t.gatewayId, t.organizationId],
      foreignColumns: [serialBus.id, serialBus.gatewayId, serialBus.organizationId],
    }),
    check("device_protocol_chk", oneOf(t.protocol, PROTOCOLS)),
    check("device_serial_bus_chk", sql`(${t.protocol} = 'modbus-rtu') = (${t.serialBusId} IS NOT NULL)`),
    // Em RTU, o barramento também vai em `params.bus` (formato do contrato): os dois precisam bater.
    check(
      "device_params_bus_chk",
      sql`${t.protocol} <> 'modbus-rtu' OR (${t.params} ->> 'bus') = ${t.serialBusId}::text`,
    ),
    check("device_blocks_chk", sql`jsonb_typeof(${t.blocks}) = 'array'`),
  ],
)

/**
 * Vínculo explícito gateway ↔ máquina (docs/15, item 5). A API do gateway só aceita dados de
 * máquinas ligadas ao gateway autenticado.
 */
export const gatewayMachine = pgTable(
  "gateway_machine",
  {
    organizationId: organizationId(),
    gatewayId: uuid("gateway_id").notNull(),
    machineId: uuid("machine_id").notNull(),
    /** Unidade comum ao gateway e à máquina (garantida pelas duas FKs compostas). */
    unitId: uuid("unit_id").notNull(),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "gateway_machine_pk", columns: [t.gatewayId, t.machineId] }),
    unique("gateway_machine_gateway_machine_org_uq").on(t.gatewayId, t.machineId, t.organizationId),
    // Uma máquina é alimentada por um único gateway (os minutos têm PK por máquina).
    unique("gateway_machine_machine_uq").on(t.machineId),
    foreignKey({
      name: "gateway_machine_gateway_fk",
      columns: [t.gatewayId, t.unitId, t.organizationId],
      foreignColumns: [gateway.id, gateway.unitId, gateway.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "gateway_machine_machine_fk",
      columns: [t.machineId, t.unitId, t.organizationId],
      foreignColumns: [machine.id, machine.unitId, machine.organizationId],
    }).onDelete("cascade"),
  ],
)

export const tag = pgTable(
  "tag",
  {
    id: pk(),
    organizationId: organizationId(),
    /** Desnormalizado do dispositivo (garantido pela FK composta). */
    gatewayId: uuid("gateway_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    /** Obrigatório, exceto no papel `custom`. */
    machineId: uuid("machine_id"),
    name: text("name"),
    address: jsonb("address").$type<ModbusAddress>().notNull(),
    dataType: text("data_type", { enum: DATA_TYPES }).notNull(),
    wordOrder: text("word_order", { enum: WORD_ORDERS }),
    scale: jsonb("scale").$type<Scale>(),
    /** Obrigatório para tag fora de bloco (regra validada pelo contrato). */
    pollMs: integer("poll_ms"),
    role: text("role", { enum: TAG_ROLES }).notNull(),
    /** Deadband e intervalos de amostragem (papéis `custom` e `speed.actual`). */
    sampling: jsonb("sampling").$type<TagSampling>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("tag_id_org_uq").on(t.id, t.organizationId),
    foreignKey({
      name: "tag_device_fk",
      columns: [t.deviceId, t.gatewayId, t.organizationId],
      foreignColumns: [device.id, device.gatewayId, device.organizationId],
    }).onDelete("cascade"),
    // A máquina da tag precisa estar ligada ao gateway do dispositivo (e ser do mesmo cliente).
    foreignKey({
      name: "tag_gateway_machine_fk",
      columns: [t.gatewayId, t.machineId, t.organizationId],
      foreignColumns: [gatewayMachine.gatewayId, gatewayMachine.machineId, gatewayMachine.organizationId],
    }),
    foreignKey({
      name: "tag_machine_fk",
      columns: [t.machineId, t.organizationId],
      foreignColumns: [machine.id, machine.organizationId],
    }),
    index("tag_machine_idx").on(t.machineId),
    check("tag_role_chk", oneOf(t.role, TAG_ROLES)),
    check("tag_data_type_chk", oneOf(t.dataType, DATA_TYPES)),
    check("tag_word_order_chk", sql`${t.wordOrder} IS NULL OR ${oneOf(t.wordOrder, WORD_ORDERS)}`),
    check("tag_machine_required_chk", sql`${t.role} = 'custom' OR ${t.machineId} IS NOT NULL`),
    check("tag_poll_ms_chk", sql`${t.pollMs} IS NULL OR ${t.pollMs} BETWEEN 100 AND 3600000`),
  ],
)

/** Snapshot imutável de cada versão publicada da config do gateway. */
export const gatewayConfigVersion = pgTable(
  "gateway_config_version",
  {
    id: pk(),
    organizationId: organizationId(),
    gatewayId: uuid("gateway_id").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<GatewayConfig>().notNull(),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("gateway_config_version_uq").on(t.gatewayId, t.version),
    foreignKey({
      name: "gateway_config_version_gateway_fk",
      columns: [t.gatewayId, t.organizationId],
      foreignColumns: [gateway.id, gateway.organizationId],
    }).onDelete("cascade"),
    check("gateway_config_version_version_chk", sql`${t.version} >= 1`),
  ],
)

/** Fila de comandos nuvem → gateway (entregues na resposta do `/sync`, docs/04). */
export const gatewayCommand = pgTable(
  "gateway_command",
  {
    id: pk(),
    organizationId: organizationId(),
    gatewayId: uuid("gateway_id").notNull(),
    /** Tipo do comando (ex.: tag.read, vpn.enable); aceita tipos de versões futuras. */
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: COMMAND_STATUSES }).notNull().default("pending"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    sentAt: tstz("sent_at"),
    completedAt: tstz("completed_at"),
    /** Comando vencido não é executado (ex.: 2 min para tag.read). */
    expiresAt: tstz("expires_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "gateway_command_gateway_fk",
      columns: [t.gatewayId, t.organizationId],
      foreignColumns: [gateway.id, gateway.organizationId],
    }).onDelete("cascade"),
    index("gateway_command_pending_idx")
      .on(t.gatewayId, t.createdAt)
      .where(sql`${t.status} IN ('pending', 'sent')`),
    check("gateway_command_status_chk", oneOf(t.status, COMMAND_STATUSES)),
    check("gateway_command_type_chk", sql`${t.type} ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'`),
    check("gateway_command_expiry_chk", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
)

/** Última foto do estado de cada dispositivo, enviada no `/sync` (`devices`). */
export const gatewayDeviceStatus = pgTable(
  "gateway_device_status",
  {
    deviceId: uuid("device_id").primaryKey(),
    organizationId: organizationId(),
    gatewayId: uuid("gateway_id").notNull(),
    status: text("status", { enum: DEVICE_CONN_STATUSES }).notNull(),
    latencyMs: integer("latency_ms"),
    errors1m: integer("errors_1m"),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "gateway_device_status_device_fk",
      columns: [t.deviceId, t.gatewayId, t.organizationId],
      foreignColumns: [device.id, device.gatewayId, device.organizationId],
    }).onDelete("cascade"),
    check("gateway_device_status_status_chk", oneOf(t.status, DEVICE_CONN_STATUSES)),
  ],
)
