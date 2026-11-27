/**
 * Versões do agente no GitHub Releases (lib/server/gateway/releases.ts): só tags gateway-v<semver>
 * publicadas, só manifestos do próprio repositório e da mesma versão, e o payload do agent.update
 * montado com eles passa no contrato.
 */
import { AgentUpdatePayloadSchema } from "@engemase/contracts"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_RELEASES_REPO, lerReleases, limparCacheDeReleases, listarVersoesDoAgente } from "@/lib/server/gateway/releases"

const REPO = DEFAULT_RELEASES_REPO
const dl = (tag: string, name: string) => `https://github.com/${REPO}/releases/download/${tag}/${name}`
const asset = (tag: string, name: string, url = dl(tag, name)) => ({ name, browser_download_url: url })

const RELEASES = [
  {
    tag_name: "gateway-v0.3.0-rc.1",
    prerelease: true,
    draft: false,
    published_at: "2026-11-27T12:00:00Z",
    html_url: `https://github.com/${REPO}/releases/tag/gateway-v0.3.0-rc.1`,
    assets: [
      asset("gateway-v0.3.0-rc.1", "oee-gateway_0.3.0-rc.1_arm64.manifest.json"),
      asset("gateway-v0.3.0-rc.1", "oee-gateway_0.3.0-rc.1_arm64.manifest.json.sig"),
      asset("gateway-v0.3.0-rc.1", "oee-gateway_0.3.0-rc.1_arm64.deb"),
    ],
  },
  {
    tag_name: "gateway-v0.2.0",
    prerelease: false,
    draft: false,
    published_at: "2026-11-20T12:00:00Z",
    html_url: `https://github.com/${REPO}/releases/tag/gateway-v0.2.0`,
    assets: [
      asset("gateway-v0.2.0", "oee-gateway_0.2.0_arm64.manifest.json"),
      asset("gateway-v0.2.0", "oee-gateway_0.2.0_amd64.manifest.json"),
      // Outra versão no nome e endereço de fora do repositório: ignorados.
      asset("gateway-v0.2.0", "oee-gateway_0.1.0_armhf.manifest.json"),
      asset("gateway-v0.2.0", "oee-gateway-updater_0.2.0_arm64.manifest.json"),
    ],
  },
  { tag_name: "gateway-v0.4.0", draft: true, assets: [asset("gateway-v0.4.0", "oee-gateway_0.4.0_arm64.manifest.json")] },
  { tag_name: "web-v1.0.0", draft: false, assets: [] },
  { tag_name: "gateway-vlatest", draft: false, assets: [asset("gateway-vlatest", "oee-gateway_latest_arm64.manifest.json")] },
  {
    tag_name: "gateway-v0.1.9",
    draft: false,
    assets: [asset("gateway-v0.1.9", "oee-gateway_0.1.9_arm64.manifest.json", "https://exemplo.com/oee-gateway_0.1.9_arm64.manifest.json")],
  },
]

afterEach(() => limparCacheDeReleases())

describe("versões do agente no GitHub Releases", () => {
  it("lê só releases publicadas gateway-v<semver> com manifestos do repositório", () => {
    const rs = lerReleases(RELEASES, REPO)
    expect(rs.map((r) => r.version)).toEqual(["0.3.0-rc.1", "0.2.0"])
    expect(rs[0]).toMatchObject({ prerelease: true, manifests: { arm64: dl("gateway-v0.3.0-rc.1", "oee-gateway_0.3.0-rc.1_arm64.manifest.json") } })
    expect(rs[1]!.manifests).toEqual({
      arm64: dl("gateway-v0.2.0", "oee-gateway_0.2.0_arm64.manifest.json"),
      amd64: dl("gateway-v0.2.0", "oee-gateway_0.2.0_amd64.manifest.json"),
    })
    for (const r of rs) expect(AgentUpdatePayloadSchema.safeParse({ version: r.version, manifests: r.manifests }).success).toBe(true)
    expect(lerReleases({ message: "Not Found" })).toEqual([])
  })

  it("guarda a lista por 10 min e traduz o limite do GitHub", async () => {
    let calls = 0
    const ok = (async () => {
      calls++
      return new Response(JSON.stringify(RELEASES), { status: 200 })
    }) as typeof fetch
    expect((await listarVersoesDoAgente({ fetch: ok, now: 0 })).length).toBe(2)
    await listarVersoesDoAgente({ fetch: ok, now: 9 * 60_000 })
    expect(calls).toBe(1)
    await listarVersoesDoAgente({ fetch: ok, now: 11 * 60_000 })
    expect(calls).toBe(2)

    limparCacheDeReleases()
    const limit = (async () => new Response("{}", { status: 403 })) as typeof fetch
    await expect(listarVersoesDoAgente({ fetch: limit })).rejects.toThrow(/limitou/)
  })
})
