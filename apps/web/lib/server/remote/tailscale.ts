/**
 * Integração com o Tailscale (docs/12): a plataforma cria a chave de entrada de USO ÚNICO de cada sessão
 * aprovada e apaga o gateway da rede no fim. Credencial OAuth com só dois escopos (auth_keys e
 * devices:core, ambos limitados a `tag:oee-gateway`) em `TAILSCALE_OAUTH_CLIENT_ID` e
 * `TAILSCALE_OAUTH_CLIENT_SECRET` (Sensitive, só produção).
 *
 * - A chave nunca vai para log nem para o banco: é criada na hora de entregar o comando ao gateway.
 * - Chave não reutilizável, pré-autorizada, com a tag do gateway e prazo curto.
 * - Toda chamada tem tempo-limite; erro vira exceção com mensagem sem segredo.
 */

export const TAILSCALE_API = "https://api.tailscale.com"
export const GATEWAY_TAG = "tag:oee-gateway"
/** Prazo da chave de entrada: só precisa durar até o gateway usá-la (o comando chega em segundos). */
export const AUTH_KEY_TTL_S = 15 * 60
const TIMEOUT_MS = 8_000

export interface VpnProvider {
  /** Cria uma chave de entrada de uso único para um gateway. */
  mintAuthKey(description: string): Promise<string>
  /** Apaga da rede o(s) nó(s) com esse nome. Devolve quantos apagou. */
  deleteNode(nodeName: string): Promise<number>
}

export class TailscaleError extends Error {
  override readonly name = "TailscaleError"
}

type Fetch = typeof fetch

/** Cliente do Tailscale a partir das variáveis de ambiente; `null` sem credencial (VPN desligada). */
export function tailscaleFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl: Fetch = fetch): VpnProvider | null {
  const id = env.TAILSCALE_OAUTH_CLIENT_ID?.trim()
  const secret = env.TAILSCALE_OAUTH_CLIENT_SECRET?.trim()
  if (!id || !secret) return null
  return tailscaleClient({ clientId: id, clientSecret: secret, tailnet: env.TAILSCALE_TAILNET?.trim() || "-" }, fetchImpl)
}

export function tailscaleClient(cfg: { clientId: string; clientSecret: string; tailnet: string }, fetchImpl: Fetch = fetch): VpnProvider {
  let token: { value: string; until: number } | null = null

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetchImpl(`${TAILSCALE_API}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    return res
  }

  async function accessToken(): Promise<string> {
    if (token !== null && Date.now() < token.until) return token.value
    const res = await call("/api/v2/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "client_credentials" }).toString(),
    })
    if (!res.ok) throw new TailscaleError(`Tailscale recusou a credencial (HTTP ${res.status}). Confira as variáveis TAILSCALE_OAUTH_*.`)
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown }
    if (typeof body.access_token !== "string") throw new TailscaleError("Tailscale não devolveu o token de acesso.")
    const ttl = typeof body.expires_in === "number" ? body.expires_in : 3600
    token = { value: body.access_token, until: Date.now() + Math.max(60, ttl - 60) * 1000 }
    return token.value
  }

  async function api(path: string, init: RequestInit = {}): Promise<Response> {
    const auth = { Authorization: `Bearer ${await accessToken()}` }
    return call(path, { ...init, headers: { ...auth, ...(init.headers ?? {}) } })
  }

  const tailnet = encodeURIComponent(cfg.tailnet)
  return {
    async mintAuthKey(description) {
      const res = await api(`/api/v2/tailnet/${tailnet}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capabilities: { devices: { create: { reusable: false, ephemeral: false, preauthorized: true, tags: [GATEWAY_TAG] } } },
          expirySeconds: AUTH_KEY_TTL_S,
          // Descrição do Tailscale: até 50 caracteres, letras, números, espaço e hífen.
          description: description.replace(/[^A-Za-z0-9 -]/g, "-").slice(0, 50),
        }),
      })
      if (!res.ok) throw new TailscaleError(`Tailscale não criou a chave de entrada (HTTP ${res.status}).`)
      const body = (await res.json()) as { key?: unknown }
      if (typeof body.key !== "string" || body.key.length < 16) throw new TailscaleError("Tailscale devolveu uma chave inválida.")
      return body.key
    },
    async deleteNode(nodeName) {
      const res = await api(`/api/v2/tailnet/${tailnet}/devices`)
      if (!res.ok) throw new TailscaleError(`Tailscale não listou os aparelhos (HTTP ${res.status}).`)
      const body = (await res.json()) as { devices?: { id?: unknown; nodeId?: unknown; hostname?: unknown; name?: unknown; tags?: unknown }[] }
      // Só nós com a tag do gateway e exatamente esse nome (o nome completo é "<nome>.<tailnet>.ts.net").
      const alvos = (body.devices ?? []).filter(
        (d) =>
          Array.isArray(d.tags) &&
          d.tags.includes(GATEWAY_TAG) &&
          (d.hostname === nodeName || (typeof d.name === "string" && d.name.split(".")[0] === nodeName)),
      )
      let n = 0
      for (const d of alvos) {
        const id = typeof d.nodeId === "string" ? d.nodeId : typeof d.id === "string" ? d.id : null
        if (id === null) continue
        const del = await api(`/api/v2/device/${encodeURIComponent(id)}`, { method: "DELETE" })
        if (!del.ok && del.status !== 404) throw new TailscaleError(`Tailscale não apagou o aparelho (HTTP ${del.status}).`)
        n++
      }
      return n
    },
  }
}

/** Nome do nó do gateway na sessão (vira o hostname na rede de manutenção). */
export function nodeNameFor(gatewayId: string, sessionId: string): string {
  const limpa = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
  return `oee-gw-${limpa(gatewayId).slice(-8)}-${limpa(sessionId).slice(-8)}`
}
