/**
 * Erros da API dos gateways no formato do contrato (`ErrorResponseSchema` de @engemase/contracts):
 * `{ error: { code, message, issues?, retry_after_s?, request_id? } }`, com o status HTTP da
 * tabela `API_ERRORS` (docs/04, "Erros e retentativas").
 */
import { API_ERRORS, apiError, type ApiErrorCode, type ErrorIssue, type ErrorResponse } from "@engemase/contracts"

/** Máximo de `issues` num corpo de erro (limite do contrato). */
export const MAX_ERROR_ISSUES = 100

export interface GatewayApiErrorOptions {
  readonly issues?: readonly ErrorIssue[]
  readonly retryAfterS?: number
  readonly cause?: unknown
}

/** Erro "esperado" da API: vira resposta com o código do contrato (lançar dentro da transação faz rollback). */
export class GatewayApiError extends Error {
  override readonly name = "GatewayApiError"
  readonly code: ApiErrorCode
  readonly issues: readonly ErrorIssue[] | undefined
  readonly retryAfterS: number | undefined

  constructor(code: ApiErrorCode, message: string = API_ERRORS[code].description, options: GatewayApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.code = code
    this.issues = options.issues
    this.retryAfterS = options.retryAfterS
  }

  get status(): number {
    return API_ERRORS[this.code].status
  }

  /** Corpo de erro do contrato. */
  toBody(requestId?: string): ErrorResponse {
    const extra: Omit<ErrorResponse["error"], "code" | "message"> = {}
    if (this.issues !== undefined && this.issues.length > 0) extra.issues = this.issues.slice(0, MAX_ERROR_ISSUES)
    if (this.retryAfterS !== undefined) extra.retry_after_s = this.retryAfterS
    if (requestId !== undefined) extra.request_id = requestId.slice(0, 128)
    return apiError(this.code, this.message.slice(0, 2000), extra).body
  }
}

/** Converte um caminho com pontos ("events.3.at") no formato de `issues[].path` (["events", 3, "at"]). */
export function pathFromDotted(dotted: string): (string | number)[] {
  return dotted.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
}
