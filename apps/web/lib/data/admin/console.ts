/**
 * Dados das telas do console Engemase (/admin). Com banco: a equipe logada (`exigirEquipe`) e uma
 * foto de todos os clientes; sem banco: os dados simulados. As telas chamam estas funções dentro de
 * <Suspense> (com banco, elas leem o pedido).
 */
import { cache } from "react"
import { buildClientDetail, buildClientRows, buildPlatformOverview } from "@/components/admin/admin-data"
import { onlyDigits } from "@/components/admin/labels"
import type { WizardContext } from "@/components/admin/wizard-model"
import { buildAudit } from "@/components/admin-ops/audit-data"
import { buildFleet } from "@/components/admin-ops/fleet-data"
import { buildRemoteAccess } from "@/components/admin-ops/remote-data"
import { buildTeam } from "@/components/admin-ops/team-data"
import { ago, initials } from "@/lib/format"
import { PLATFORM_ROLE_LABEL } from "@/lib/roles"
import { dominiosDaEngemase } from "@/lib/server/access/engemase-email"
import { usarBanco } from "../fonte"
import { exigirEquipe } from "./acesso"
import { getAuthDb } from "@/lib/server/db"
import { clientAccessRows, readTeamAccess, teamRows } from "@/lib/server/team/read"
import { type Repositorio, repositorioEmMemoria, repositorioMock } from "./repositorio"
import { fotoDaPlataforma } from "./snapshot"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Repositório do console (memorizado por pedido: layout e página leem uma vez). */
export const repositorioDoConsole = cache(async (apenas?: string): Promise<Repositorio> => {
  if (!usarBanco()) return repositorioMock
  const e = await exigirEquipe()
  const foto = await fotoDaPlataforma(e.db, e.session, e.role, new Date(), { apenas, auditoria: apenas ? 200 : 50 })
  return repositorioEmMemoria(foto)
})

/** Cabeçalho do console: pessoa, busca e sino (últimos eventos da auditoria). */
export async function dadosCabecalhoConsole() {
  const r = await repositorioDoConsole()
  const me = r.getCurrentUser()
  const clients = r.getClients()
  return {
    user: {
      name: me.name,
      email: me.email ?? "",
      roleLabel: me.platformRole ? `Engemase · ${PLATFORM_ROLE_LABEL[me.platformRole]}` : "",
      initials: initials(me.name),
      isPlatform: true,
    },
    entities: [
      ...clients.map((c) => ({ kind: "client" as const, label: c.name, hint: c.city ? `${c.city}/${c.state}` : c.slug, href: `/admin/clientes/${c.id}` })),
      ...r.getGateways().map((g) => ({
        kind: "gateway" as const,
        label: g.name,
        hint: g.hostname,
        href: `/${clients.find((c) => c.id === g.clientId)?.slug}/config/gateways/${g.id}`,
      })),
    ],
    bell: r
      .getAuditLog()
      .slice(0, 5)
      .map((a) => ({ id: a.id, severity: "info" as const, title: a.entityName, body: a.details ?? a.action, href: "/admin/auditoria", ago: ago(a.at), read: true })),
  }
}

export async function dadosVisaoGeral() {
  const r = await repositorioDoConsole()
  return { me: r.getCurrentUser(), agora: r.agoraIso(), overview: buildPlatformOverview(r) }
}

export async function dadosClientes() {
  return buildClientRows(await repositorioDoConsole())
}

/** Detalhe do cliente; `null` = não existe (a página responde 404). */
export async function dadosCliente(clienteId: string) {
  if (usarBanco() && !UUID_RE.test(clienteId)) return null
  const r = await repositorioDoConsole(usarBanco() ? clienteId : undefined)
  const d = buildClientDetail(clienteId, r)
  if (d === null) return null
  const technicians = r
    .getPlatformUsers()
    .filter((u) => u.platformRole === "technician" && u.status !== "disabled")
    .map((u) => ({ id: u.id, name: u.name }))
  const me = r.getCurrentUser()
  const base = { ...d, banco: false, clientId: clienteId, technicians, me: { id: me.id, role: me.platformRole } }
  if (!usarBanco()) return base
  // Com banco, concessões e atribuições vêm das tabelas reais (não da atividade derivada).
  const e = await exigirEquipe()
  const authDb = getAuthDb()
  if (authDb === null) return base
  const now = new Date()
  const real = clientAccessRows(await readTeamAccess(e.db, authDb, now, [clienteId]), clienteId, now)
  return { ...base, ...real, banco: true }
}

export async function nomeDoCliente(clienteId: string): Promise<string> {
  if (usarBanco()) return "Cliente"
  return repositorioMock.getClientById(clienteId)?.name ?? "Cliente"
}

export async function dadosFrota() {
  return buildFleet(await repositorioDoConsole())
}

export async function dadosEquipe() {
  const r = await repositorioDoConsole()
  const data = buildTeam(r)
  const me = r.getCurrentUser()
  if (!usarBanco()) return { ...data, banco: false, meRole: me.platformRole }
  const agora = new Date().toISOString()
  // Com banco, atribuições e concessões vêm das tabelas reais (não da atividade derivada).
  const e = await exigirEquipe()
  const authDb = getAuthDb()
  if (authDb === null) return { ...data, banco: true, meRole: e.role, agora }
  const now = new Date(agora)
  return { ...data, ...teamRows(await readTeamAccess(e.db, authDb, now), now), banco: true, meRole: e.role, agora }
}

export async function dadosAuditoria() {
  return buildAudit(await repositorioDoConsole())
}

export async function dadosAcessoRemoto() {
  return buildRemoteAccess(await repositorioDoConsole())
}

/** Contexto do assistente "Novo cliente" (slugs e CNPJs já usados, e-mails conhecidos). */
export async function dadosNovoCliente(): Promise<WizardContext> {
  const r = await repositorioDoConsole()
  const clients = r.getClients()
  return {
    usedSlugs: clients.map((c) => c.slug),
    usedCnpjs: clients.map((c) => onlyDigits(c.cnpj)).filter((c) => c !== ""),
    knownEmails: r
      .getUsers()
      .filter((u) => u.email && u.platformRole === null)
      .map((u) => ({
        email: u.email!.toLowerCase(),
        name: u.name,
        clients: u.memberships.map((m) => clients.find((c) => c.id === m.clientId)?.name ?? m.clientId),
      })),
    engemaseDomains: dominiosDaEngemase(),
  }
}
