/**
 * GET /api/cron/expiracao — expiração de comandos, concessões e tokens, a cada 5 min (Vercel Cron, `vercel.json`), protegida pelo CRON_SECRET.
 * A lógica fica em lib/server/cron (testável sem o Next.js).
 */
import { connection } from "next/server"
import { handleCronRoute } from "@/lib/server/cron/jobs"

export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  // Com Cache Components, um GET pode ser pré-renderizado no build: isto o deixa sempre dinâmico.
  await connection()
  return handleCronRoute(request, "expiracao")
}
