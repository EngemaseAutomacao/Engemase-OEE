/**
 * HTTP da API dos gateways sobre a Fetch API padrão (`Request`/`Response`), sem nada do Next.js:
 * leitura do corpo JSON (gzip, limites de tamanho), Bearer, ETag e respostas no formato do contrato.
 */
import { isIP } from "node:net"
import { promisify } from "node:util"
import { gunzip } from "node:zlib"
import { GatewayApiError } from "./errors"

const gunzipAsync = promisify(gunzip)

/** Cabeçalhos de toda resposta: dados de cliente nunca vão para cache compartilhado (docs/15, item 6). */
export const NO_STORE_HEADERS: Readonly<Record<string, string>> = { "Cache-Control": "private, no-store" }

/** Folga do corpo compactado sobre o limite descompactado (gzip de dado incompressível cresce um pouco). */
const COMPRESSED_SLACK_BYTES = 64 * 1024

/** Lê o stream do corpo até `limit` bytes; passou disso, 413 sem ler o resto. */
async function readLimited(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > limit) {
    throw new GatewayApiError("payload_too_large")
  }
  if (request.body === null) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      throw new GatewayApiError("payload_too_large")
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/**
 * Lê e interpreta o corpo JSON de uma requisição do agente.
 *
 * - `Content-Type: application/json` (senão 415);
 * - `Content-Encoding: gzip` (o agente sempre compacta) ou sem compactação (senão 415);
 * - até `maxBytes` DEPOIS de descompactar (senão 413, também contra "bomba de gzip");
 * - JSON malformado ou gzip corrompido: 400 `invalid_payload`.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!/^application\/json\s*(?:;|$)/i.test(contentType.trim())) {
    throw new GatewayApiError("unsupported_media_type", "Envie o corpo como application/json.")
  }
  const encoding = (request.headers.get("content-encoding") ?? "").trim().toLowerCase()
  if (encoding !== "" && encoding !== "identity" && encoding !== "gzip") {
    throw new GatewayApiError("unsupported_media_type", `Content-Encoding não suportado: ${encoding} (use gzip).`)
  }

  let bytes = await readLimited(request, encoding === "gzip" ? maxBytes + COMPRESSED_SLACK_BYTES : maxBytes)
  // Se algum intermediário já descompactou o corpo e manteve o cabeçalho, segue com o JSON puro.
  if (encoding === "gzip" && isGzip(bytes)) {
    try {
      bytes = new Uint8Array(await gunzipAsync(bytes, { maxOutputLength: maxBytes }))
    } catch (error) {
      if (error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
        throw new GatewayApiError("payload_too_large")
      }
      throw new GatewayApiError("invalid_payload", "Corpo gzip inválido.", { cause: error })
    }
  }
  if (bytes.byteLength > maxBytes) throw new GatewayApiError("payload_too_large")

  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    throw new GatewayApiError("invalid_payload", "O corpo não é UTF-8 válido.", { cause: error })
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new GatewayApiError("invalid_payload", "JSON malformado.", { cause: error })
  }
}

/** Resposta JSON sem cache. */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE_HEADERS, ...headers } })
}

/** Resposta de erro no formato do contrato. */
export function errorResponse(error: GatewayApiError, requestId: string): Response {
  const headers: Record<string, string> = { "X-Request-Id": requestId }
  if (error.retryAfterS !== undefined) headers["Retry-After"] = String(error.retryAfterS)
  return jsonResponse(error.toBody(requestId), error.status, headers)
}

/** ETag forte de uma versão de config (`"42"`). */
export function configEtag(version: number): string {
  return `"${version}"`
}

/** `If-None-Match` confere com a ETag? Aceita lista, `*` e validadores fracos (W/"42"). */
export function ifNoneMatchMatches(header: string | null, etag: string): boolean {
  if (header === null) return false
  const wanted = etag.replace(/^W\//, "")
  return header
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === "*" || part.replace(/^W\//, "") === wanted)
}

/** IP de origem (primeiro de `X-Forwarded-For`, que a Vercel preenche); `null` se não for um IP válido. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const candidate = forwarded !== undefined && forwarded !== "" ? forwarded : request.headers.get("x-real-ip")?.trim()
  return candidate !== undefined && isIP(candidate) !== 0 ? candidate : null
}
