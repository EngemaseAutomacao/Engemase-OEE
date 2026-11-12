/**
 * POST /api/gateway/v1/enroll — troca o código de ativação pela credencial do gateway (docs/04).
 * A lógica fica em lib/server/gateway (testável sem o Next.js); aqui só repassa a requisição.
 */
import { getDb } from "@/lib/server/db"
import { handleEnroll } from "@/lib/server/gateway/handlers"

export async function POST(request: Request): Promise<Response> {
  return handleEnroll(request, { db: getDb() })
}
