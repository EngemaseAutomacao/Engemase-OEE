/**
 * POST /api/gateway/v1/enroll — troca o código de ativação (uso único, 24 h) pela credencial do
 * gateway (docs/04, "Autenticação" e "POST /enroll").
 *
 * 1. Normaliza o código (ABCD-1234) e busca o hash com `app.resolve_gateway_enrollment` (só devolve
 *    código não usado, não vencido e de gateway não revogado).
 * 2. Já com o cliente definido (`withTenant`): marca o código como usado (condicional, à prova de
 *    corrida), ativa o gateway com o hash do token novo e registra na auditoria.
 *
 * Reativar um gateway já ativo (troca de hardware, docs/08) gera token novo e invalida o anterior.
 */
import {
  type EnrollRequest,
  type EnrollResponse,
  normalizeActivationCode,
} from "@engemase/contracts"
import { auditLog, gateway, gatewayEnrollment, organization, resolveByTokenHash, sha256Hex, withTenant } from "@engemase/db"
import { and, eq, isNull, ne } from "drizzle-orm"
import { generateGatewayToken, hashGatewayToken } from "./auth"
import { GatewayApiError } from "./errors"
import { type GatewayDb, type RequestMeta, rowsExecutor } from "./types"

export interface EnrollContext extends RequestMeta {
  readonly now: Date
}

/** Hash guardado em `gateway_enrollment.code_hash`: SHA-256 do código normalizado ("ABCD-1234"). */
export function hashActivationCode(code: string): string {
  return sha256Hex(normalizeActivationCode(code))
}

export async function enrollGateway(db: GatewayDb, input: EnrollRequest, ctx: EnrollContext): Promise<EnrollResponse> {
  const ref = await resolveByTokenHash(rowsExecutor(db), "gatewayEnrollment", hashActivationCode(input.code))
  if (ref === null) {
    // A busca não revela se o código existe, já foi usado ou venceu (a RLS esconde a linha sem
    // cliente definido): os três casos viram `activation_code_invalid`. Ver o relatório de pendências.
    throw new GatewayApiError(
      "activation_code_invalid",
      "Código de ativação inválido, já usado ou vencido. Gere um novo código na plataforma.",
    )
  }

  const token = generateGatewayToken()
  return withTenant(db, ref.organizationId, async (tx) => {
    const [used] = await tx
      .update(gatewayEnrollment)
      .set({ usedAt: ctx.now })
      .where(and(eq(gatewayEnrollment.id, ref.id), isNull(gatewayEnrollment.usedAt)))
      .returning({ gatewayId: gatewayEnrollment.gatewayId, expiresAt: gatewayEnrollment.expiresAt })
    if (used === undefined) {
      // Outro /enroll usou o código entre a busca e esta transação.
      throw new GatewayApiError("activation_code_used")
    }
    if (used.expiresAt.getTime() <= ctx.now.getTime()) {
      // Venceu entre a busca e esta transação: o erro desfaz a marcação de uso.
      throw new GatewayApiError("activation_code_expired")
    }

    const [gw] = await tx
      .update(gateway)
      .set({
        status: "active",
        tokenHash: hashGatewayToken(token),
        previousTokenHash: null,
        previousTokenExpiresAt: null,
        hostname: input.hostname,
        agentVersion: input.agent_version,
        hwInfo: input.hw,
        lastSeenAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(and(eq(gateway.id, used.gatewayId), ne(gateway.status, "revoked"), isNull(gateway.deletedAt)))
      .returning({ id: gateway.id, unitId: gateway.unitId })
    if (gw === undefined) {
      throw new GatewayApiError("activation_code_invalid", "O gateway deste código foi revogado ou excluído.")
    }

    const [org] = await tx
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, ref.organizationId))
    if (org === undefined) throw new Error(`organização ${ref.organizationId} não encontrada`)

    await tx.insert(auditLog).values({
      organizationId: ref.organizationId,
      actorType: "gateway",
      actorId: gw.id,
      action: "gateway.enrolled",
      entityType: "gateway",
      entityId: gw.id,
      unitId: gw.unitId,
      after: { hostname: input.hostname, agent_version: input.agent_version, hw: input.hw },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      at: ctx.now,
    })

    return { gateway_id: gw.id, token, org: org.slug, server_time: ctx.now.toISOString() }
  })
}
