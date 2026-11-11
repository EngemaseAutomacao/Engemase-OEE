/**
 * Erros HTTP da API dos gateways: corpo padrão e tabela código → status → ação do agente.
 * Ver docs/04, "Erros e retentativas".
 */
import { z } from "zod"
import { NonNegativeIntSchema, ShortTextSchema } from "./common"

/** O que o agente faz ao receber o erro. */
export type AgentAction =
  | "isolate_item" // bisseção do lote até achar o item culpado (vai para quarentena)
  | "stop_sending" // para de enviar, mantém o buffer e registra alarme local
  | "refresh_config" // baixa a config e tenta de novo
  | "split_batch" // divide o lote ao meio
  | "retry_after" // respeita Retry-After / retry_after_s
  | "backoff" // backoff exponencial com jitter (1 s → 5 min), mantendo o buffer
  | "fix_and_retry" // erro de operação manual (enroll): mostrar ao técnico

export interface ApiErrorInfo {
  readonly status: number
  readonly action: AgentAction
  readonly description: string
}

export const API_ERRORS = {
  invalid_payload: { status: 400, action: "isolate_item", description: "Payload inválido (schema ou regra semântica)." },
  unknown_reference: {
    status: 400,
    action: "isolate_item",
    description: "machine_id, tag_id, device_id ou id de comando que não pertence a este gateway.",
  },
  timestamp_out_of_range: {
    status: 400,
    action: "isolate_item",
    description: "Timestamp no futuro além da tolerância (server_time + 2 min).",
  },
  activation_code_invalid: { status: 400, action: "fix_and_retry", description: "Código de ativação inválido." },
  unauthorized: { status: 401, action: "stop_sending", description: "Token ausente ou inválido." },
  token_revoked: { status: 401, action: "stop_sending", description: "Token revogado pela web." },
  not_found: { status: 404, action: "fix_and_retry", description: "Rota ou recurso inexistente." },
  config_outdated: {
    status: 409,
    action: "refresh_config",
    description: "A config do agente está desatualizada para a operação.",
  },
  activation_code_expired: { status: 410, action: "fix_and_retry", description: "Código de ativação expirado (24 h)." },
  activation_code_used: { status: 410, action: "fix_and_retry", description: "Código de ativação já usado." },
  payload_too_large: { status: 413, action: "split_batch", description: "Lote grande demais (1 MiB descompactado)." },
  unsupported_media_type: {
    status: 415,
    action: "fix_and_retry",
    description: "Content-Type ou Content-Encoding não suportado (use application/json com gzip).",
  },
  rate_limited: { status: 429, action: "retry_after", description: "Limite de taxa. Respeite Retry-After." },
  internal_error: { status: 500, action: "backoff", description: "Falha temporária no servidor." },
  service_unavailable: { status: 503, action: "backoff", description: "Serviço indisponível no momento." },
} as const satisfies Record<string, ApiErrorInfo>

export type ApiErrorCode = keyof typeof API_ERRORS
export const API_ERROR_CODES = Object.keys(API_ERRORS) as ApiErrorCode[]
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES as [ApiErrorCode, ...ApiErrorCode[]])

export const ErrorIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.int()])),
  message: ShortTextSchema,
  rule: z.string().max(64).optional().describe("Id da regra semântica (params.rule), quando houver"),
})
export type ErrorIssue = z.infer<typeof ErrorIssueSchema>

/** Corpo de toda resposta de erro (4xx/5xx, exceto 304). */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: ShortTextSchema,
    retry_after_s: NonNegativeIntSchema.optional(),
    issues: z.array(ErrorIssueSchema).max(100).optional(),
    request_id: z.string().max(128).optional(),
  }),
})
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>

/** Ação do agente para um status HTTP sem corpo reconhecível (rede, proxy, 5xx genérico). */
export function agentActionForStatus(status: number): AgentAction | "ok" {
  if (status >= 200 && status < 300) return "ok"
  if (status === 400) return "isolate_item"
  if (status === 401) return "stop_sending"
  if (status === 409) return "refresh_config"
  if (status === 413) return "split_batch"
  if (status === 429) return "retry_after"
  if (status >= 500) return "backoff"
  return "fix_and_retry"
}

/** Converte os problemas de um ZodError em `issues` do corpo de erro (com o id da regra, se houver). */
export function issuesFromZodError(error: z.ZodError, max = 100): ErrorIssue[] {
  return error.issues.slice(0, max).map((issue) => {
    const params = "params" in issue ? (issue.params as Record<string, unknown> | undefined) : undefined
    const rule = typeof params?.["rule"] === "string" ? params["rule"] : undefined
    return {
      path: issue.path.map((p) => (typeof p === "number" ? p : String(p))),
      message: issue.message,
      ...(rule !== undefined ? { rule } : {}),
    }
  })
}

/** Monta o corpo de erro padrão. */
export function apiError(
  code: ApiErrorCode,
  message: string = API_ERRORS[code].description,
  extra: Omit<ErrorResponse["error"], "code" | "message"> = {},
): { status: number; body: ErrorResponse } {
  return { status: API_ERRORS[code].status, body: { error: { code, message, ...extra } } }
}
