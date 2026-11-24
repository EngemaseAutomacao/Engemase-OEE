/**
 * API dos gateways servida por node:http com os mesmos handlers dos route.ts (o Next.js só repassa a
 * requisição). Usada pelo teste ponta a ponta (agente Go de verdade) e pelo PoC de carga (test/poc).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { API_ROUTES } from "@engemase/contracts"
import { type GatewayApiDeps, handleConfig, handleEnroll, handleSync } from "@/lib/server/gateway/handlers"

/** Adaptador node:http → handlers (Fetch API), como o Next.js faz com os route.ts. */
export function serveGatewayApi(apiDeps: GatewayApiDeps, log?: string[]): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value)
      }
      const withBody = req.method === "POST"
      const request = new Request(url, {
        method: req.method ?? "GET",
        headers,
        ...(withBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" } : {}),
      } as RequestInit)
      let response: Response
      if (req.method === "POST" && url.pathname === API_ROUTES.enroll) response = await handleEnroll(request, apiDeps)
      else if (req.method === "POST" && url.pathname === API_ROUTES.sync) response = await handleSync(request, apiDeps)
      else if (req.method === "GET" && url.pathname === API_ROUTES.config) response = await handleConfig(request, apiDeps)
      else response = new Response("{}", { status: 404 })
      log?.push(`${req.method} ${url.pathname} → ${response.status}`)
      res.statusCode = response.status
      response.headers.forEach((value, name) => res.setHeader(name, value))
      res.end(Buffer.from(await response.arrayBuffer()))
    })().catch((error: unknown) => {
      log?.push(`erro no adaptador: ${String(error)}`)
      res.statusCode = 500
      res.end()
    })
  })
}
