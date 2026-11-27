/** Vagas de usuários do cliente (`limits.users` do contrato). */
import { sql } from "drizzle-orm"
import type { GatewayTx } from "@/lib/server/gateway/types"

/**
 * Trava de transação das vagas do cliente: dois convites, duas reativações ou um de cada ao mesmo tempo
 * esperam um pelo outro e não passam do limite. Advisory lock porque o `app_user` só lê `client_account`
 * (de propósito); a trava some no fim da transação.
 */
export async function lockSeats(tx: GatewayTx, organizationId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`engemase:vagas:${organizationId}`}, 0))`)
}
