/**
 * GET /api/clientes/{cliente}/maquinas — máquinas que a pessoa logada pode ver no cliente da URL
 * (primeira leitura real com requireTenant: RLS do cliente + escopo por unidade/máquina, D11).
 * Sem login 401; cliente de outra pessoa ou inexistente 404 (não revela que existe).
 */
import { getAuth } from "@/lib/server/auth"
import { listMachines } from "@/lib/server/access/data"
import { NO_STORE_HEADERS, tenantForRequest } from "@/lib/server/access/route"
import { getAuthDb, getDb } from "@/lib/server/db"

export async function GET(request: Request, ctx: RouteContext<"/api/clientes/[cliente]/maquinas">): Promise<Response> {
  const { cliente } = await ctx.params
  const db = getDb()
  const result = await tenantForRequest(request, cliente, "data.read", { auth: getAuth(), authDb: getAuthDb(), db })
  if ("response" in result) return result.response
  const machines = db === null ? [] : await listMachines(db, result.ctx)
  return Response.json({ machines }, { headers: NO_STORE_HEADERS })
}
