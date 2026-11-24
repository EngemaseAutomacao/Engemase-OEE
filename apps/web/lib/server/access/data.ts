/**
 * Camada de acesso a dados (docs/15, seção 4, item 3): toda leitura de dado de cliente recebe o
 * `TenantContext`, roda em `withContext` (RLS do cliente) e aplica o escopo (D11). Não existe consulta
 * "solta". As telas reais (W8) seguem este padrão; aqui ficam as primeiras consultas, usadas também
 * pelos testes de isolamento.
 */
import { line, machine, unit } from "@engemase/db"
import { and, asc, eq, isNull } from "drizzle-orm"
import type { GatewayDb } from "@/lib/server/gateway/types"
import { assertPermission, type TenantContext } from "./context"
import { withContext } from "./load"
import { machineInScope, machineScopeCondition, unitScopeCondition } from "./scope"

export interface MachineSummary {
  readonly id: string
  readonly name: string
  readonly code: string | null
  readonly unitId: string
  readonly lineId: string
}

/** Máquinas que a pessoa pode ver (cliente pela RLS, escopo por unidade/máquina aqui). */
export async function listMachines(db: GatewayDb, ctx: TenantContext): Promise<MachineSummary[]> {
  assertPermission(ctx, "data.read")
  return withContext(db, ctx, (tx) =>
    tx
      .select({ id: machine.id, name: machine.name, code: machine.code, unitId: machine.unitId, lineId: machine.lineId })
      .from(machine)
      .where(and(isNull(machine.deletedAt), machineScopeCondition(ctx.scope)))
      .orderBy(asc(machine.name), asc(machine.id)),
  )
}

/**
 * Uma máquina pelo id (que veio da URL). Fora do cliente (RLS) ou fora do escopo → `null`, e a
 * página responde 404 nos dois casos.
 */
export async function getMachine(db: GatewayDb, ctx: TenantContext, machineId: string): Promise<MachineSummary | null> {
  assertPermission(ctx, "data.read")
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(machineId)) return null
  const [row] = await withContext(db, ctx, (tx) =>
    tx
      .select({ id: machine.id, name: machine.name, code: machine.code, unitId: machine.unitId, lineId: machine.lineId })
      .from(machine)
      .where(and(eq(machine.id, machineId), isNull(machine.deletedAt)))
      .limit(1),
  )
  return row !== undefined && machineInScope(ctx.scope, row) ? row : null
}

export interface UnitSummary {
  readonly id: string
  readonly name: string
}

/** Unidades visíveis (no escopo por máquinas: as unidades das máquinas permitidas). */
export async function listUnits(db: GatewayDb, ctx: TenantContext): Promise<UnitSummary[]> {
  assertPermission(ctx, "data.read")
  return withContext(db, ctx, (tx) =>
    tx
      .select({ id: unit.id, name: unit.name })
      .from(unit)
      .where(and(isNull(unit.deletedAt), unitScopeCondition(ctx.scope)))
      .orderBy(asc(unit.name), asc(unit.id)),
  )
}

/** Linhas que têm ao menos uma máquina visível (o OEE da linha soma só essas). */
export async function listLines(db: GatewayDb, ctx: TenantContext): Promise<{ id: string; name: string }[]> {
  assertPermission(ctx, "data.read")
  return withContext(db, ctx, (tx) =>
    tx
      .selectDistinct({ id: line.id, name: line.name })
      .from(line)
      .innerJoin(machine, and(eq(machine.lineId, line.id), eq(machine.organizationId, line.organizationId)))
      .where(and(isNull(line.deletedAt), isNull(machine.deletedAt), machineScopeCondition(ctx.scope)))
      .orderBy(asc(line.name), asc(line.id)),
  )
}
