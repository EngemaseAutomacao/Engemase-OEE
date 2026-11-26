/**
 * Gerador de códigos de ativação (docs/04, "Autenticação"; docs/08): 8 caracteres (ABCD-1234), uso
 * único, válido por 24 h, guardado só como hash (`gateway_enrollment.code_hash`). O técnico digita o
 * código na página local do gateway, que chama o POST /enroll.
 *
 * - Gerar um código novo invalida os anteriores ainda não usados do mesmo gateway (só o último vale).
 * - Vale também para gateway já ativo (troca de hardware, docs/08): o /enroll com o código novo troca
 *   o token e o anterior para de valer.
 * - Gateway revogado ou excluído não recebe código.
 *
 * O código em claro só existe na resposta desta função (mostrado uma vez na tela); nunca vai para o
 * banco nem para a auditoria.
 */
import { randomInt } from "node:crypto"
import { normalizeActivationCode } from "@engemase/contracts"
import { auditLog, gateway, gatewayEnrollment, withTenant } from "@engemase/db"
import { and, eq, isNull } from "drizzle-orm"
import { type GatewayAdminActor, GatewayAdminError, SYSTEM_ACTOR } from "./admin-errors"
import { hashActivationCode } from "./enroll"
import type { GatewayDb } from "./types"

/** Validade do código (docs/04). */
export const ACTIVATION_CODE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Alfabeto do código: A–Z e 0–9 sem os que se confundem ao ler ou digitar (I, O, 0 e 1). O contrato
 * aceita qualquer A–Z0–9; gerar sem os ambíguos só evita erro do técnico.
 */
export const ACTIVATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/** Código novo no formato ABCD-1234 (aleatório criptográfico, sem viés). */
export function generateActivationCode(): string {
  let raw = ""
  for (let i = 0; i < 8; i++) raw += ACTIVATION_CODE_ALPHABET[randomInt(ACTIVATION_CODE_ALPHABET.length)]
  return normalizeActivationCode(raw)
}

export interface CreateActivationCodeInput {
  readonly organizationId: string
  readonly gatewayId: string
  readonly actor?: GatewayAdminActor
  readonly now?: Date
  /** Validade (padrão: 24 h). */
  readonly ttlMs?: number
}

export interface ActivationCode {
  /** Em claro, para mostrar ao técnico uma única vez. */
  readonly code: string
  readonly expiresAt: Date
  readonly enrollmentId: string
}

export async function createActivationCode(db: GatewayDb, input: CreateActivationCodeInput): Promise<ActivationCode> {
  const now = input.now ?? new Date()
  const ttl = input.ttlMs ?? ACTIVATION_CODE_TTL_MS
  if (!Number.isInteger(ttl) || ttl < 60_000 || ttl > ACTIVATION_CODE_TTL_MS) {
    throw new RangeError("validade do código de ativação fora de 1 min a 24 h")
  }
  const actor = input.actor ?? SYSTEM_ACTOR
  const code = generateActivationCode()
  const expiresAt = new Date(now.getTime() + ttl)

  return withTenant(db, input.organizationId, async (tx) => {
    const [gw] = await tx
      .select({ id: gateway.id, status: gateway.status, unitId: gateway.unitId, deletedAt: gateway.deletedAt })
      .from(gateway)
      .where(eq(gateway.id, input.gatewayId))
      .for("update")
    if (gw === undefined) throw new GatewayAdminError("gateway_not_found", "Gateway não encontrado.")
    if (gw.status === "revoked" || gw.deletedAt !== null) {
      throw new GatewayAdminError("gateway_revoked", "Este gateway foi revogado. Cadastre um gateway novo para ativar outro equipamento.")
    }

    // Só o último código vale: os anteriores ainda não usados deixam de existir.
    const replaced = await tx
      .delete(gatewayEnrollment)
      .where(and(eq(gatewayEnrollment.gatewayId, gw.id), isNull(gatewayEnrollment.usedAt)))
      .returning({ id: gatewayEnrollment.id })

    const [row] = await tx
      .insert(gatewayEnrollment)
      .values({
        organizationId: input.organizationId,
        gatewayId: gw.id,
        codeHash: hashActivationCode(code),
        expiresAt,
        createdBy: actor.type === "system" ? null : (actor.id ?? null),
        createdAt: now,
      })
      .returning({ id: gatewayEnrollment.id })
    if (row === undefined) throw new Error("insert de gateway_enrollment sem retorno")

    await tx.insert(auditLog).values({
      organizationId: input.organizationId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      actorLabel: actor.label ?? null,
      action: "gateway.activation_code_created",
      entityType: "gateway",
      entityId: gw.id,
      unitId: gw.unitId,
      // Nunca o código: só a validade e quantos códigos anteriores deixaram de valer.
      after: { expires_at: expiresAt.toISOString(), replaced_codes: replaced.length, gateway_status: gw.status },
      at: now,
    })
    return { code, expiresAt, enrollmentId: row.id }
  })
}
