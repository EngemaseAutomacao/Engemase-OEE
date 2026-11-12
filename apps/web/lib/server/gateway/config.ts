/**
 * GET /api/gateway/v1/config — config completa do gateway (docs/04, "GET /config").
 *
 * Serve o snapshot imutável (`gateway_config_version`) da última versão publicada
 * (`gateway.config_version_latest`, a mesma que o /sync anuncia em `config.latest_version`).
 * ETag forte = versão (`"42"`): o snapshot de uma versão nunca muda (o papel da aplicação só tem
 * SELECT/INSERT nessa tabela). Com `If-None-Match` igual, 304 sem ler o snapshot.
 */
import { type GatewayConfig, GatewayConfigSchema } from "@engemase/contracts"
import { gateway, gatewayConfigVersion, withTenant } from "@engemase/db"
import { and, eq } from "drizzle-orm"
import { assertTokenStillValid, tokenStateInTx } from "./auth"
import { GatewayApiError } from "./errors"
import { configEtag, ifNoneMatchMatches } from "./http"
import type { GatewayDb, GatewayPrincipal } from "./types"

export type ConfigResult =
  | { readonly kind: "not_modified"; readonly etag: string; readonly version: number }
  | { readonly kind: "config"; readonly etag: string; readonly version: number; readonly config: GatewayConfig }

/** Erro de dado no servidor (snapshot ausente ou fora do contrato): vira 500 e vai para o log. */
export class ConfigIntegrityError extends Error {
  override readonly name = "ConfigIntegrityError"
}

export async function loadGatewayConfig(
  db: GatewayDb,
  principal: GatewayPrincipal,
  ifNoneMatch: string | null,
): Promise<ConfigResult> {
  return withTenant(db, principal.organizationId, async (tx) => {
    const [gw] = await tx
      .select({ tokenState: tokenStateInTx(principal.tokenHash), latest: gateway.configVersionLatest })
      .from(gateway)
      .where(eq(gateway.id, principal.gatewayId))
    // O token pode ter deixado de valer depois da autenticação (revogação, reativação, fim da rotação).
    assertTokenStillValid(gw)
    if (gw.latest < 1) throw new GatewayApiError("not_found", "Nenhuma config publicada para este gateway.")

    const etag = configEtag(gw.latest)
    if (ifNoneMatchMatches(ifNoneMatch, etag)) return { kind: "not_modified", etag, version: gw.latest }

    const [row] = await tx
      .select({ snapshot: gatewayConfigVersion.snapshot })
      .from(gatewayConfigVersion)
      .where(and(eq(gatewayConfigVersion.gatewayId, principal.gatewayId), eq(gatewayConfigVersion.version, gw.latest)))
    if (row === undefined) {
      throw new ConfigIntegrityError(`gateway ${principal.gatewayId}: versão ${gw.latest} publicada sem snapshot`)
    }
    // Defesa em profundidade: uma config fora do contrato nunca sai daqui (o agente a recusaria).
    const parsed = GatewayConfigSchema.safeParse(row.snapshot)
    if (!parsed.success || parsed.data.config_version !== gw.latest) {
      throw new ConfigIntegrityError(
        `gateway ${principal.gatewayId}: snapshot da versão ${gw.latest} fora do contrato` +
          (parsed.success ? ` (config_version ${parsed.data.config_version})` : `: ${parsed.error.message.slice(0, 500)}`),
      )
    }
    return { kind: "config", etag, version: gw.latest, config: row.snapshot }
  })
}
