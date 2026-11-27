/**
 * Leitura das telas de acompanhamento no BANCO: tudo dentro de `withContext` (RLS do cliente da sessão)
 * e com o escopo da pessoa (D11) aplicado às máquinas; o resto (eventos, minutos, alertas...) só das
 * máquinas visíveis. Depois, `montarClienteDados` (puro) faz o cálculo com o `@engemase/oee-core`.
 *
 * Não depende do Next.js: recebe o banco, o `TenantContext` e o "agora" (testado com PGlite).
 */
import {
  alertEvent,
  alertRule,
  area,
  clientAccount,
  device,
  downtimeReason,
  clientBranding,
  clientLogo,
  faultCodeMap,
  gateway,
  gatewayDeviceStatus,
  gatewayMachine,
  line,
  machine,
  machineLive,
  machineStateEvent,
  productionRun,
  rejectReason,
  notification,
  oeeShift,
  organization,
  plannedDowntime,
  product,
  productMachine,
  productionMinute,
  qualityEntry,
  serialBus,
  shift,
  tag,
  unit,
  unitHoliday,
  user,
} from "@engemase/db"
import { and, asc, eq, gt, gte, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { CLIENT_ROLE_LABEL, PLATFORM_ROLE_LABEL } from "@/lib/roles"
import { assertPermission, hasPermission, type TenantContext } from "@/lib/server/access/context"
import { withContext } from "@/lib/server/access/load"
import { machineScopeCondition, unitScopeCondition } from "@/lib/server/access/scope"
import { brandingTokens } from "@/lib/server/config/branding"
import type { GatewayDb } from "@/lib/server/gateway/types"
import { type BrutoCliente, EVENT_MARGIN_MS, inicioDosTurnosCorrentes, montarClienteDados, STOP_WEEKS } from "./calculo"
import type { ClienteDados, NecessidadesCliente } from "./tipos"

const DAY = 24 * 60 * 60 * 1000
/** Alertas mostrados: os abertos e os dos últimos 30 dias. */
const ALERT_DAYS = 30
const ALERT_LIMIT = 200

const ms = (d: Date | string | null): number | null => (d === null ? null : new Date(d).getTime())
const msNN = (d: Date | string): number => new Date(d).getTime()

/** Lê e calcula os dados de acompanhamento do cliente do contexto. */
export async function lerClienteDoBanco(
  db: GatewayDb,
  ctx: TenantContext,
  needs: NecessidadesCliente,
  now: number,
): Promise<ClienteDados> {
  assertPermission(ctx, "data.read")
  const technical = hasPermission(ctx, "technical.read")
  const series = !needs.somenteCadastro
  const historyDays = series ? Math.max(needs.diasOee ?? 0, needs.diasTurnos ?? 0, needs.paradas ? STOP_WEEKS * 7 + 1 : 0) : 0

  const raw = await withContext(db, ctx, async (tx): Promise<{ raw: BrutoCliente; rawSince: number }> => {
    const [org] = await tx
      .select({
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        createdAt: organization.createdAt,
        status: clientAccount.status,
        plan: clientAccount.plan,
        limits: clientAccount.limits,
      })
      .from(organization)
      .leftJoin(clientAccount, eq(clientAccount.organizationId, organization.id))
      .limit(1)
    if (org === undefined) throw new Error("Cliente do contexto não encontrado sob RLS")

    const machines = await tx
      .select({
        id: machine.id,
        unitId: machine.unitId,
        lineId: machine.lineId,
        name: machine.name,
        code: machine.code,
        idealCycleS: machine.idealCycleS,
        microStopThresholdS: machine.microStopThresholdS,
        stateMode: sql<string>`${machine.stateRules} ->> 'mode'`,
        active: machine.active,
      })
      .from(machine)
      .where(and(isNull(machine.deletedAt), machineScopeCondition(ctx.scope)))
      .orderBy(asc(machine.name), asc(machine.id))
    const machineIds = machines.map((m) => m.id)
    const anyMachine = machineIds.length > 0
    const inMachines = (col: AnyPgColumn): SQL => (anyMachine ? inArray(col, machineIds) : sql`false`)

    const units = await tx
      .select({ id: unit.id, name: unit.name, timezone: unit.timezone })
      .from(unit)
      .where(and(isNull(unit.deletedAt), unitScopeCondition(ctx.scope)))
      .orderBy(asc(unit.name), asc(unit.id))
    const unitIds = units.map((u) => u.id)
    const inUnits = (col: AnyPgColumn): SQL => (unitIds.length > 0 ? inArray(col, unitIds) : sql`false`)

    const lineIdsWithMachines = [...new Set(machines.map((m) => m.lineId))]
    const lines = await tx
      .select({ id: line.id, unitId: line.unitId, areaId: line.areaId, name: line.name, sortOrder: line.sortOrder, oeeTarget: line.oeeTarget })
      .from(line)
      .where(
        and(
          isNull(line.deletedAt),
          ctx.scope.kind === "all"
            ? sql`true`
            : lineIdsWithMachines.length > 0
              ? inArray(line.id, lineIdsWithMachines)
              : sql`false`,
        ),
      )
      .orderBy(asc(line.sortOrder), asc(line.name))
    const areas = await tx
      .select({ id: area.id, unitId: area.unitId, name: area.name })
      .from(area)
      .where(and(isNull(area.deletedAt), inUnits(area.unitId)))

    const products = await tx
      .select({ id: product.id, code: product.code, name: product.name })
      .from(product)
      .where(isNull(product.deletedAt))
      .orderBy(asc(product.code))
    const productMachines = await tx
      .select({ productId: productMachine.productId, machineId: productMachine.machineId, idealCycleS: productMachine.idealCycleS })
      .from(productMachine)
      .where(inMachines(productMachine.machineId))
    const shifts = await tx
      .select({
        id: shift.id,
        unitId: shift.unitId,
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        daysOfWeek: shift.daysOfWeek,
        breaks: shift.breaks,
        validFrom: shift.validFrom,
        validTo: shift.validTo,
      })
      .from(shift)
      .where(and(isNull(shift.deletedAt), inUnits(shift.unitId)))
      .orderBy(asc(shift.startTime))
    const holidays = await tx
      .select({ unitId: unitHoliday.unitId, date: unitHoliday.holidayDate })
      .from(unitHoliday)
      .where(and(inUnits(unitHoliday.unitId), gte(unitHoliday.holidayDate, isoDate(now - (historyDays + 10) * DAY))))
    const reasons = await tx
      .select({ id: downtimeReason.id, parentId: downtimeReason.parentId, name: downtimeReason.name, category: downtimeReason.category })
      .from(downtimeReason)
      .where(isNull(downtimeReason.deletedAt))
      .orderBy(asc(downtimeReason.sortOrder), asc(downtimeReason.name))
    const [brandRow] = await tx.select().from(clientBranding).limit(1)
    const [symbolRow] = await tx.select({ sha256: clientLogo.sha256 }).from(clientLogo).where(eq(clientLogo.kind, "symbol")).limit(1)
    const faultMap = await tx
      .select({ machineId: faultCodeMap.machineId, faultCode: faultCodeMap.faultCode, text: faultCodeMap.faultText, reasonId: faultCodeMap.reasonId })
      .from(faultCodeMap)
      .where(and(isNull(faultCodeMap.templateId), or(isNull(faultCodeMap.machineId), inMachines(faultCodeMap.machineId))))

    // Turno corrente de cada unidade → de onde vêm os minutos exatos; histórico pedido → até onde voltar.
    const calendario = {
      units,
      shifts: shifts.map((s) => ({ ...s, breaks: s.breaks ?? [] })),
      holidays: holidays.map((h) => ({ unitId: h.unitId, date: h.date })),
    }
    const rawSince = Math.min(inicioDosTurnosCorrentes(calendario, now), now)
    const historyStart = historyDays > 0 ? now - (historyDays + 1) * DAY : rawSince
    const eventsFrom = new Date(Math.min(rawSince, historyStart) - EVENT_MARGIN_MS)
    const nowDate = new Date(now)

    const plannedDowntimes = await tx
      .select({
        unitId: plannedDowntime.unitId,
        lineId: plannedDowntime.lineId,
        machineId: plannedDowntime.machineId,
        startsAt: plannedDowntime.startsAt,
        endsAt: plannedDowntime.endsAt,
      })
      .from(plannedDowntime)
      .where(and(inUnits(plannedDowntime.unitId), gt(plannedDowntime.endsAt, eventsFrom), lt(plannedDowntime.startsAt, nowDate)))

    const live = !series ? [] : await tx
      .select({
        machineId: machineLive.machineId,
        state: machineLive.state,
        stateSince: machineLive.stateSince,
        faultCode: machineLive.faultCode,
        productCode: machineLive.productCode,
        at: machineLive.at,
      })
      .from(machineLive)
      .where(inMachines(machineLive.machineId))

    const events = !series ? [] : await tx
      .select({
        id: machineStateEvent.id,
        machineId: machineStateEvent.machineId,
        state: machineStateEvent.state,
        start: machineStateEvent.startedAt,
        end: machineStateEvent.endedAt,
        reasonId: machineStateEvent.reasonId,
        faultCode: machineStateEvent.faultCode,
      })
      .from(machineStateEvent)
      .where(
        and(
          inMachines(machineStateEvent.machineId),
          lt(machineStateEvent.startedAt, nowDate),
          or(isNull(machineStateEvent.endedAt), gt(machineStateEvent.endedAt, eventsFrom)),
        ),
      )
      .orderBy(asc(machineStateEvent.machineId), asc(machineStateEvent.startedAt))

    // Trocas de produto (CLP e operador) no mesmo período dos eventos: completam os minutos sem produto.
    const runs = !series ? [] : await tx
      .select({ machineId: productionRun.machineId, start: productionRun.startedAt, end: productionRun.endedAt, productCode: productionRun.productCode })
      .from(productionRun)
      .where(
        and(
          inMachines(productionRun.machineId),
          lt(productionRun.startedAt, nowDate),
          or(isNull(productionRun.endedAt), gt(productionRun.endedAt, eventsFrom)),
        ),
      )
      .orderBy(asc(productionRun.machineId), asc(productionRun.startedAt))
    const rejectReasons = await tx
      .select({ id: rejectReason.id, name: rejectReason.name })
      .from(rejectReason)
      .where(and(eq(rejectReason.active, true), isNull(rejectReason.deletedAt)))
      .orderBy(asc(rejectReason.name))

    const minutes = !series ? [] : await tx
      .select({
        machineId: productionMinute.machineId,
        start: productionMinute.bucketStart,
        total: productionMinute.total,
        reject: productionMinute.reject,
        productCode: productionMinute.productCode,
      })
      .from(productionMinute)
      .where(
        and(
          inMachines(productionMinute.machineId),
          gte(productionMinute.bucketStart, new Date(rawSince)),
          lt(productionMinute.bucketStart, nowDate),
        ),
      )

    // Histórico: blocos de 15 min (date_bin) por máquina e produto — os turnos começam em hora "redonda".
    const quarter = sql<Date>`date_bin('15 minutes', ${productionMinute.bucketStart}, timestamptz '2000-01-01 00:00:00+00')`
    const quarterMinutes =
      historyDays > 0
        ? await tx
            .select({
              machineId: productionMinute.machineId,
              start: quarter,
              total: sql<number>`sum(${productionMinute.total})::int`,
              reject: sql<number>`sum(${productionMinute.reject})::int`,
              productCode: productionMinute.productCode,
            })
            .from(productionMinute)
            .where(
              and(
                inMachines(productionMinute.machineId),
                gte(productionMinute.bucketStart, new Date(historyStart)),
                lt(productionMinute.bucketStart, new Date(rawSince)),
              ),
            )
            .groupBy(productionMinute.machineId, quarter, productionMinute.productCode)
        : []

    const quality = !series ? [] : await tx
      .select({ machineId: qualityEntry.machineId, at: qualityEntry.at, quantity: qualityEntry.quantity, productCode: qualityEntry.productCode })
      .from(qualityEntry)
      .where(and(inMachines(qualityEntry.machineId), gte(qualityEntry.at, new Date(historyStart)), lt(qualityEntry.at, nowDate)))

    const closedShifts =
      historyDays > 0
        ? await tx
            .select({
              machineId: oeeShift.machineId,
              shiftDate: oeeShift.shiftDate,
              shiftId: oeeShift.shiftId,
              plannedS: oeeShift.plannedS,
              runS: oeeShift.runS,
              total: oeeShift.total,
              good: oeeShift.good,
              reject: oeeShift.reject,
              idealTimeS: oeeShift.idealTimeS,
              oee: oeeShift.oee,
              dirty: oeeShift.dirty,
            })
            .from(oeeShift)
            .where(and(inMachines(oeeShift.machineId), gte(oeeShift.shiftDate, isoDate(historyStart - DAY))))
        : []

    const gateways = await tx
      .select({
        id: gateway.id,
        unitId: gateway.unitId,
        name: gateway.name,
        status: gateway.status,
        lastSeenAt: gateway.lastSeenAt,
        hostname: gateway.hostname,
        agentVersion: gateway.agentVersion,
        model: sql<string | null>`${gateway.hwInfo} ->> 'model'`,
        configVersionLatest: gateway.configVersionLatest,
        configVersionApplied: gateway.configVersionApplied,
        health: gateway.health,
      })
      .from(gateway)
      .where(
        and(
          isNull(gateway.deletedAt),
          inUnits(gateway.unitId),
          // "Em trânsito" (L23): fora da fábrica, sem máquina e sem alerta de offline.
          or(isNull(gateway.inTransitSince), lt(gateway.inTransitUntil, nowDate)),
        ),
      )
      .orderBy(asc(gateway.name))
    const gatewayMachines = await tx
      .select({ gatewayId: gatewayMachine.gatewayId, machineId: gatewayMachine.machineId })
      .from(gatewayMachine)
      .where(inMachines(gatewayMachine.machineId))

    // Conexões e tags: só para quem tem leitura técnica (engenheiro, admin, Engemase).
    const gatewayIds = gateways.map((g) => g.id)
    const devices =
      technical && gatewayIds.length > 0
        ? await tx
            .select({
              id: device.id,
              gatewayId: device.gatewayId,
              name: device.name,
              protocol: device.protocol,
              params: device.params,
              enabled: device.enabled,
              busPort: serialBus.port,
              busBaud: serialBus.baud,
              busParity: serialBus.parity,
              busStopBits: serialBus.stopBits,
              status: gatewayDeviceStatus.status,
              latencyMs: gatewayDeviceStatus.latencyMs,
              errors1m: gatewayDeviceStatus.errors1m,
            })
            .from(device)
            .leftJoin(serialBus, and(eq(serialBus.id, device.serialBusId), eq(serialBus.organizationId, device.organizationId)))
            .leftJoin(gatewayDeviceStatus, eq(gatewayDeviceStatus.deviceId, device.id))
            .where(and(isNull(device.deletedAt), inArray(device.gatewayId, gatewayIds)))
        : []
    const tags = technical
      ? await tx
          .select({
            id: tag.id,
            deviceId: tag.deviceId,
            machineId: tag.machineId,
            name: tag.name,
            role: tag.role,
            address: tag.address,
            dataType: tag.dataType,
            wordOrder: tag.wordOrder,
            pollMs: tag.pollMs,
          })
          .from(tag)
          .where(and(isNull(tag.deletedAt), inMachines(tag.machineId)))
      : []

    const alerts = needs.notificacoes
      ? await tx
          .select({
            id: alertEvent.id,
            type: alertRule.type,
            ruleName: alertRule.name,
            severity: alertEvent.severity,
            state: alertEvent.state,
            openedAt: alertEvent.openedAt,
            machineId: alertEvent.machineId,
            gatewayId: alertEvent.gatewayId,
            acknowledgedByName: user.name,
            readAt: notification.readAt,
          })
          .from(alertEvent)
          .innerJoin(alertRule, and(eq(alertRule.id, alertEvent.ruleId), eq(alertRule.organizationId, alertEvent.organizationId)))
          .leftJoin(user, eq(user.id, alertEvent.acknowledgedBy))
          .leftJoin(
            notification,
            and(eq(notification.alertEventId, alertEvent.id), eq(notification.organizationId, alertEvent.organizationId), eq(notification.userId, ctx.user.id)),
          )
          .where(or(isNull(alertEvent.resolvedAt), gt(alertEvent.openedAt, new Date(now - ALERT_DAYS * DAY))))
          .orderBy(sql`${alertEvent.openedAt} DESC`)
          .limit(ALERT_LIMIT)
      : []

    return {
      rawSince,
      raw: {
        organization: {
          id: org.id,
          slug: org.slug,
          name: org.name,
          status: org.status ?? "active",
          plan: org.plan ?? null,
          limits: (org.limits ?? {}) as Record<string, unknown>,
          createdAt: new Date(org.createdAt).toISOString(),
        },
        units,
        areas,
        lines: lines.map((l) => ({ ...l, oeeTarget: l.oeeTarget === null ? null : Number(l.oeeTarget) })),
        machines: machines.map((m) => ({ ...m, idealCycleS: m.idealCycleS === null ? null : Number(m.idealCycleS), stateMode: m.stateMode ?? "signals" })),
        products,
        productMachines: productMachines.map((p) => ({ ...p, idealCycleS: Number(p.idealCycleS) })),
        shifts: calendario.shifts,
        holidays: calendario.holidays,
        plannedDowntimes: plannedDowntimes.map((p) => ({ unitId: p.unitId, lineId: p.lineId, machineId: p.machineId, start: msNN(p.startsAt), end: msNN(p.endsAt) })),
        reasons,
        faultMap: faultMap.map((f) => ({ machineId: f.machineId, faultCode: Number(f.faultCode), text: f.text, reasonId: f.reasonId })),
        ...(symbolRow !== undefined ? { symbolSha: symbolRow.sha256 } : {}),
        ...(brandRow !== undefined && brandingTokens(brandRow.tokens)
          ? {
              branding: {
                clientId: brandRow.organizationId,
                displayName: brandRow.displayName,
                preset: brandRow.preset,
                brandColor: brandRow.brandColor,
                sidebarMode: brandRow.sidebarMode,
                tokens: brandRow.tokens,
                adjusted: brandRow.adjusted,
              },
            }
          : {}),
        live: live.map((l) => ({
          machineId: l.machineId,
          state: l.state,
          stateSince: msNN(l.stateSince),
          faultCode: l.faultCode === null ? null : Number(l.faultCode),
          productCode: l.productCode,
          at: msNN(l.at),
        })),
        events: events.map((e) => ({
          id: e.id,
          machineId: e.machineId,
          state: e.state,
          start: msNN(e.start),
          end: ms(e.end),
          reasonId: e.reasonId,
          faultCode: e.faultCode === null ? null : Number(e.faultCode),
        })),
        runs: runs.map((r) => ({ machineId: r.machineId, start: msNN(r.start), end: ms(r.end), productCode: r.productCode })),
        rejectReasons,
        minutes: minutes.map((m) => ({ machineId: m.machineId, start: msNN(m.start), total: m.total, reject: m.reject, productCode: m.productCode })),
        quarterMinutes: quarterMinutes.map((m) => ({
          machineId: m.machineId,
          start: msNN(m.start),
          total: Number(m.total),
          reject: Number(m.reject),
          productCode: m.productCode,
        })),
        quality: quality.map((q) => ({ machineId: q.machineId, at: msNN(q.at), quantity: q.quantity, productCode: q.productCode })),
        closedShifts,
        gateways: gateways.map((g) => ({
          ...g,
          lastSeenAt: ms(g.lastSeenAt),
          health: (g.health ?? null) as Record<string, unknown> | null,
        })),
        gatewayMachines,
        devices: devices.map((d) => ({
          id: d.id,
          gatewayId: d.gatewayId,
          name: d.name,
          protocol: d.protocol,
          params: d.params as unknown as Record<string, unknown>,
          enabled: d.enabled,
          bus: d.busPort !== null ? { port: d.busPort, baud: d.busBaud ?? 9600, parity: d.busParity ?? "N", stopBits: d.busStopBits ?? 1 } : null,
          status: d.status,
          latencyMs: d.latencyMs,
          errors1m: d.errors1m,
        })),
        tags: tags.map((t) => ({ ...t, address: t.address as { area: string; offset: number } })),
        alerts: alerts.map((a) => ({
          id: a.id,
          type: a.type,
          ruleName: a.ruleName,
          severity: a.severity,
          state: a.state,
          openedAt: msNN(a.openedAt),
          machineId: a.machineId,
          gatewayId: a.gatewayId,
          acknowledgedByName: a.acknowledgedByName,
          read: a.readAt !== null,
        })),
      },
    }
  })

  const access = ctx.access
  const isEngemase = access.kind === "engemase"
  return montarClienteDados(raw.raw, {
    now,
    rawSince: raw.rawSince,
    needs,
    viewer: {
      name: ctx.user.name,
      email: ctx.user.email,
      roleLabel:
        access.kind === "engemase"
          ? `Engemase · ${PLATFORM_ROLE_LABEL[access.role]}`
          : access.kind === "terminal"
            ? access.terminalKind === "tv"
              ? "TV Andon"
              : "Tablet do operador"
            : CLIENT_ROLE_LABEL[access.role],
      isPlatform: isEngemase,
    },
    access: {
      isEngemase,
      canConfigure: hasPermission(ctx, "config.write"),
      canManageUsers: hasPermission(ctx, "users.manage"),
      canReadAudit: hasPermission(ctx, "audit.read"),
      canSeeTechnical: technical,
    },
  })
}

function isoDate(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10)
}
