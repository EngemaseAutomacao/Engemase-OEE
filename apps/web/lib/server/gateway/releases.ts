/**
 * Versões do agente publicadas no GitHub Releases (workflow .github/workflows/gateway-release.yml).
 *
 * Cada release `gateway-v<semver>` traz o `.deb` e o manifesto assinado (`*.manifest.json` + `.sig`) de
 * cada arquitetura. A plataforma só monta o `agent.update` com os endereços dos manifestos; quem garante o
 * pacote é a assinatura Ed25519, conferida no gateway e de novo pelo oee-updater. Mesmo assim, só aceita
 * endereços do próprio repositório (`https://github.com/<repo>/releases/download/<tag>/...`).
 *
 * O repositório é público: a API do GitHub responde sem token (60 pedidos/h por IP). Com `GITHUB_TOKEN`
 * (só leitura de conteúdo), o limite sobe. A lista fica 10 min em memória.
 */
import type { AgentUpdatePayload, PackageArch } from "@engemase/contracts"
import { SemverSchema } from "@engemase/contracts"

export const DEFAULT_RELEASES_REPO = "EngemaseAutomacao/Engemase-OEE"
const TAG_PREFIX = "gateway-v"
const CACHE_MS = 10 * 60_000
const ARCHS: readonly PackageArch[] = ["arm64", "amd64", "armhf"]

export interface AgentRelease {
  version: string
  tag: string
  prerelease: boolean
  publishedAt: string | null
  url: string
  manifests: AgentUpdatePayload["manifests"]
}

interface GitHubAsset {
  name?: unknown
  browser_download_url?: unknown
}
interface GitHubRelease {
  tag_name?: unknown
  draft?: unknown
  prerelease?: unknown
  published_at?: unknown
  html_url?: unknown
  assets?: unknown
}

const repoDoAmbiente = () => {
  const r = process.env.GATEWAY_RELEASES_REPO?.trim()
  return r && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r) ? r : DEFAULT_RELEASES_REPO
}

/** Versão do nome do arquivo: o workflow troca o "~" da versão Debian por "-". */
const versaoDoArquivo = (v: string) => v.replaceAll("~", "-")

/**
 * Lê a resposta de `GET /repos/{repo}/releases`: só releases publicadas (não rascunho) com tag
 * `gateway-v<semver>` e pelo menos um manifesto do repositório. Mais nova primeiro (ordem do GitHub).
 */
export function lerReleases(json: unknown, repo: string = DEFAULT_RELEASES_REPO): AgentRelease[] {
  if (!Array.isArray(json)) return []
  const out: AgentRelease[] = []
  for (const r of json as GitHubRelease[]) {
    if (r.draft === true || typeof r.tag_name !== "string" || !r.tag_name.startsWith(TAG_PREFIX)) continue
    const version = r.tag_name.slice(TAG_PREFIX.length)
    if (!SemverSchema.safeParse(version).success || version.includes("+")) continue
    const prefixo = `https://github.com/${repo}/releases/download/${r.tag_name}/`
    const manifests: AgentUpdatePayload["manifests"] = {}
    for (const a of Array.isArray(r.assets) ? (r.assets as GitHubAsset[]) : []) {
      if (typeof a.name !== "string" || typeof a.browser_download_url !== "string") continue
      const m = /^oee-gateway_(.+)_(arm64|amd64|armhf)\.manifest\.json$/.exec(a.name)
      if (m === null || versaoDoArquivo(m[1]!) !== version) continue
      const url = a.browser_download_url
      if (url !== prefixo + a.name) continue
      manifests[m[2] as PackageArch] = url
    }
    if (!ARCHS.some((k) => manifests[k] !== undefined)) continue
    out.push({
      version,
      tag: r.tag_name,
      prerelease: r.prerelease === true,
      publishedAt: typeof r.published_at === "string" ? r.published_at : null,
      url: typeof r.html_url === "string" ? r.html_url : `https://github.com/${repo}/releases/tag/${r.tag_name}`,
      manifests,
    })
  }
  return out
}

let cache: { at: number; repo: string; releases: AgentRelease[] } | null = null

/** Limpa a lista em memória (testes). */
export function limparCacheDeReleases(): void {
  cache = null
}

/** Versões publicadas do agente (cache de 10 min). Falha da API do GitHub vira erro com mensagem para a tela. */
export async function listarVersoesDoAgente(opts: { fetch?: typeof fetch; now?: number } = {}): Promise<AgentRelease[]> {
  const repo = repoDoAmbiente()
  const now = opts.now ?? Date.now()
  if (cache !== null && cache.repo === repo && now - cache.at < CACHE_MS) return cache.releases
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "engemase-oee" }
  const token = process.env.GITHUB_TOKEN?.trim()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await (opts.fetch ?? fetch)(`https://api.github.com/repos/${repo}/releases?per_page=30`, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(res.status === 403 || res.status === 429 ? "O GitHub limitou as consultas agora. Tente de novo em alguns minutos." : `O GitHub respondeu ${res.status} ao listar as versões.`)
  const releases = lerReleases(await res.json(), repo)
  cache = { at: now, repo, releases }
  return releases
}
