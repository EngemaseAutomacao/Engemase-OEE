/**
 * POST /api/gateway/v1/sync — ciclo principal do gateway: dados e saúde → ack, comandos e versão de
 * config (docs/04). A lógica fica em lib/server/gateway (testável sem o Next.js).
 */
import { getDb } from "@/lib/server/db"
import { handleSync } from "@/lib/server/gateway/handlers"
import { tailscaleFromEnv } from "@/lib/server/remote/tailscale"

/** Cliente do Tailscale (guarda o token de acesso entre pedidos na mesma instância). */
const vpn = tailscaleFromEnv()

/** O agente desiste da requisição em 30 s (timeout do uplink); não adianta a função passar disso. */
export const maxDuration = 30

export async function POST(request: Request): Promise<Response> {
  return handleSync(request, { db: getDb(), vpn })
}
