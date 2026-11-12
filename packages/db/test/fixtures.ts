/**
 * Dados de teste: um cliente completo, com pelo menos uma linha em TODAS as tabelas de cliente.
 * Gravado como dono do banco (superusuário no PGlite, que ignora a RLS), como faria um seed.
 */
import { randomUUID } from "node:crypto"
import { sha256Hex } from "../src/lookups"
import * as s from "../src/schema/index"
import type { TestDb } from "./helpers"

export interface SeededTenant {
  readonly organizationId: string
  readonly slug: string
  readonly userId: string
  readonly memberId: string
  /** Vínculo da pessoa principal: supervisor com escopo `units` (Planta 1). */
  readonly memberAccessId: string
  /** Segunda pessoa: operador com escopo `machines` (só a Injetora 03), D11. */
  readonly operatorUserId: string
  readonly machineAccessId: string
  readonly unitId: string
  readonly otherUnitId: string
  readonly areaId: string
  readonly lineId: string
  readonly machineId: string
  readonly unlinkedMachineId: string
  readonly gatewayId: string
  readonly serialBusId: string
  readonly deviceId: string
  readonly rtuDeviceId: string
  readonly tagId: string
  readonly productId: string
  readonly shiftId: string
  readonly reasonId: string
  readonly terminalId: string
  readonly alertRuleId: string
  readonly remoteSessionId: string
  readonly qualityEntryId: string
  /** Tokens em claro (o banco só guarda o hash). */
  readonly gatewayToken: string
  readonly enrollmentCode: string
  readonly terminalToken: string
  readonly accountToken: string
}

const HOUR = 3_600_000

function first<T>(rows: readonly T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error("insert sem retorno")
  return row
}

