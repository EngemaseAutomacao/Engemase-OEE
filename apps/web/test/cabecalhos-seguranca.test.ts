/**
 * Cabeçalhos de segurança (W11): o que não pode sumir da CSP sem alguém perceber.
 * A conferência no navegador (páginas sem violação de CSP) está em docs/operacao/revisao-seguranca-w11.md.
 */
import { describe, expect, it } from "vitest"
import { cabecalhosDeSeguranca, politicaDeConteudo } from "@/lib/cabecalhos-seguranca"

function diretivas(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((d) => {
      const [nome, ...valores] = d.trim().split(/\s+/)
      return [nome, valores]
    }),
  )
}

describe("Content-Security-Policy", () => {
  const prod = diretivas(politicaDeConteudo({ desenvolvimento: false }))
  const dev = diretivas(politicaDeConteudo({ desenvolvimento: true }))

  it("bloqueia iframe de terceiros, plugins, <base> e formulário para fora", () => {
    expect(prod.get("frame-ancestors")).toEqual(["'none'"])
    expect(prod.get("object-src")).toEqual(["'none'"])
    expect(prod.get("base-uri")).toEqual(["'self'"])
    expect(prod.get("form-action")).toEqual(["'self'"])
    expect(prod.get("default-src")).toEqual(["'self'"])
  })

  it("só aceita script da própria origem e sem eval em produção", () => {
    const script = prod.get("script-src") ?? []
    expect(script).not.toContain("'unsafe-eval'")
    expect(script.filter((v) => !v.startsWith("'"))).toEqual([])
    expect(prod.get("connect-src")).toEqual(["'self'"])
    expect(prod.has("upgrade-insecure-requests")).toBe(true)
  })

  it("em desenvolvimento libera eval (pilhas de erro do React) e não força https", () => {
    expect(dev.get("script-src")).toContain("'unsafe-eval'")
    expect(dev.has("upgrade-insecure-requests")).toBe(false)
  })

  it("nenhuma diretiva aceita qualquer origem", () => {
    for (const valores of prod.values()) {
      expect(valores).not.toContain("*")
      expect(valores).not.toContain("http:")
      expect(valores).not.toContain("https:")
    }
  })
})

describe("cabeçalhos de segurança", () => {
  const mapa = new Map(cabecalhosDeSeguranca({ desenvolvimento: false }).map((c) => [c.key, c.value]))

  it("tem HSTS de 2 anos, nosniff, Referrer-Policy, Permissions-Policy e X-Frame-Options", () => {
    expect(mapa.get("Strict-Transport-Security")).toMatch(/max-age=63072000/)
    expect(mapa.get("X-Content-Type-Options")).toBe("nosniff")
    expect(mapa.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin")
    expect(mapa.get("X-Frame-Options")).toBe("DENY")
    expect(mapa.get("Permissions-Policy")).toMatch(/camera=\(\)/)
    expect(mapa.get("Permissions-Policy")).toMatch(/fullscreen=\(self\)/)
  })

  it("não repete cabeçalho", () => {
    const nomes = cabecalhosDeSeguranca({ desenvolvimento: false }).map((c) => c.key.toLowerCase())
    expect(new Set(nomes).size).toBe(nomes.length)
  })
})
