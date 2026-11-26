/**
 * Handlers HTTP da API dos gateways: `Request` → `Response` (Fetch API padrão). Os `route.ts` do
 * Next.js só repassam a requisição; os testes chamam estes handlers direto, com um banco PGlite.
 *
 * Ordem em cada rota: banco disponível (503) → autenticação (401, antes de ler o corpo) → limite de
 * taxa do gateway (429, `rate-limit.ts`) → corpo (415/413/400) → lógica, que confere o token de novo dentro da transação (ele pode ter deixado de
 * valer enquanto o corpo chegava). Erros do contrato saem com o corpo padrão e `request_id`; o resto vira
 * 500 `internal_error` (logado com o mesmo id).
 */
import { randomUUID } from "node:crypto"
import {
  EnrollRequestSchema,
  issuesFromZodError,
  MAX_SYNC_BODY_BYTES,
  normalizeActivationCode,
  SyncRequestSchema,
} from "@engemase/contracts"
import type { z } from "zod"
import { authenticateGateway } from "./auth"
import { loadGatewayConfig } from "./config"
import { enrollGateway } from "./enroll"
import { GatewayApiError } from "./errors"
import { clientIp, errorResponse, jsonResponse, NO_STORE_HEADERS, readJsonBody } from "./http"
import { DEFAULT_RATE_LIMITS, enforceRateLimit, type RateLimits, rateLimitKey } from "./rate-limit"
import { processSync } from "./sync"
import type { GatewayDb } from "./types"

/** Corpo máximo do /enroll (descompactado). */
export const MAX_ENROLL_BODY_BYTES = 16 * 1024

export interface GatewayApiDeps {
  /** Banco; `null` quando não configurado (sem endereço seguro, ver `lib/server/db.ts`) → 503. */
  readonly db: GatewayDb | null
  /** Relógio do servidor (padrão: agora). */
  readonly now?: () => Date
  /** Versão mínima do agente anunciada no /sync. */
  readonly minAgentVersion?: string
  /** Log de erros inesperados (padrão: console.error). */
  readonly logError?: (message: string, error: unknown) => void
  /** Limites de taxa (padrão: os da L21, `DEFAULT_RATE_LIMITS`); `null` desliga (testes). */
  readonly rateLimits?: RateLimits | null
}

function limitsOf(deps: GatewayApiDeps): RateLimits | null {
  return deps.rateLimits === undefined ? DEFAULT_RATE_LIMITS : deps.rateLimits
}

type Handler = (request: Request, db: GatewayDb) => Promise<Response>

async function run(request: Request, deps: GatewayApiDeps, route: string, handler: Handler): Promise<Response> {
  const requestId = (request.headers.get("x-vercel-id") ?? randomUUID()).slice(0, 128)
  try {
    if (deps.db === null) {
      throw new GatewayApiError("service_unavailable", "Banco de dados não configurado.", { retryAfterS: 30 })
    }
    return await handler(request, deps.db)
  } catch (error) {
    if (error instanceof GatewayApiError) return errorResponse(error, requestId)
    const log = deps.logError ?? ((message: string, err: unknown) => console.error(message, err))
    log(`[gateway-api] ${route} falhou (request_id ${requestId})`, error)
    return errorResponse(new GatewayApiError("internal_error", "Falha no servidor; tente de novo mais tarde."), requestId)
  }
}

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new GatewayApiError("invalid_payload", "Payload inválido.", { issues: issuesFromZodError(parsed.error) })
  }
  return parsed.data
}

function nowOf(deps: GatewayApiDeps): Date {
  return deps.now?.() ?? new Date()
}

/** POST /api/gateway/v1/enroll (sem Bearer). 201 com a credencial. */
export function handleEnroll(request: Request, deps: GatewayApiDeps): Promise<Response> {
  return run(request, deps, "enroll", async (req, db) => {
    const now = nowOf(deps)
    const ip = clientIp(req)
    const limits = limitsOf(deps)
    // Por IP antes de ler o corpo; por código depois de validá-lo (o código só entra como hash).
    if (limits !== null) await enforceRateLimit(db, rateLimitKey.enrollIp(ip), limits.enrollIp, now)
    const input = parse(EnrollRequestSchema, await readJsonBody(req, MAX_ENROLL_BODY_BYTES))
    if (limits !== null) {
      await enforceRateLimit(db, rateLimitKey.enrollCode(normalizeActivationCode(input.code)), limits.enrollCode, now)
    }
    const result = await enrollGateway(db, input, {
      now,
      ip,
      userAgent: req.headers.get("user-agent"),
    })
    return jsonResponse(result, 201)
  })
}

/** POST /api/gateway/v1/sync. 200 com ack, comandos e versão de config — só depois do COMMIT. */
export function handleSync(request: Request, deps: GatewayApiDeps): Promise<Response> {
  return run(request, deps, "sync", async (req, db) => {
    const principal = await authenticateGateway(db, req.headers.get("authorization"))
    const now = nowOf(deps)
    const limits = limitsOf(deps)
    if (limits !== null) await enforceRateLimit(db, rateLimitKey.sync(principal.gatewayId), limits.sync, now)
    const input = parse(SyncRequestSchema, await readJsonBody(req, MAX_SYNC_BODY_BYTES))
    const result = await processSync(db, principal, input, {
      now,
      ...(deps.minAgentVersion !== undefined ? { minAgentVersion: deps.minAgentVersion } : {}),
    })
    return jsonResponse(result)
  })
}

/** GET /api/gateway/v1/config, com ETag e `If-None-Match` → 304. */
export function handleConfig(request: Request, deps: GatewayApiDeps): Promise<Response> {
  return run(request, deps, "config", async (req, db) => {
    const principal = await authenticateGateway(db, req.headers.get("authorization"))
    const limits = limitsOf(deps)
    if (limits !== null) await enforceRateLimit(db, rateLimitKey.config(principal.gatewayId), limits.config, nowOf(deps))
    const result = await loadGatewayConfig(db, principal, req.headers.get("if-none-match"))
    if (result.kind === "not_modified") {
      return new Response(null, { status: 304, headers: { ...NO_STORE_HEADERS, ETag: result.etag } })
    }
    return jsonResponse(result.config, 200, { ETag: result.etag })
  })
}
