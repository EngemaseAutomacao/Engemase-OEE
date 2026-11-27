/**
 * Linhas da tela "Auditoria" do cliente (lib/data/config/auditoria.ts): rótulo e categoria da ação, quem fez
 * (cliente, Engemase, suporte com chamado, terminal, sistema), nome do item e detalhes.
 */
import { describe, expect, it } from "vitest"
import { acaoDaAuditoria, linhaDaAuditoria, type Nomes } from "@/lib/data/config/auditoria"
import type { AuditEntry } from "@/lib/server/access/summary"

const NOW = Date.parse("2026-11-27T15:00:00Z")
const nomes: Nomes = {
  entidade: new Map([
    ["00000000-0000-4000-8000-000000000001", "Injetora 01"],
    ["00000000-0000-4000-8000-0000000000a1", "Unidade Joinville"],
  ]),
  papel: new Map([["Marina Costa", "Administrador"]]),
  chamado: new Map([["00000000-0000-4000-8000-000000000009", "#1042"]]),
}

function entry(over: Partial<AuditEntry>): AuditEntry {
  return {
    id: "e1",
    at: new Date("2026-11-27T13:30:00Z"),
    actorType: "user",
    actorLabel: "Marina Costa",
    action: "machine.create",
    entityType: "machine",
    entityId: "00000000-0000-4000-8000-000000000001",
    unitId: null,
    accessGrantId: null,
    before: null,
    after: null,
    ...over,
  }
}

describe("auditoria do cliente: linhas da tela", () => {
  it("pessoa do cliente: rótulo, papel e nome da máquina pelo id", () => {
    const r = linhaDaAuditoria(entry({}), nomes, NOW)
    expect(r).toMatchObject({ actor: "Marina Costa", actorKind: "client", actorRole: "Administrador", actionLabel: "Cadastrou uma máquina", category: "config", entityName: "Injetora 01", daysAgo: 0 })
    expect(r.dayLabel).toMatch(/^Hoje · /)
  })

  it("suporte Engemase com concessão: destaque de suporte e chamado", () => {
    const r = linhaDaAuditoria(
      entry({ actorType: "engemase", actorLabel: "Carlos (técnico Engemase)", action: "shift.updated", entityType: "shift", entityId: null, accessGrantId: "00000000-0000-4000-8000-000000000009", after: { name: "Turno A" } }),
      nomes,
      NOW,
    )
    expect(r).toMatchObject({ actorKind: "support", actorRole: "Equipe Engemase", ticket: "#1042", entityName: "Turno A", actionLabel: "Alterou um turno" })
  })

  it("terminal, sistema e ação desconhecida", () => {
    const t = linhaDaAuditoria(entry({ actorType: "terminal", actorLabel: "Terminal Tablet M1", action: "quality_entry.created", entityType: "quality_entry", entityId: null, unitId: "00000000-0000-4000-8000-0000000000a1" }), nomes, NOW)
    expect(t).toMatchObject({ actorKind: "terminal", category: "production", actionLabel: "Lançou refugo", entityName: "Refugo", details: "Unidade Joinville" })
    const s = linhaDaAuditoria(entry({ actorType: "system", actorLabel: null, action: "support_access_grant.expired", entityType: null, entityId: null }), nomes, NOW)
    expect(s).toMatchObject({ actor: "Sistema", actorKind: "system", category: "support", entityName: "—" })
    expect(acaoDaAuditoria("vpn.disable")).toEqual({ label: "vpn.disable", category: "remote" })
    expect(acaoDaAuditoria("user.algo_novo").category).toBe("users")
  })
})
