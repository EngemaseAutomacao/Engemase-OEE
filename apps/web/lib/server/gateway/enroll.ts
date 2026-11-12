/**
 * POST /api/gateway/v1/enroll — troca o código de ativação (uso único, 24 h) pela credencial do
 * gateway (docs/04, "Autenticação" e "POST /enroll").
 *
 * 1. Normaliza o código (ABCD-1234) e busca o hash com `app.resolve_gateway_enrollment_state`
 *    (@engemase/db, `resolveGatewayEnrollmentState`), que devolve o estado do código:
 *    - desconhecido ou de gateway revogado/excluído → 400 `activation_code_invalid`;
 *    - já usado → 410 `activation_code_used`;
 *    - vencido → 410 `activation_code_expired`;
 *    - válido → segue.
 *    Os ids que a busca devolve nos estados recusados nunca vão na resposta de erro.
 * 2. Já com o cliente definido (`withTenant`): marca o código como usado (condicional, à prova de
 *    corrida: outro /enroll pode ter usado ou o código pode ter vencido entre a busca e a transação),
 *    ativa o gateway com o hash do token novo, lê o slug do cliente (`organization` tem RLS forçada:
 *    o `app_user` só enxerga o cliente da transação) e registra na auditoria.
 * 3. Confere a resposta contra o contrato ANTES do COMMIT: um dado fora do formato (ex.: slug que
 *    escapou da `organization_slug_chk`) vira 500 e desfaz tudo — o código continua valendo e o
 *    gateway não fica ativo com um token que o agente nunca guardou.
 *
 * Reativar um gateway já ativo (troca de hardware, docs/08) gera token novo e invalida o anterior.
 */
import {
  type EnrollRequest,
  type EnrollResponse,
  EnrollResponseSchema,
  normalizeActivationCode,
} from "@engemase/contracts"
import {
  auditLog,
  gateway,
  type GatewayEnrollmentState,
  gatewayEnrollment,
  organization,
  resolveGatewayEnrollmentState,
  sha256Hex,
  withTenant,
} from "@engemase/db"
import { and, eq, isNull, ne } from "drizzle-orm"
import { generateGatewayToken, hashGatewayToken } from "./auth"
import { GatewayApiError } from "./errors"
import { type GatewayDb, type RequestMeta, rowsExecutor } from "./types"

/** Mensagens mostradas ao técnico na página local do gateway (docs/04). */
const INVALID_CODE_MESSAGE = "Código de ativação inválido. Confira o código ou gere um novo na plataforma."
const USED_CODE_MESSAGE = "Este código de ativação já foi usado. Gere um novo código na plataforma."
const EXPIRED_CODE_MESSAGE = "Este código de ativação venceu (vale 24 h). Gere um novo código na plataforma."

/** Resposta que sairia fora do contrato por dado do servidor: vira 500, vai para o log e desfaz a ativação. */
export class EnrollIntegrityError extends Error {
  override readonly name = "EnrollIntegrityError"
}

export interface EnrollContext extends RequestMeta {
  readonly now: Date
}

/** Hash guardado em `gateway_enrollment.code_hash`: SHA-256 do código normalizado ("ABCD-1234"). */
export function hashActivationCode(code: string): string {
  return sha256Hex(normalizeActivationCode(code))
}

/** Erro do contrato para um código que não ativa (ver a lista no início do arquivo). */
function rejectedCodeError(state: Exclude<GatewayEnrollmentState, "valid">): GatewayApiError {
  switch (state) {
    case "gateway_revoked":
      return new GatewayApiError("activation_code_invalid", INVALID_CODE_MESSAGE)
    case "used":
      return new GatewayApiError("activation_code_used", USED_CODE_MESSAGE)
    case "expired":
      return new GatewayApiError("activation_code_expired", EXPIRED_CODE_MESSAGE)
  }
}

export async function enrollGateway(db: GatewayDb, input: EnrollRequest, ctx: EnrollContext): Promise<EnrollResponse> {
  const ref = await resolveGatewayEnrollmentState(rowsExecutor(db), hashActivationCode(input.code))
  if (ref === null) throw new GatewayApiError("activation_code_invalid", INVALID_CODE_MESSAGE)
  if (ref.state !== "valid") throw rejectedCodeError(ref.state)

  const token = generateGatewayToken()
  return withTenant(db, ref.organizationId, async (tx) => {
    const [used] = await tx
      .update(gatewayEnrollment)
      .set({ usedAt: ctx.now })
      .where(and(eq(gatewayEnrollment.id, ref.id), isNull(gatewayEnrollment.usedAt)))
      .returning({ gatewayId: gatewayEnrollment.gatewayId, expiresAt: gatewayEnrollment.expiresAt })
    if (used === undefined) {
      // Outro /enroll usou o código entre a busca e esta transação.
      throw rejectedCodeError("used")
    }
    if (used.expiresAt.getTime() <= ctx.now.getTime()) {
      // Venceu entre a busca e esta transação: o erro desfaz a marcação de uso.
      throw rejectedCodeError("expired")
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
      // Gateway revogado ou excluído entre a busca e esta transação (o erro desfaz a marcação de uso).
      throw rejectedCodeError("gateway_revoked")
    }

    // `organization` tem RLS forçada: dentro da transação o app_user enxerga só este cliente.
    const [org] = await tx
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, ref.organizationId))
    if (org === undefined) throw new Error(`organização ${ref.organizationId} não visível na transação do cliente`)

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

    const response: EnrollResponse = { gateway_id: gw.id, token, org: org.slug, server_time: ctx.now.toISOString() }
    // Defesa em profundidade (como no /config): uma resposta fora do contrato nunca sai daqui — o
    // agente a recusaria depois de o código já ter sido gasto. O erro desfaz a transação.
    const checked = EnrollResponseSchema.safeParse(response)
    if (!checked.success) {
      // Só os caminhos dos campos e o slug vão para o log (nunca o token).
      const fields = checked.error.issues.map((issue) => issue.path.join(".")).join(", ")
      throw new EnrollIntegrityError(
        `gateway ${gw.id}: resposta do /enroll fora do contrato (${fields}); slug do cliente ${JSON.stringify(org.slug)}`,
      )
    }
    return response
  })
}
