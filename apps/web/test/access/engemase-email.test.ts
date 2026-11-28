/** Domínios de e-mail da Engemase (lib/server/access/engemase-email.ts): nunca usuário nem admin de cliente. */
import { describe, expect, it } from "vitest"
import { INITIAL_DATA, validateAdmin, type WizardContext } from "@/components/admin/wizard-model"
import { dominiosDaEngemase, ehEmailDaEngemase } from "@/lib/server/access/engemase-email"

describe("e-mails da equipe Engemase", () => {
  it("reconhece o domínio e os subdomínios, sem confundir parecidos", () => {
    expect(ehEmailDaEngemase("Joao@Engemase.com.br")).toBe(true)
    expect(ehEmailDaEngemase("x@filial.engemase.com.br")).toBe(true)
    expect(ehEmailDaEngemase("x@naoengemase.com.br")).toBe(false)
    expect(ehEmailDaEngemase("x@engemase.com.br.exemplo.com")).toBe(false)
    expect(ehEmailDaEngemase("engemase.com.br")).toBe(false)
    expect(ehEmailDaEngemase("cliente@gmail.com")).toBe(false)
  })

  it("lista configurável; inválida ou vazia volta ao padrão", () => {
    expect(dominiosDaEngemase(undefined)).toEqual(["engemase.com.br"])
    expect(dominiosDaEngemase(" @engemase.com.br, Engemase.ind.br ")).toEqual(["engemase.com.br", "engemase.ind.br"])
    expect(dominiosDaEngemase("lixo, ")).toEqual(["engemase.com.br"])
  })

  it("o assistente \"Novo cliente\" recusa e-mail da Engemase como primeiro admin, mas aceita Gmail", () => {
    const ctx: WizardContext = { usedSlugs: [], usedCnpjs: [], knownEmails: [], engemaseDomains: ["engemase.com.br"] }
    const base = { ...INITIAL_DATA, adminName: "Fulano de Tal" }
    expect(validateAdmin({ ...base, adminEmail: "pablo@engemase.com.br" }, ctx).adminEmail).toMatch(/alguém do cliente/)
    expect(validateAdmin({ ...base, adminEmail: "gerente@gmail.com" }, ctx).adminEmail).toBeUndefined()
  })
})
