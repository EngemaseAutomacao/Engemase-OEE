/**
 * Logotipos do cliente (lib/server/config/logos.ts): conferência do arquivo pelo conteúdo (PNG/WebP/SVG,
 * 1 MB, símbolo ≥ 512 px, SVG sem script/eventos/referências externas), só `config.write`, RLS por
 * cliente, troca apaga o arquivo antigo, remover e "restaurar" apagam, auditoria.
 */
import * as s from "@engemase/db"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AccessDeniedError, type TenantContext } from "@/lib/server/access/context"
import { loadTenantContext } from "@/lib/server/access/load"
import { abrirLogo, detectarFormato, enviarLogo, lerLogos, type LogoStore, removerLogo, removerTodosLogos, svgPerigoso } from "@/lib/server/config/logos"
import { type AuthHarness, createAuthHarness } from "../auth/support"
import { createPerson, type SeededClient, type SeededPerson, seedClient } from "./support"

/** PNG mínimo (assinatura + IHDR) com o tamanho pedido: basta para as conferências do servidor. */
function png(w: number, h: number, extra = 16): Blob {
  const b = Buffer.alloc(33 + extra)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write("IHDR", 12, "ascii")
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  b[32] = w % 251 // conteúdo diferente → hash diferente
  return new Blob([new Uint8Array(b)], { type: "image/png" })
}
const svg = (body: string) => new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`], { type: "image/svg+xml" })

function memoria(): LogoStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>()
  return {
    files,
    put: async (p, body) => void files.set(p, body),
    get: async (p) => {
      const f = files.get(p)
      return f ? { stream: new Blob([new Uint8Array(f)]).stream(), contentType: "x" } : null
    },
    del: async (p) => void files.delete(p),
  }
}

describe("logotipos do cliente", () => {
  let h: AuthHarness
  let a: SeededClient
  let b: SeededClient
  let eng: TenantContext
  let engB: TenantContext
  let admin: TenantContext
  const store = memoria()

  async function ctxOf(slug: string, person: SeededPerson): Promise<TenantContext> {
    const d = await loadTenantContext(h.t.db, { slug, user: person.user, sessionId: person.sessionId, now: new Date() })
    if (!d.ok) throw new Error(d.reason)
    return d.context
  }

  beforeAll(async () => {
    h = await createAuthHarness()
    a = await seedClient(h.t.db, "alfa-logos")
    b = await seedClient(h.t.db, "beta-logos")
    const sup = await createPerson(h.t.db, "super-logos", { role: "super_admin", twoFactor: true })
    eng = await ctxOf(a.slug, sup)
    engB = await ctxOf(b.slug, sup)
    admin = await ctxOf(a.slug, a.admin)
  }, 60_000)

  afterAll(async () => {
    await h.t.client.close()
  })

  it("conferência do conteúdo: formato pela assinatura e SVG perigoso", () => {
    expect(detectarFormato(Buffer.from("GIF89a....."))).toBeNull()
    expect(detectarFormato(Buffer.from('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"></svg>'))).toBe("svg")
    expect(detectarFormato(Buffer.from("<html><svg></svg></html>"))).toBeNull()
    expect(svgPerigoso('<svg><script>alert(1)</script></svg>')).toBe("script")
    expect(svgPerigoso('<svg><rect onload="x()"/></svg>')).toBe("evento")
    expect(svgPerigoso('<svg><a href="javascript:alert(1)"/></svg>')).toBe("javascript")
    expect(svgPerigoso('<svg><image href="https://mal.example/x.png"/></svg>')).toBe("referência externa")
    expect(svgPerigoso('<svg><foreignObject/></svg>')).toBe("foreignObject")
    expect(svgPerigoso('<svg><use href="#a"/><rect fill="url(#g)"/></svg>')).toBeNull()
  })

  it("envia, troca (apaga o antigo), entrega e remove, com auditoria", async () => {
    const r = await enviarLogo(h.t.db, eng, "symbol", png(512, 512), store)
    expect(r.ok).toBe(true)
    const [row] = await lerLogos(h.t.db, admin)
    expect(row).toMatchObject({ kind: "symbol", contentType: "image/png" })
    expect(row?.pathname).toMatch(new RegExp(`^logos/${a.organizationId}/symbol-[0-9a-f]{24}\\.png$`))
    const primeiro = row?.pathname ?? ""
    expect(store.files.has(primeiro)).toBe(true)

    expect((await enviarLogo(h.t.db, eng, "symbol", png(600, 600), store)).ok).toBe(true)
    expect(store.files.has(primeiro)).toBe(false)
    expect(await lerLogos(h.t.db, eng)).toHaveLength(1)

    // Quem vê o cliente recebe o arquivo; tipo inválido, não.
    expect(await abrirLogo(h.t.db, admin, "symbol", store)).not.toBeNull()
    expect(await abrirLogo(h.t.db, admin, "../x", store)).toBeNull()

    expect((await enviarLogo(h.t.db, eng, "light", svg('<rect width="10" height="10" fill="#123456"/>'), store)).ok).toBe(true)
    expect(await removerLogo(h.t.db, eng, "light", store)).toEqual({ ok: true, dados: { kind: "light" } })
    expect((await lerLogos(h.t.db, eng)).map((l) => l.kind)).toEqual(["symbol"])

    const audit = await h.t.db.select({ action: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.entityType, "client_logo"))
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["branding.logo_updated", "branding.logo_removed"]))
  })

  it("recusa: símbolo pequeno, arquivo grande, formato estranho, SVG com script, tipo inválido, sem armazenamento", async () => {
    expect(await enviarLogo(h.t.db, eng, "symbol", png(256, 256), store)).toMatchObject({ ok: false, mensagem: "O símbolo precisa ter pelo menos 512 × 512 px." })
    expect(await enviarLogo(h.t.db, eng, "light", png(800, 200, 1_048_600), store)).toMatchObject({ ok: false })
    expect(await enviarLogo(h.t.db, eng, "light", new Blob(["GIF89a......"]), store)).toMatchObject({ ok: false, mensagem: "Formato não aceito. Use SVG, PNG ou WebP." })
    expect(await enviarLogo(h.t.db, eng, "dark", svg("<script>alert(1)</script>"), store)).toMatchObject({ ok: false })
    expect(await enviarLogo(h.t.db, eng, "fundo", png(512, 512), store)).toMatchObject({ ok: false })
    expect(await enviarLogo(h.t.db, eng, "dark", png(512, 512), null)).toMatchObject({ ok: false })
  })

  it("permissões e isolamento: admin do cliente não envia; B não vê os de A; restaurar remove todos", async () => {
    await expect(enviarLogo(h.t.db, admin, "symbol", png(512, 512), store)).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(removerLogo(h.t.db, admin, "symbol", store)).rejects.toBeInstanceOf(AccessDeniedError)
    expect(await lerLogos(h.t.db, engB)).toEqual([])
    expect(await abrirLogo(h.t.db, engB, "symbol", store)).toBeNull()
    expect(await removerTodosLogos(h.t.db, eng, store)).toBe(1)
    expect(await lerLogos(h.t.db, eng)).toEqual([])
    expect(store.files.size).toBe(0)
  })
})
