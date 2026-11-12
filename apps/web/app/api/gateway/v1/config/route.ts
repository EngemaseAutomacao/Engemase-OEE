/**
 * GET /api/gateway/v1/config — config completa do gateway, com ETag / If-None-Match → 304 (docs/04).
 * A lógica fica em lib/server/gateway (testável sem o Next.js).
 */
import { connection } from "next/server"
import { getDb } from "@/lib/server/db"
import { handleConfig } from "@/lib/server/gateway/handlers"

export async function GET(request: Request): Promise<Response> {
  // Com Cache Components, um GET pode ser pré-renderizado no build: isto o deixa sempre dinâmico
  // (inclusive a resposta 503 de quando não há DATABASE_URL, que não pode virar página estática).
  await connection()
  return handleConfig(request, { db: getDb() })
}
