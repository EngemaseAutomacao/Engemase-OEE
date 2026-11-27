/**
 * VPN do acesso remoto, partes sem banco: aprovação assinada (JWS EdDSA conferível com a chave pública
 * que vai no gateway) e cliente do Tailscale (OAuth, chave de uso único com a tag, apagar só o nó certo).
 */
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { approvalSigner } from "@/lib/server/remote/approval"
import { GATEWAY_TAG, nodeNameFor, tailscaleClient, tailscaleFromEnv } from "@/lib/server/remote/tailscale"

const GW = "01a1cab3-2bea-7244-bb03-702b326efb32"
const SESSION = "01a1cab3-2bea-7244-bb03-702b326efb99"

function novaChave(): string {
  const { privateKey } = generateKeyPairSync("ed25519")
  return privateKey.export({ format: "pem", type: "pkcs8" }).toString()
}

describe("aprovação assinada (JWS EdDSA)", () => {
  it("assina as claims do contrato e o gateway confere com a chave pública", () => {
    const signer = approvalSigner(novaChave())
    expect(signer).not.toBeNull()
    const jws = signer!.sign({
      typ: "engemase.vpn_approval.v1",
      gateway_id: GW,
      session_id: SESSION,
      requested_by: "user:a",
      approved_by: "user:b",
      approved_at: "2026-11-27T15:00:00.000Z",
      not_after: "2026-11-27T16:00:00.000Z",
      allow_ot_forward: false,
    })
    const [h, p, sig] = jws.split(".") as [string, string, string]
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "EdDSA", typ: "JWT", kid: signer!.kid })
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({ gateway_id: GW, session_id: SESSION, allow_ot_forward: false })
    // Conferência como o gateway fará: só com os 32 bytes públicos.
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(signer!.publicKeyBase64, "base64")])
    const pub = createPublicKey({ key: spki, format: "der", type: "spki" })
    expect(verify(null, Buffer.from(`${h}.${p}`), pub, Buffer.from(sig, "base64url"))).toBe(true)
    expect(verify(null, Buffer.from(`${h}.${p}x`), pub, Buffer.from(sig, "base64url"))).toBe(false)
  })

  it("gera exatamente a amostra que o gateway (Go) aceita (gateway/internal/remoteaccess/testdata)", () => {
    const f = JSON.parse(readFileSync(new URL("../../../../gateway/internal/remoteaccess/testdata/approval-from-platform.json", import.meta.url), "utf8"))
    const signer = approvalSigner(Buffer.alloc(32, 1).toString("base64"))!
    expect(signer.kid).toBe(f.kid)
    expect(signer.publicKeyBase64).toBe(f.public_key)
    expect(signer.sign(f.claims)).toBe(f.jws)
  })

  it("semente em base64 também serve; sem chave = desligado; chave errada ou claims fora do contrato = erro", () => {
    expect(approvalSigner(Buffer.alloc(32, 7).toString("base64"))?.kid).toMatch(/^[0-9a-f]{16}$/)
    expect(approvalSigner(undefined)).toBeNull()
    expect(approvalSigner("")).toBeNull()
    expect(() => approvalSigner("abc")).toThrow()
    const signer = approvalSigner(novaChave())!
    expect(() => signer.sign({ typ: "outra" } as never)).toThrow()
  })
})

describe("cliente do Tailscale", () => {
  function fakeFetch(devices: unknown[] = []) {
    const calls: { url: string; init: RequestInit }[] = []
    const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
      const u = String(url)
      calls.push({ url: u, init })
      if (u.endsWith("/api/v2/oauth/token")) return Response.json({ access_token: "tok", expires_in: 3600 })
      if (u.endsWith("/keys")) return Response.json({ key: "tskey-auth-xxxxxxxxxxxxxxxxxxxx" })
      if (u.endsWith("/devices")) return Response.json({ devices })
      if (u.includes("/api/v2/device/")) return new Response(null, { status: 200 })
      return new Response(null, { status: 404 })
    }) as typeof fetch
    return { fn, calls }
  }

  it("cria chave de uso único, pré-autorizada, com a tag do gateway; o token é reaproveitado", async () => {
    const f = fakeFetch()
    const ts = tailscaleClient({ clientId: "id", clientSecret: "segredo", tailnet: "-" }, f.fn)
    expect(await ts.mintAuthKey("OEE sessao abc")).toMatch(/^tskey-auth-/)
    await ts.mintAuthKey("outra")
    expect(f.calls.filter((c) => c.url.endsWith("/oauth/token"))).toHaveLength(1)
    const body = JSON.parse(String(f.calls.find((c) => c.url.endsWith("/keys"))?.init.body))
    expect(body.capabilities.devices.create).toEqual({ reusable: false, ephemeral: false, preauthorized: true, tags: [GATEWAY_TAG] })
    expect(body.expirySeconds).toBeLessThanOrEqual(15 * 60)
    expect(new Headers(f.calls.find((c) => c.url.endsWith("/keys"))?.init.headers).get("authorization")).toBe("Bearer tok")
  })

  it("apaga só o nó com a tag do gateway e exatamente esse nome", async () => {
    const node = nodeNameFor(GW, SESSION)
    expect(node).toMatch(/^oee-gw-[a-z0-9]{8}-[a-z0-9]{8}$/)
    const f = fakeFetch([
      { nodeId: "n1", hostname: node, tags: [GATEWAY_TAG] },
      { nodeId: "n2", hostname: node, tags: [] }, // notebook de alguém com o mesmo nome: nunca
      { nodeId: "n3", hostname: "outro", tags: [GATEWAY_TAG] },
    ])
    const ts = tailscaleClient({ clientId: "id", clientSecret: "s", tailnet: "-" }, f.fn)
    expect(await ts.deleteNode(node)).toBe(1)
    expect(f.calls.filter((c) => c.init.method === "DELETE").map((c) => c.url)).toEqual(["https://api.tailscale.com/api/v2/device/n1"])
  })

  it("sem credencial, desligado; credencial recusada vira erro sem o segredo na mensagem", async () => {
    expect(tailscaleFromEnv({})).toBeNull()
    const ts = tailscaleClient({ clientId: "id", clientSecret: "segredo-muito-secreto", tailnet: "-" }, (async () => new Response(null, { status: 401 })) as typeof fetch)
    await expect(ts.mintAuthKey("x")).rejects.toThrow(/HTTP 401/)
    await expect(ts.mintAuthKey("x")).rejects.not.toThrow(/segredo-muito-secreto/)
  })
})