/** Cria um cliente completo. `slug` também serve de prefixo para nomes e e-mails. */
export async function seedTenant(db: TestDb, slug: string): Promise<SeededTenant> {
  const now = Date.now()
  const org = first(
    await db
      .insert(s.organization)
      .values({ name: `Cliente ${slug}`, slug })
      .returning(),
  )
  const organizationId = org.id

  await db
    .insert(s.clientAccount)
    .values({ organizationId, status: "active", plan: "piloto", limits: { machines: 50 } })

  const person = first(
    await db
      .insert(s.user)
      .values({ name: `Admin ${slug}`, email: `admin@${slug}.example` })
      .returning(),
  )
  const supportUser = first(
    await db
      .insert(s.user)
      .values({ name: `Suporte (${slug})`, email: `suporte-${slug}@engemase.example`, role: "support" })
      .returning(),
  )
  const mem = first(await db.insert(s.member).values({ organizationId, userId: person.id }).returning())
  const access = first(
    await db
      .insert(s.memberAccess)
      .values({ organizationId, memberId: mem.id, role: "supervisor", scope: "units" })
      .returning(),
  )
  // Escopo por máquina (D11): um operador que só vê a Injetora 03 (member_machine, mais abaixo).
  const operator = first(
    await db
      .insert(s.user)
      .values({ name: `Operador ${slug}`, email: `operador@${slug}.example` })
      .returning(),
  )
  const operatorMember = first(await db.insert(s.member).values({ organizationId, userId: operator.id }).returning())
  const machineAccess = first(
    await db
      .insert(s.memberAccess)
      .values({ organizationId, memberId: operatorMember.id, role: "operator", scope: "machines" })
      .returning(),
  )

  const unitRow = first(await db.insert(s.unit).values({ organizationId, name: "Planta 1" }).returning())
  const otherUnit = first(await db.insert(s.unit).values({ organizationId, name: "Planta 2" }).returning())
  await db.insert(s.memberUnit).values({ organizationId, memberAccessId: access.id, unitId: unitRow.id })

  const areaRow = first(
    await db.insert(s.area).values({ organizationId, unitId: unitRow.id, name: "Injeção" }).returning(),
  )
  const lineRow = first(
    await db
      .insert(s.line)
      .values({ organizationId, unitId: unitRow.id, areaId: areaRow.id, name: "Linha A", oeeTarget: 0.85 })
      .returning(),
  )
  const machineRow = first(
    await db
      .insert(s.machine)
      .values({
        organizationId,
        unitId: unitRow.id,
        lineId: lineRow.id,
        name: "Injetora 03",
        code: "INJ-03",
        idealCycleS: 6,
        stateRules: { mode: "state_code", map: { "0": "STOPPED", "1": "RUNNING", "2": "FAULT", "3": "SETUP" } },
      })
      .returning(),
  )
  await db
    .insert(s.memberMachine)
    .values({ organizationId, memberAccessId: machineAccess.id, machineId: machineRow.id })
  const unlinkedMachine = first(
    await db
      .insert(s.machine)
      .values({
        organizationId,
        unitId: unitRow.id,
        lineId: lineRow.id,
        name: "Sopradora 01",
        stateRules: { mode: "signals" },
      })
      .returning(),
  )

  const gatewayToken = `gw_live_${slug}_${randomUUID()}`
  const gw = first(
    await db
      .insert(s.gateway)
      .values({
        organizationId,
        unitId: unitRow.id,
        name: "Gateway Planta 1",
        status: "active",
        tokenHash: sha256Hex(gatewayToken),
        configVersionLatest: 1,
      })
      .returning(),
  )
  const enrollmentCode = `ENR-${slug}-${randomUUID().slice(0, 8)}`
  await db.insert(s.gatewayEnrollment).values({
    organizationId,
    gatewayId: gw.id,
    codeHash: sha256Hex(enrollmentCode),
    expiresAt: new Date(now + 24 * HOUR),
  })
  const bus = first(
    await db
      .insert(s.serialBus)
      .values({ organizationId, gatewayId: gw.id, port: "rs485-1", baud: 19200, parity: "E", stopBits: 1 })
      .returning(),
  )
  const dev = first(
    await db
      .insert(s.device)
      .values({
        organizationId,
        gatewayId: gw.id,
        name: "CLP Injetora 03",
        protocol: "modbus-tcp",
        params: { host: "192.168.10.21", port: 502, unit_id: 1 },
      })
      .returning(),
  )
  const rtuDev = first(
    await db
      .insert(s.device)
      .values({
        organizationId,
        gatewayId: gw.id,
        serialBusId: bus.id,
        name: "Escravo RTU 5",
        protocol: "modbus-rtu",
        params: { bus: bus.id, unit_id: 5 },
      })
      .returning(),
  )
  await db
    .insert(s.gatewayMachine)
    .values({ organizationId, gatewayId: gw.id, machineId: machineRow.id, unitId: unitRow.id })
  const tagRow = first(
    await db
      .insert(s.tag)
      .values({
        organizationId,
        gatewayId: gw.id,
        deviceId: dev.id,
        machineId: machineRow.id,
        name: "Estado",
        address: { area: "holding_register", offset: 1000 },
        dataType: "uint16",
        pollMs: 1000,
        role: "state.code",
      })
      .returning(),
  )
  await db.insert(s.gatewayConfigVersion).values({
    organizationId,
    gatewayId: gw.id,
    version: 1,
    snapshot: {
      config_version: 1,
      serial_buses: [],
      devices: [],
      machines: [],
      uplink: { sync_interval_s: 10, max_batch_items: 500 },
    },
  })
  await db.insert(s.gatewayCommand).values({
    organizationId,
    gatewayId: gw.id,
    type: "tag.read",
    payload: { device_id: dev.id },
    expiresAt: new Date(now + 120_000),
  })
  await db
    .insert(s.gatewayDeviceStatus)
    .values({ organizationId, gatewayId: gw.id, deviceId: dev.id, status: "connected" })

  const prod = first(
    await db.insert(s.product).values({ organizationId, code: "PRD-001", name: "Tampa 28 mm" }).returning(),
  )
  await db
    .insert(s.productMachine)
    .values({ organizationId, productId: prod.id, machineId: machineRow.id, idealCycleS: 6 })
  const shiftRow = first(
    await db
      .insert(s.shift)
      .values({
        organizationId,
        unitId: unitRow.id,
        name: "Turno 1",
        startTime: "06:00",
        endTime: "14:00",
        daysOfWeek: [1, 2, 3, 4, 5],
        breaks: [{ start: "10:00", end: "10:30", name: "Refeição" }],
      })
      .returning(),
  )
  const reason = first(
    await db
      .insert(s.downtimeReason)
      .values({ organizationId, name: "Falta de material", category: "unplanned" })
      .returning(),
  )
  await db.insert(s.plannedDowntime).values({
    organizationId,
    unitId: unitRow.id,
    lineId: lineRow.id,
    reasonId: reason.id,
    name: "Manutenção preventiva",
    startsAt: new Date(now + 48 * HOUR),
    endsAt: new Date(now + 50 * HOUR),
  })
  await db
    .insert(s.faultCodeMap)
    .values({ organizationId, machineId: machineRow.id, faultCode: 47, reasonId: reason.id })

  const minute = new Date(Math.floor(now / 60_000) * 60_000 - 60_000)
  await db.insert(s.machineStateEvent).values({
    organizationId,
    machineId: machineRow.id,
    state: "STOPPED",
    startedAt: new Date(minute.getTime() - 600_000),
    endedAt: minute,
    reasonId: reason.id,
  })
  await db.insert(s.productionMinute).values({
    organizationId,
    machineId: machineRow.id,
    bucketStart: minute,
    runS: 42,
    stopS: 0,
    faultS: 18,
    setupS: 0,
    noCommS: 0,
    total: 14,
    reject: 1,
    good: 13,
    productCode: "PRD-001",
  })
  await db.insert(s.productionRun).values({
    organizationId,
    machineId: machineRow.id,
    productId: prod.id,
    productCode: "PRD-001",
    startedAt: new Date(now - 4 * HOUR),
    source: "plc",
  })
  const quality = first(
    await db
      .insert(s.qualityEntry)
      .values({ organizationId, machineId: machineRow.id, at: minute, quantity: 3, reason: "Rebarba" })
      .returning(),
  )
  await db.insert(s.machineLive).values({
    organizationId,
    machineId: machineRow.id,
    state: "RUNNING",
    stateSince: minute,
    counterTotal: 1_048_213,
    speed: 598.5,
    at: new Date(now),
  })
  await db.insert(s.tagSample).values({ organizationId, tagId: tagRow.id, at: minute, value: 1 })
  await db.insert(s.oeeShift).values({
    organizationId,
    machineId: machineRow.id,
    shiftDate: "2026-11-11",
    shiftId: shiftRow.id,
    plannedS: 27_000,
    runS: 24_300,
    total: 3600,
    good: 3528,
    reject: 72,
    oee: 0.784,
    dirty: false,
  })

  const assignment = first(
    await db
      .insert(s.platformAssignment)
      .values({
        organizationId,
        userId: supportUser.id,
        reason: "Comissionamento",
        validUntil: new Date(now + 7 * 24 * HOUR),
        createdBy: supportUser.id,
      })
      .returning(),
  )
  await db.insert(s.platformAssignmentUnit).values({ organizationId, assignmentId: assignment.id, unitId: unitRow.id })
  await db.insert(s.supportAccessGrant).values({
    organizationId,
    userId: supportUser.id,
    reason: "Chamado de suporte",
    ticket: "#1042",
    status: "active",
    startsAt: new Date(now),
    endsAt: new Date(now + 2 * HOUR),
  })
  const terminalToken = `term_${slug}_${randomUUID()}`
  const term = first(
    await db
      .insert(s.terminal)
      .values({
        organizationId,
        unitId: unitRow.id,
        name: "TV Linha A",
        kind: "tv",
        lineIds: [lineRow.id],
        tokenHash: sha256Hex(terminalToken),
        pairedBy: person.id,
        pairedAt: new Date(now),
        expiresAt: new Date(now + 90 * 24 * HOUR),
      })
      .returning(),
  )
  const accountToken = `acct_${slug}_${randomUUID()}`
  await db.insert(s.accountToken).values({
    organizationId,
    purpose: "set_password",
    tokenHash: sha256Hex(accountToken),
    userId: person.id,
    expiresAt: new Date(now + 24 * HOUR),
  })

  const rule = first(
    await db
      .insert(s.alertRule)
      .values({
        organizationId,
        name: "Máquina parada",
        type: "machine_stopped",
        severity: "warning",
        params: { minDurationMin: 10 },
      })
      .returning(),
  )
  const alert = first(
    await db
      .insert(s.alertEvent)
      .values({
        organizationId,
        ruleId: rule.id,
        machineId: machineRow.id,
        dedupKey: machineRow.id,
        severity: "warning",
      })
      .returning(),
  )
  const notif = first(
    await db
      .insert(s.notification)
      .values({
        organizationId,
        userId: person.id,
        alertEventId: alert.id,
        kind: "alert",
        title: "Injetora 03 parada",
        link: `/${slug}/maquinas/${machineRow.id}`,
      })
      .returning(),
  )
  const sub = first(
    await db
      .insert(s.pushSubscription)
      .values({
        organizationId,
        userId: person.id,
        endpoint: `https://push.example/${slug}`,
        p256dh: "p256dh",
        auth: "auth",
      })
      .returning(),
  )
  await db
    .insert(s.notificationDelivery)
    .values({ organizationId, notificationId: notif.id, channel: "push", pushSubscriptionId: sub.id })
  await db.insert(s.notificationPreference).values({ organizationId, userId: person.id, channels: ["push", "email"] })

  await db.insert(s.remoteAccessPolicy).values({ organizationId })
  const session = first(
    await db
      .insert(s.remoteAccessSession)
      .values({
        organizationId,
        gatewayId: gw.id,
        requestedBy: supportUser.id,
        reason: "Diagnóstico",
        ticket: "#1042",
        requestedDurationMin: 60,
      })
      .returning(),
  )
  await db.insert(s.remoteAccessForward).values({
    organizationId,
    sessionId: session.id,
    gatewayId: gw.id,
    deviceId: dev.id,
    targetHost: "192.168.10.21",
    targetPort: 502,
    requestedBy: supportUser.id,
    requestedDurationMin: 30,
  })
  await db.insert(s.remoteAccessEvent).values({ organizationId, sessionId: session.id, type: "requested" })
  await db.insert(s.auditLog).values({
    organizationId,
    actorType: "user",
    actorId: person.id,
    action: "machine.create",
    entityType: "machine",
    entityId: machineRow.id,
  })

  return {
    organizationId,
    slug,
    userId: person.id,
    memberId: mem.id,
    memberAccessId: access.id,
    operatorUserId: operator.id,
    machineAccessId: machineAccess.id,
    unitId: unitRow.id,
    otherUnitId: otherUnit.id,
    areaId: areaRow.id,
    lineId: lineRow.id,
    machineId: machineRow.id,
    unlinkedMachineId: unlinkedMachine.id,
    gatewayId: gw.id,
    serialBusId: bus.id,
    deviceId: dev.id,
    rtuDeviceId: rtuDev.id,
    tagId: tagRow.id,
    productId: prod.id,
    shiftId: shiftRow.id,
    reasonId: reason.id,
    terminalId: term.id,
    alertRuleId: rule.id,
    remoteSessionId: session.id,
    qualityEntryId: quality.id,
    gatewayToken,
    enrollmentCode,
    terminalToken,
    accountToken,
  }
}

/** Evento de plataforma (sem cliente) na auditoria: invisível para o papel da aplicação. */
export async function seedPlatformAuditEvent(db: TestDb): Promise<void> {
  await db.insert(s.auditLog).values({ actorType: "engemase", action: "platform.login", actorLabel: "Super admin" })
}
